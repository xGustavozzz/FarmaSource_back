import { Router } from 'express';
import { executeQuery } from '../config/db';
import oracledb from 'oracledb';
import bcrypt from 'bcryptjs';

const router = Router();

// GET all employees
router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT EMP_ID, EMP_NOMBRE, EMP_APELLIDO, EMP_CEDULA, EMP_CARGO,
             EMP_TELEFONO, EMP_EMAIL, EMP_SALARIO, EMP_ACTIVO
      FROM EMPLEADOS
      ORDER BY EMP_ID DESC
    `;
    const result = await executeQuery<any>(sql);
    const employees = result.rows?.map((row: any) => {
      let roleDisplay = row.EMP_CARGO;
      if (roleDisplay === 'ADMINISTRADOR') roleDisplay = 'Administrador';
      else if (roleDisplay === 'FARMACEUTICO') roleDisplay = 'Regente Farmacéutico';
      else if (roleDisplay === 'VENDEDOR' || roleDisplay === 'CAJERO') roleDisplay = 'Vendedor';
      else if (roleDisplay === 'AUDITOR') roleDisplay = 'Auditor';

      return {
        id: row.EMP_ID,
        firstName: row.EMP_NOMBRE,
        lastName: row.EMP_APELLIDO,
        name: `${row.EMP_NOMBRE || ''} ${row.EMP_APELLIDO || ''}`.trim(),
        cedula: row.EMP_CEDULA,
        role: roleDisplay, // ROL/CARGO
        phone: row.EMP_TELEFONO,
        email: row.EMP_EMAIL,
        salary: row.EMP_SALARIO,
        isActive: row.EMP_ACTIVO === 'S'
      };
    }) || [];
    res.json(employees);
  } catch (err: any) {
    console.error('Error fetching employees:', err);
    res.status(500).json({ message: 'Error fetching employees', error: err.message });
  }
});

// POST create employee
router.post('/', async (req, res) => {
  const { firstName, lastName, cedula, role, phone, email, salary } = req.body;
  const usernameHeader = (req.headers['x-user-username'] as string) || 'SYSTEM';

  try {
    let newId;
    let newUsuId;

    // Normalize the role for the DB
    let roleDb = String(role).toUpperCase();
    if (roleDb === 'REGENTE FARMACÉUTICO' || roleDb === 'REGENTE' || roleDb === 'FARMACEUTICO') {
      roleDb = 'FARMACEUTICO';
    }
    if (roleDb === 'CAJERO' || roleDb === 'VENDEDOR') {
      roleDb = 'VENDEDOR'; // Cajero integrated into Vendedor
    }

    // Auto-generate username: primera_letra_nombre.primer_apellido.ultimo_digito_cedula (with collision handling)
    const cleanFirst = String(firstName).trim().substring(0, 1).toLowerCase();
    const cleanLast = String(lastName).trim().split(/\s+/)[0].toLowerCase();
    const base = `${cleanFirst}.${cleanLast}`;
    
    let generatedUsername = '';
    let successGen = false;
    const cleanCedula = String(cedula).trim();

    for (let i = 1; i <= cleanCedula.length; i++) {
      const suffix = cleanCedula.slice(-i);
      const candidate = `${base}.${suffix}`;
      
      const checkRes = await executeQuery<any>(
        "SELECT COUNT(*) AS CNT FROM USUARIOS_APP WHERE USU_USERNAME = :candidate",
        { candidate }
      );
      const count = checkRes.rows?.[0]?.CNT || 0;
      if (count === 0) {
        generatedUsername = candidate;
        successGen = true;
        break;
      }
    }
    
    if (!successGen) {
      let counter = 1;
      while (true) {
        const candidate = `${base}.${cleanCedula}_${counter}`;
        const checkRes = await executeQuery<any>(
          "SELECT COUNT(*) AS CNT FROM USUARIOS_APP WHERE USU_USERNAME = :candidate",
          { candidate }
        );
        const count = checkRes.rows?.[0]?.CNT || 0;
        if (count === 0) {
          generatedUsername = candidate;
          break;
        }
        counter++;
      }
    }

    const emailVal = email || `${generatedUsername}@farmacia.com`;
    const defaultPasswordHash = bcrypt.hashSync('admin123', 12);

    try {
      // Try PL/SQL Procedure first
      const plsql = `
        BEGIN
          pkg_procesos_app.registrar_empleado_con_usuario(
            p_nombre => :firstName,
            p_apellido => :lastName,
            p_cedula => :cedula,
            p_cargo => :role,
            p_telefono => :phone,
            p_email_emp => :email,
            p_salario => :salary,
            p_username => :username,
            p_email_usuario => :emailUser,
            p_password_hash => :passwordHash,
            p_rol_principal => :rolPrincipal,
            p_emp_id => :empId,
            p_usu_id => :usuId
          );
        END;
      `;
      const result = await executeQuery<any>(plsql, {
        firstName,
        lastName,
        cedula,
        role: roleDb,
        phone: phone || null,
        email: emailVal,
        salary: Number(salary || 0),
        username: generatedUsername,
        emailUser: emailVal,
        passwordHash: defaultPasswordHash,
        rolPrincipal: roleDb,
        empId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        usuId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
      });

      newId = result.outBinds?.empId;
      if (Array.isArray(newId)) {
        newId = newId[0];
      }
      newUsuId = result.outBinds?.usuId;
      if (Array.isArray(newUsuId)) {
        newUsuId = newUsuId[0];
      }
    } catch (procErr: any) {
      console.warn('PL/SQL registrar_empleado_con_usuario failed, trying direct insert fallback:', procErr);
      const sqlFallback = `
        INSERT INTO EMPLEADOS (EMP_NOMBRE, EMP_APELLIDO, EMP_CEDULA, EMP_CARGO, EMP_TELEFONO, EMP_EMAIL, EMP_SALARIO, EMP_ACTIVO, EMP_CREATED_AT, EMP_UPDATED_AT)
        VALUES (:firstName, :lastName, :cedula, :role, :phone, :email, :salary, 'S', SYSTIMESTAMP, SYSTIMESTAMP)
        RETURNING EMP_ID INTO :id
      `;
      const result = await executeQuery<any>(sqlFallback, {
        firstName,
        lastName,
        cedula,
        role: roleDb,
        phone: phone || null,
        email: email || null,
        salary: Number(salary || 0),
        id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
      });
      newId = result.outBinds?.id;
      if (Array.isArray(newId)) {
        newId = newId[0];
      }
    }

    if (!newId) {
      throw new Error('No se pudo obtener el ID del empleado registrado.');
    }

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('EMPLEADOS', 'INSERT', :pk, :datos, :usuario, SYSTIMESTAMP)
    `, {
      pk: String(newId),
      datos: JSON.stringify({ name: `${firstName} ${lastName}`, role }),
      usuario: usernameHeader
    });

    res.status(201).json({ id: newId, message: 'Empleado creado exitosamente' });
  } catch (err: any) {
    console.error('Error creating employee:', err);
    res.status(500).json({ message: 'Error al crear empleado', error: err.message });
  }
});

// PUT update employee
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, cedula, role, phone, email, salary, isActive } = req.body;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  try {
    const prevRes = await executeQuery<any>('SELECT EMP_NOMBRE, EMP_APELLIDO, EMP_CARGO FROM EMPLEADOS WHERE EMP_ID = :id', { id: Number(id) });
    const prev = prevRes.rows?.[0];

    const sql = `
      UPDATE EMPLEADOS SET
        EMP_NOMBRE = :firstName,
        EMP_APELLIDO = :lastName,
        EMP_CEDULA = :cedula,
        EMP_CARGO = :role,
        EMP_TELEFONO = :phone,
        EMP_EMAIL = :email,
        EMP_SALARIO = :salary,
        EMP_ACTIVO = :isActive,
        EMP_UPDATED_AT = SYSTIMESTAMP
      WHERE EMP_ID = :id
    `;
    
    await executeQuery(sql, {
      id: Number(id),
      firstName,
      lastName,
      cedula,
      role,
      phone: phone || null,
      email: email || null,
      salary: Number(salary || 0),
      isActive: isActive ? 'S' : 'N'
    });

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_ANT, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('EMPLEADOS', 'UPDATE', :pk, :ant, :dsp, :usuario, SYSTIMESTAMP)
    `, {
      pk: String(id),
      ant: prev ? JSON.stringify(prev) : null,
      dsp: JSON.stringify({ name: `${firstName} ${lastName}`, role }),
      usuario: username
    });

    res.json({ message: 'Empleado actualizado exitosamente' });
  } catch (err: any) {
    console.error('Error updating employee:', err);
    res.status(500).json({ message: 'Error al actualizar empleado', error: err.message });
  }
});

export default router;
