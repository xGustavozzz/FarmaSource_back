import { Router } from 'express';
import oracledb from 'oracledb';
import { executeQuery } from '../config/db';

const router = Router();

// GET all sales
router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT v.VEN_ID, v.VEN_CLI_ID, v.VEN_EMP_ID, v.VEN_FPAGO_ID, v.VEN_NUMERO_FACTURA,
             v.VEN_FECHA, v.VEN_SUBTOTAL, v.VEN_DESCUENTO, v.VEN_IMPUESTO, v.VEN_TOTAL,
             v.VEN_ESTADO, v.VEN_OBSERVACIONES,
             c.CLI_NOMBRE, c.CLI_APELLIDO,
             e.EMP_NOMBRE, e.EMP_APELLIDO,
             f.FPA_DESCRIPCION
      FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.VEN_CLI_ID = c.CLI_ID
      LEFT JOIN EMPLEADOS e ON v.VEN_EMP_ID = e.EMP_ID
      LEFT JOIN FORMAS_PAGO f ON v.VEN_FPAGO_ID = f.FPA_ID
      ORDER BY v.VEN_ID DESC
    `;
    const result = await executeQuery<any>(sql);
    const sales = result.rows?.map((row: any) => ({
      id: row.VEN_ID,
      clientId: row.VEN_CLI_ID,
      employeeId: row.VEN_EMP_ID,
      paymentMethodId: row.VEN_FPAGO_ID,
      invoiceNumber: row.VEN_NUMERO_FACTURA,
      date: row.VEN_FECHA,
      subtotal: row.VEN_SUBTOTAL,
      discount: row.VEN_DESCUENTO,
      tax: row.VEN_IMPUESTO,
      total: row.VEN_TOTAL,
      status: row.VEN_ESTADO,
      notes: row.VEN_OBSERVACIONES,
      clientName: `${row.CLI_NOMBRE || ''} ${row.CLI_APELLIDO || ''}`.trim(),
      employeeName: `${row.EMP_NOMBRE || ''} ${row.EMP_APELLIDO || ''}`.trim(),
      paymentMethodName: row.FPA_DESCRIPCION || 'Efectivo'
    })) || [];
    res.json(sales);
  } catch (err: any) {
    console.error('Error fetching sales:', err);
    res.status(500).json({ message: 'Error fetching sales', error: err.message });
  }
});

// GET sale details
router.get('/:id/items', async (req, res) => {
  const { id } = req.params;
  try {
    const sql = `
      SELECT d.DET_ID, d.DET_VEN_ID, d.DET_PRO_ID, d.DET_NRO_LINEA, d.DET_CANTIDAD,
             d.DET_PRECIO_UNIT, d.DET_DESCUENTO, d.DET_SUBTOTAL,
             p.PRO_NOMBRE, p.PRO_PRESENTACION
      FROM DETALLE_VENTAS d
      LEFT JOIN PRODUCTOS p ON d.DET_PRO_ID = p.PRO_ID
      WHERE d.DET_VEN_ID = :id
      ORDER BY d.DET_NRO_LINEA
    `;
    const result = await executeQuery<any>(sql, { id: Number(id) });
    const items = result.rows?.map((row: any) => ({
      id: row.DET_ID,
      saleId: row.DET_VEN_ID,
      productId: row.DET_PRO_ID,
      lineNumber: row.DET_NRO_LINEA,
      quantity: row.DET_CANTIDAD,
      unitPrice: row.DET_PRECIO_UNIT,
      discount: row.DET_DESCUENTO,
      subtotal: row.DET_SUBTOTAL,
      productName: row.PRO_NOMBRE,
      presentation: row.PRO_PRESENTACION
    })) || [];
    res.json(items);
  } catch (err: any) {
    console.error('Error fetching sale items:', err);
    res.status(500).json({ message: 'Error fetching sale items', error: err.message });
  }
});

// GET payment methods
router.get('/payment-methods', async (req, res) => {
  try {
    const result = await executeQuery<any>("SELECT FPA_ID, FPA_DESCRIPCION FROM FORMAS_PAGO WHERE FPA_ACTIVO = 'S'");
    const methods = result.rows?.map((row: any) => ({
      id: row.FPA_ID,
      name: row.FPA_DESCRIPCION
    })) || [];
    res.json(methods);
  } catch (err: any) {
    console.error('Error fetching payment methods:', err);
    res.status(500).json({ message: 'Error fetching payment methods', error: err.message });
  }
});

// POST create sale (Transaction)
router.post('/', async (req, res) => {
  const { clientId, employeeId, paymentMethodId, subtotal, discount, tax, total, notes, items } = req.body;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  // Generate invoice number
  const invoiceNumber = `FAC-${Date.now().toString().slice(-8)}`;

  let connection;
  try {
    connection = await oracledb.getConnection();
    
    // 1. Insert into VENTAS
    const insertVentasSql = `
      INSERT INTO VENTAS (VEN_CLI_ID, VEN_EMP_ID, VEN_FPAGO_ID, VEN_NUMERO_FACTURA, VEN_FECHA, VEN_SUBTOTAL, VEN_DESCUENTO, VEN_IMPUESTO, VEN_TOTAL, VEN_ESTADO, VEN_OBSERVACIONES, VEN_CREATED_AT, VEN_UPDATED_AT)
      VALUES (:clientId, :employeeId, :paymentMethodId, :invoiceNumber, SYSTIMESTAMP, :subtotal, :discount, :tax, :total, 'COMPLETADA', :notes, SYSTIMESTAMP, SYSTIMESTAMP)
      RETURNING VEN_ID INTO :id
    `;
    
    const salesResult = await connection.execute<any>(insertVentasSql, {
      clientId: Number(clientId),
      employeeId: Number(employeeId),
      paymentMethodId: Number(paymentMethodId),
      invoiceNumber,
      subtotal: Number(subtotal),
      discount: Number(discount || 0),
      tax: Number(tax || 0),
      total: Number(total),
      notes: notes || null,
      id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    });

    const newSaleId = salesResult.outBinds?.id?.[0];

    if (!newSaleId) {
      throw new Error('Failed to generate Sale ID.');
    }

    // 2. Insert items and update stocks
    let lineNum = 1;
    for (const item of items) {
      // 2a. Insert DETALLE_VENTAS
      const insertDetailSql = `
        INSERT INTO DETALLE_VENTAS (DET_VEN_ID, DET_PRO_ID, DET_NRO_LINEA, DET_CANTIDAD, DET_PRECIO_UNIT, DET_DESCUENTO, DET_SUBTOTAL, DET_CREATED_AT)
        VALUES (:saleId, :productId, :lineNum, :quantity, :unitPrice, :discount, :subtotal, SYSTIMESTAMP)
      `;
      await connection.execute(insertDetailSql, {
        saleId: newSaleId,
        productId: Number(item.productId),
        lineNum: lineNum++,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount || 0),
        subtotal: Number(item.subtotal)
      });

      // 2b. Update stock in PRODUCTOS
      const updateStockSql = `
        UPDATE PRODUCTOS 
        SET PRO_STOCK = PRO_STOCK - :quantity
        WHERE PRO_ID = :productId
      `;
      await connection.execute(updateStockSql, {
        quantity: Number(item.quantity),
        productId: Number(item.productId)
      });
    }

    // 3. Log in AUDIT_LOGS
    const insertAuditSql = `
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('VENTAS', 'INSERT', :pk, :datos, :usuario, SYSTIMESTAMP)
    `;
    await connection.execute(insertAuditSql, {
      pk: String(newSaleId),
      datos: JSON.stringify({ invoiceNumber, total, itemsCount: items.length }),
      usuario: username
    });

    // Commit Transaction
    await connection.commit();
    res.status(201).json({ id: newSaleId, invoiceNumber, message: 'Venta registrada exitosamente' });
  } catch (err: any) {
    console.error('Error executing sales transaction:', err);
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollErr) {
        console.error('Rollback error:', rollErr);
      }
    }
    res.status(500).json({ message: 'Error registrando la venta', error: err.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (closeErr) {
        console.error('Error closing connection:', closeErr);
      }
    }
  }
});

export default router;
