import { Router } from 'express';
import { executeQuery } from '../config/db';
import oracledb from 'oracledb';

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
    const employees = result.rows?.map((row: any) => ({
      id: row.EMP_ID,
      firstName: row.EMP_NOMBRE,
      lastName: row.EMP_APELLIDO,
      name: `${row.EMP_NOMBRE || ''} ${row.EMP_APELLIDO || ''}`.trim(),
      cedula: row.EMP_CEDULA,
      role: row.EMP_CARGO, // ROL/CARGO
      phone: row.EMP_TELEFONO,
      email: row.EMP_EMAIL,
      salary: row.EMP_SALARIO,
      isActive: row.EMP_ACTIVO === 'S'
    })) || [];
    res.json(employees);
  } catch (err: any) {
    console.error('Error fetching employees:', err);
    res.status(500).json({ message: 'Error fetching employees', error: err.message });
  }
});

// POST create employee
router.post('/', async (req, res) => {
  const { firstName, lastName, cedula, role, phone, email, salary } = req.body;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  try {
    const sql = `
      INSERT INTO EMPLEADOS (EMP_NOMBRE, EMP_APELLIDO, EMP_CEDULA, EMP_CARGO, EMP_TELEFONO, EMP_EMAIL, EMP_SALARIO, EMP_ACTIVO, EMP_CREATED_AT, EMP_UPDATED_AT)
      VALUES (:firstName, :lastName, :cedula, :role, :phone, :email, :salary, 'S', SYSTIMESTAMP, SYSTIMESTAMP)
      RETURNING EMP_ID INTO :id
    `;
    
    const result = await executeQuery<any>(sql, {
      firstName,
      lastName,
      cedula,
      role,
      phone: phone || null,
      email: email || null,
      salary: Number(salary || 0),
      id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    });

    const newId = result.outBinds?.id?.[0];

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('EMPLEADOS', 'CREACIÓN', :pk, :datos, :usuario, SYSTIMESTAMP)
    `, {
      pk: String(newId),
      datos: JSON.stringify({ name: `${firstName} ${lastName}`, role }),
      usuario: username
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
      VALUES ('EMPLEADOS', 'EDICIÓN', :pk, :ant, :dsp, :usuario, SYSTIMESTAMP)
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
