import { Router } from 'express';
import { executeQuery } from '../config/db';
import oracledb from 'oracledb';

const router = Router();

// GET all clients
router.get('/', async (req, res) => {
  try {
    let result;
    try {
      const sql = `
        SELECT v.CLI_ID, v.CLI_NOMBRE, v.CLI_APELLIDO, v.CLI_CEDULA, v.CLI_TELEFONO,
               v.CLI_EMAIL, v.CLI_DIRECCION, v.CIUDAD as CIU_NOMBRE, v.PROVINCIA, v.PAIS, v.CLI_ACTIVO,
               c.CLI_CIU_ID, c.CLI_FECHA_NAC
        FROM V_CLIENTES_COMPLETO v
        LEFT JOIN CLIENTES c ON v.CLI_ID = c.CLI_ID
        ORDER BY v.CLI_ID DESC
      `;
      result = await executeQuery<any>(sql);
    } catch (err) {
      console.warn('V_CLIENTES_COMPLETO not available, falling back to base table query:', err);
      const sqlFallback = `
        SELECT c.CLI_ID, c.CLI_CIU_ID, c.CLI_NOMBRE, c.CLI_APELLIDO, c.CLI_CEDULA,
               c.CLI_TELEFONO, c.CLI_EMAIL, c.CLI_DIRECCION, c.CLI_FECHA_NAC, c.CLI_ACTIVO,
               ci.CIU_NOMBRE, ci.CIU_PROVINCIA AS PROVINCIA, 'Paraguay' AS PAIS
        FROM CLIENTES c
        LEFT JOIN CIUDADES ci ON c.CLI_CIU_ID = ci.CIU_ID
        ORDER BY c.CLI_ID DESC
      `;
      result = await executeQuery<any>(sqlFallback);
    }
    const clients = result.rows?.map((row: any) => ({
      id: row.CLI_ID,
      ciuId: row.CLI_CIU_ID,
      name: `${row.CLI_NOMBRE || ''} ${row.CLI_APELLIDO || ''}`.trim(),
      firstName: row.CLI_NOMBRE,
      lastName: row.CLI_APELLIDO,
      cedula: row.CLI_CEDULA,
      phone: row.CLI_TELEFONO,
      email: row.CLI_EMAIL,
      address: row.CLI_DIRECCION,
      birthDate: row.CLI_FECHA_NAC,
      isActive: row.CLI_ACTIVO === 'S',
      cityName: row.CIU_NOMBRE,
      provincia: row.PROVINCIA,
      pais: row.PAIS
    })) || [];
    res.json(clients);
  } catch (err: any) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ message: 'Error fetching clients', error: err.message });
  }
});

// GET cities list
router.get('/cities', async (req, res) => {
  try {
    const result = await executeQuery<any>("SELECT CIU_ID, CIU_NOMBRE FROM CIUDADES WHERE CIU_ACTIVO = 'S' ORDER BY CIU_NOMBRE");
    const cities = result.rows?.map((row: any) => ({
      id: row.CIU_ID,
      name: row.CIU_NOMBRE
    })) || [];
    res.json(cities);
  } catch (err: any) {
    console.error('Error fetching cities:', err);
    res.status(500).json({ message: 'Error fetching cities', error: err.message });
  }
});

// POST create client
router.post('/', async (req, res) => {
  const { ciuId, firstName, lastName, cedula, phone, email, address, birthDate } = req.body;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  try {
    let newId;
    try {
      // Try PL/SQL Procedure first
      const plsql = `
        BEGIN
          pkg_procesos_app.registrar_cliente(
            p_ciu_id => :ciuId,
            p_nombre => :firstName,
            p_apellido => :lastName,
            p_cedula => :cedula,
            p_telefono => :phone,
            p_email => :email,
            p_direccion => :address,
            p_fecha_nac => TO_DATE(:birthDate, 'YYYY-MM-DD'),
            p_cli_id => :id
          );
        END;
      `;
      const result = await executeQuery<any>(plsql, {
        ciuId: ciuId ? Number(ciuId) : null,
        firstName,
        lastName,
        cedula,
        phone: phone || null,
        email: email || null,
        address: address || null,
        birthDate: birthDate ? birthDate.substring(0, 10) : null,
        id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
      });
      newId = result.outBinds?.id;
      if (Array.isArray(newId)) {
        newId = newId[0];
      }
    } catch (procErr: any) {
      console.warn('PL/SQL registrar_cliente failed, trying direct insert fallback:', procErr);
      const sqlFallback = `
        INSERT INTO CLIENTES (CLI_CIU_ID, CLI_NOMBRE, CLI_APELLIDO, CLI_CEDULA, CLI_TELEFONO, CLI_EMAIL, CLI_DIRECCION, CLI_FECHA_NAC, CLI_ACTIVO, CLI_CREATED_AT)
        VALUES (:ciuId, :firstName, :lastName, :cedula, :phone, :email, :address, TO_DATE(:birthDate, 'YYYY-MM-DD'), 'S', SYSTIMESTAMP)
        RETURNING CLI_ID INTO :id
      `;
      const result = await executeQuery<any>(sqlFallback, {
        ciuId: ciuId ? Number(ciuId) : null,
        firstName,
        lastName,
        cedula,
        phone: phone || null,
        email: email || null,
        address: address || null,
        birthDate: birthDate ? birthDate.substring(0, 10) : null,
        id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
      });
      newId = result.outBinds?.id;
      if (Array.isArray(newId)) {
        newId = newId[0];
      }
    }

    if (!newId) {
      throw new Error('No se pudo obtener el ID del cliente registrado.');
    }

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('CLIENTES', 'CREACIÓN', :pk, :datos, :usuario, SYSTIMESTAMP)
    `, {
      pk: String(newId),
      datos: JSON.stringify({ name: `${firstName} ${lastName}`, cedula }),
      usuario: username
    });

    res.status(201).json({ id: newId, message: 'Cliente creado exitosamente' });
  } catch (err: any) {
    console.error('Error creating client:', err);
    res.status(500).json({ message: 'Error al crear cliente', error: err.message });
  }
});

// PUT update client
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { ciuId, firstName, lastName, cedula, phone, email, address, birthDate, isActive } = req.body;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  try {
    const prevRes = await executeQuery<any>('SELECT CLI_NOMBRE, CLI_APELLIDO, CLI_ACTIVO FROM CLIENTES WHERE CLI_ID = :id', { id: Number(id) });
    const prev = prevRes.rows?.[0];

    const sql = `
      UPDATE CLIENTES SET
        CLI_CIU_ID = :ciuId,
        CLI_NOMBRE = :firstName,
        CLI_APELLIDO = :lastName,
        CLI_CEDULA = :cedula,
        CLI_TELEFONO = :phone,
        CLI_EMAIL = :email,
        CLI_DIRECCION = :address,
        CLI_FECHA_NAC = TO_DATE(:birthDate, 'YYYY-MM-DD'),
        CLI_ACTIVO = :isActive
      WHERE CLI_ID = :id
    `;
    
    await executeQuery(sql, {
      id: Number(id),
      ciuId: ciuId ? Number(ciuId) : null,
      firstName,
      lastName,
      cedula,
      phone: phone || null,
      email: email || null,
      address: address || null,
      birthDate: birthDate ? birthDate.substring(0, 10) : null,
      isActive: isActive ? 'S' : 'N'
    });

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_ANT, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('CLIENTES', 'EDICIÓN', :pk, :ant, :dsp, :usuario, SYSTIMESTAMP)
    `, {
      pk: String(id),
      ant: prev ? JSON.stringify(prev) : null,
      dsp: JSON.stringify({ name: `${firstName} ${lastName}`, isActive }),
      usuario: username
    });

    res.json({ message: 'Cliente actualizado exitosamente' });
  } catch (err: any) {
    console.error('Error updating client:', err);
    res.status(500).json({ message: 'Error al actualizar cliente', error: err.message });
  }
});

// DELETE client (Inactivation)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  try {
    await executeQuery("UPDATE CLIENTES SET CLI_ACTIVO = 'N' WHERE CLI_ID = :id", { id: Number(id) });

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('CLIENTES', 'INACTIVACIÓN', :pk, 'Activo establecido a N', :usuario, SYSTIMESTAMP)
    `, {
      pk: String(id),
      usuario: username
    });

    res.json({ message: 'Cliente inactivado exitosamente' });
  } catch (err: any) {
    console.error('Error inactivating client:', err);
    res.status(500).json({ message: 'Error al inactivar cliente', error: err.message });
  }
});

export default router;
