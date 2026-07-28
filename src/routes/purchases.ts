import { Router } from 'express';
import oracledb from 'oracledb';
import { executeQuery } from '../config/db';
import { requireRole } from '../middleware/security';

const router = Router();

// GET all purchases
router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT c.COM_ID, c.COM_PROV_ID, c.COM_EMP_ID, c.COM_PRO_ID, c.COM_NUMERO_ORDEN,
             c.COM_FECHA, c.COM_CANTIDAD, c.COM_COSTO_UNITARIO, c.COM_TOTAL,
             c.COM_LOTE, c.COM_FECHA_CADUCIDAD, c.COM_ESTADO, c.COM_OBSERVACIONES,
             p.PROV_RAZON_SOCIAL,
             e.EMP_NOMBRE, e.EMP_APELLIDO,
             pr.PRO_NOMBRE, pr.PRO_PRESENTACION
      FROM COMPRAS c
      LEFT JOIN PROVEEDORES p ON c.COM_PROV_ID = p.PROV_ID
      LEFT JOIN EMPLEADOS e ON c.COM_EMP_ID = e.EMP_ID
      LEFT JOIN PRODUCTOS pr ON c.COM_PRO_ID = pr.PRO_ID
      ORDER BY c.COM_ID DESC
    `;
    const result = await executeQuery<any>(sql);
    const purchases = result.rows?.map((row: any) => ({
      id: row.COM_ID,
      providerId: row.COM_PROV_ID,
      employeeId: row.COM_EMP_ID,
      productId: row.COM_PRO_ID,
      orderNumber: row.COM_NUMERO_ORDEN,
      date: row.COM_FECHA,
      quantity: row.COM_CANTIDAD,
      costPrice: row.COM_COSTO_UNITARIO,
      total: row.COM_TOTAL,
      lot: row.COM_LOTE,
      expirationDate: row.COM_FECHA_CADUCIDAD,
      status: row.COM_ESTADO,
      notes: row.COM_OBSERVACIONES,
      providerName: row.PROV_RAZON_SOCIAL || 'Proveedor Desconocido',
      employeeName: `${row.EMP_NOMBRE || ''} ${row.EMP_APELLIDO || ''}`.trim(),
      productName: row.PRO_NOMBRE || 'Producto Desconocido',
      presentation: row.PRO_PRESENTACION || ''
    })) || [];
    res.json(purchases);
  } catch (err: any) {
    console.error('Error fetching purchases:', err);
    res.status(500).json({ message: 'Error fetching purchases', error: err.message });
  }
});

// POST create purchase (Transaction)
router.post('/', requireRole('ADMINISTRADOR', 'FARMACEUTICO'), async (req, res) => {
  const { providerId, productId, employeeId, quantity, costPrice, lot, expirationDate, status, notes } = req.body;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  const orderNumber = `PUR-${Date.now().toString().slice(-6)}`;
  const total = Number(quantity) * Number(costPrice);

  let connection;
  try {
    connection = await oracledb.getConnection();

    const sql = `
      INSERT INTO COMPRAS (
        COM_PROV_ID, COM_EMP_ID, COM_PRO_ID, COM_NUMERO_ORDEN, COM_FECHA,
        COM_CANTIDAD, COM_COSTO_UNITARIO, COM_TOTAL, COM_LOTE, COM_FECHA_CADUCIDAD,
        COM_ESTADO, COM_OBSERVACIONES, COM_CREATED_AT, COM_UPDATED_AT
      ) VALUES (
        :providerId, :employeeId, :productId, :orderNumber, SYSTIMESTAMP,
        :quantity, :costPrice, :total, :lot, TO_DATE(:expirationDate, 'YYYY-MM-DD'),
        :status, :notes, SYSTIMESTAMP, SYSTIMESTAMP
      )
      RETURNING COM_ID INTO :id
    `;

    const result = await connection.execute<any>(sql, {
      providerId: Number(providerId),
      employeeId: Number(employeeId),
      productId: Number(productId),
      orderNumber,
      quantity: Number(quantity),
      costPrice: Number(costPrice),
      total,
      lot: lot || null,
      expirationDate: expirationDate ? expirationDate.substring(0, 10) : null,
      status: status || 'PENDIENTE',
      notes: notes || null,
      id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    });

    const newId = result.outBinds?.id?.[0];

    // Log in AUDIT_LOGS
    const insertAuditSql = `
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('COMPRAS', 'INSERT', :pk, :datos, :usuario, SYSTIMESTAMP)
    `;
    await connection.execute(insertAuditSql, {
      pk: String(newId),
      datos: JSON.stringify({ orderNumber, total, quantity }),
      usuario: username
    });

    await connection.commit();
    res.status(201).json({ id: newId, orderNumber, message: 'Compra registrada exitosamente' });
  } catch (err: any) {
    console.error('Error creating purchase:', err);
    if (connection) {
      try {
        await connection.rollback();
      } catch (e) {}
    }
    res.status(500).json({ message: 'Error registrando la compra', error: err.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (e) {}
    }
  }
});

export default router;
