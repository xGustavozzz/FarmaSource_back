import { Router } from 'express';
import { executeQuery } from '../config/db';

const router = Router();

// GET all audit logs
router.get('/', async (req, res) => {
  try {
    let result;
    try {
      const sql = `
        SELECT v.AUD_ID, v.AUD_TABLA, v.AUD_ACCION, v.AUD_PK_VALOR,
               v.AUD_USUARIO, v.AUD_IP, v.AUD_FECHA,
               a.AUD_DATOS_ANT, a.AUD_DATOS_DSP
        FROM V_AUDIT_RESUMEN v
        LEFT JOIN AUDIT_LOGS a ON v.AUD_ID = a.AUD_ID
        ORDER BY v.AUD_FECHA DESC
      `;
      result = await executeQuery<any>(sql);
    } catch (err) {
      console.warn('V_AUDIT_RESUMEN not available, falling back to base table query:', err);
      const sqlFallback = `
        SELECT AUD_ID, AUD_TABLA, AUD_ACCION, AUD_PK_VALOR,
               AUD_DATOS_ANT, AUD_DATOS_DSP, AUD_USUARIO, AUD_IP, AUD_FECHA
        FROM AUDIT_LOGS
        ORDER BY AUD_FECHA DESC
      `;
      result = await executeQuery<any>(sqlFallback);
    }
    const logs = result.rows?.map((row: any) => ({
      id: row.AUD_ID,
      table: row.AUD_TABLA,
      action: row.AUD_ACCION,
      registerId: row.AUD_PK_VALOR,
      previousData: row.AUD_DATOS_ANT,
      posteriorData: row.AUD_DATOS_DSP,
      username: row.AUD_USUARIO,
      ipAddress: row.AUD_IP || '127.0.0.1',
      timestamp: row.AUD_FECHA
    })) || [];
    res.json(logs);
  } catch (err: any) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ message: 'Error fetching audit logs', error: err.message });
  }
});

// POST manually add audit log
router.post('/', async (req, res) => {
  const { table, action, registerId, previous, posterior, ip } = req.body;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  try {
    const sql = `
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_ANT, AUD_DATOS_DSP, AUD_USUARIO, AUD_IP, AUD_FECHA)
      VALUES (:table, :action, :registerId, :previous, :posterior, :username, :ip, SYSTIMESTAMP)
    `;
    await executeQuery(sql, {
      table,
      action,
      registerId: registerId || null,
      previous: previous ? JSON.stringify(previous) : null,
      posterior: posterior ? JSON.stringify(posterior) : null,
      username,
      ip: ip || '127.0.0.1'
    });
    res.status(201).json({ message: 'Log de auditoría insertado' });
  } catch (err: any) {
    console.error('Error inserting audit log:', err);
    res.status(500).json({ message: 'Error al insertar log', error: err.message });
  }
});

export default router;
