import { Router } from 'express';
import { executeQuery } from '../config/db';

const router = Router();

router.get('/', async (req, res) => {
  try {
    let productsCount = 0;
    let totalStock = 0;
    let clientsCount = 0;
    let totalSalesRevenue = 0;
    let criticalStockAlerts = 0;
    let recentSales: any[] = [];
    let recentAudits: any[] = [];

    // Query 1: Total products count
    try {
      const res = await executeQuery<any>("SELECT COUNT(*) AS COUNT FROM V_PRODUCTOS_CATALOGO");
      productsCount = res.rows?.[0]?.COUNT || 0;
    } catch {
      const res = await executeQuery<any>("SELECT COUNT(*) AS COUNT FROM PRODUCTOS");
      productsCount = res.rows?.[0]?.COUNT || 0;
    }

    // Query 2: Total stock
    try {
      const res = await executeQuery<any>("SELECT SUM(PRO_STOCK) AS TOTAL_STOCK FROM V_PRODUCTOS_CATALOGO");
      totalStock = res.rows?.[0]?.TOTAL_STOCK || 0;
    } catch {
      const res = await executeQuery<any>("SELECT SUM(PRO_STOCK) AS TOTAL_STOCK FROM PRODUCTOS");
      totalStock = res.rows?.[0]?.TOTAL_STOCK || 0;
    }

    // Query 3: Critical stock alerts
    try {
      const res = await executeQuery<any>("SELECT COUNT(*) AS COUNT FROM V_PRODUCTOS_CATALOGO WHERE PRO_STOCK <= 10");
      criticalStockAlerts = res.rows?.[0]?.COUNT || 0;
    } catch {
      const res = await executeQuery<any>("SELECT COUNT(*) AS COUNT FROM PRODUCTOS WHERE PRO_STOCK <= 10");
      criticalStockAlerts = res.rows?.[0]?.COUNT || 0;
    }

    // Query 4: Clients count
    try {
      const res = await executeQuery<any>("SELECT COUNT(*) AS COUNT FROM V_CLIENTES_COMPLETO WHERE CLI_ACTIVO = 'S'");
      clientsCount = res.rows?.[0]?.COUNT || 0;
    } catch {
      const res = await executeQuery<any>("SELECT COUNT(*) AS COUNT FROM CLIENTES WHERE CLI_ACTIVO = 'S'");
      clientsCount = res.rows?.[0]?.COUNT || 0;
    }

    // Query 5: Total Sales Revenue
    try {
      const res = await executeQuery<any>("SELECT SUM(VEN_TOTAL) AS TOTAL_SALES FROM VENTAS WHERE VEN_ESTADO = 'COMPLETADA'");
      totalSalesRevenue = res.rows?.[0]?.TOTAL_SALES || 0;
    } catch {
      totalSalesRevenue = 0;
    }

    // Query 6: Recent sales using V_VENTAS_HOY
    try {
      const res = await executeQuery<any>(`
        SELECT VEN_ID, VEN_NUMERO_FACTURA, VEN_FECHA, VEN_TOTAL, VEN_ESTADO, CLIENTE
        FROM V_VENTAS_HOY
        ORDER BY VEN_FECHA DESC
        FETCH FIRST 5 ROWS ONLY
      `);
      recentSales = res.rows?.map((row: any) => ({
        id: row.VEN_ID,
        invoiceNumber: row.VEN_NUMERO_FACTURA,
        date: row.VEN_FECHA,
        total: row.VEN_TOTAL,
        status: row.VEN_ESTADO,
        clientName: row.CLIENTE
      })) || [];
      
      if (recentSales.length < 5) {
        const fallbackRes = await executeQuery<any>(`
          SELECT v.VEN_ID, v.VEN_NUMERO_FACTURA, v.VEN_FECHA, v.VEN_TOTAL, v.VEN_ESTADO,
                 c.CLI_NOMBRE, c.CLI_APELLIDO
          FROM VENTAS v
          LEFT JOIN CLIENTES c ON v.VEN_CLI_ID = c.CLI_ID
          ORDER BY v.VEN_FECHA DESC
          FETCH FIRST 5 ROWS ONLY
        `);
        const fallbackSales = fallbackRes.rows?.map((row: any) => ({
          id: row.VEN_ID,
          invoiceNumber: row.VEN_NUMERO_FACTURA,
          date: row.VEN_FECHA,
          total: row.VEN_TOTAL,
          status: row.VEN_ESTADO,
          clientName: `${row.CLI_NOMBRE || ''} ${row.CLI_APELLIDO || ''}`.trim()
        })) || [];
        
        const seenIds = new Set(recentSales.map(s => s.id));
        for (const s of fallbackSales) {
          if (!seenIds.has(s.id) && recentSales.length < 5) {
            recentSales.push(s);
          }
        }
      }
    } catch {
      const res = await executeQuery<any>(`
        SELECT v.VEN_ID, v.VEN_NUMERO_FACTURA, v.VEN_FECHA, v.VEN_TOTAL, v.VEN_ESTADO,
               c.CLI_NOMBRE, c.CLI_APELLIDO
        FROM VENTAS v
        LEFT JOIN CLIENTES c ON v.VEN_CLI_ID = c.CLI_ID
        ORDER BY v.VEN_FECHA DESC
        FETCH FIRST 5 ROWS ONLY
      `);
      recentSales = res.rows?.map((row: any) => ({
        id: row.VEN_ID,
        invoiceNumber: row.VEN_NUMERO_FACTURA,
        date: row.VEN_FECHA,
        total: row.VEN_TOTAL,
        status: row.VEN_ESTADO,
        clientName: `${row.CLI_NOMBRE || ''} ${row.CLI_APELLIDO || ''}`.trim()
      })) || [];
    }

    // Query 7: Recent audits using V_AUDIT_RESUMEN
    try {
      const res = await executeQuery<any>(`
        SELECT AUD_ID, AUD_TABLA, AUD_ACCION, AUD_USUARIO, AUD_FECHA, AUD_PK_VALOR
        FROM V_AUDIT_RESUMEN
        ORDER BY AUD_FECHA DESC
        FETCH FIRST 6 ROWS ONLY
      `);
      recentAudits = res.rows?.map((row: any) => ({
        id: row.AUD_ID,
        table: row.AUD_TABLA,
        action: row.AUD_ACCION,
        user: row.AUD_USUARIO,
        date: row.AUD_FECHA,
        registerId: row.AUD_PK_VALOR
      })) || [];
    } catch {
      const res = await executeQuery<any>(`
        SELECT AUD_ID, AUD_TABLA, AUD_ACCION, AUD_USUARIO, AUD_FECHA, AUD_PK_VALOR
        FROM AUDIT_LOGS
        ORDER BY AUD_FECHA DESC
        FETCH FIRST 6 ROWS ONLY
      `);
      recentAudits = res.rows?.map((row: any) => ({
        id: row.AUD_ID,
        table: row.AUD_TABLA,
        action: row.AUD_ACCION,
        user: row.AUD_USUARIO,
        date: row.AUD_FECHA,
        registerId: row.AUD_PK_VALOR
      })) || [];
    }

    const stats = {
      totalProducts: productsCount,
      totalStock: totalStock,
      totalClients: clientsCount,
      totalSalesRevenue: totalSalesRevenue,
      criticalStockAlerts: criticalStockAlerts,
      recentSales,
      recentAudits
    };

    res.json(stats);
  } catch (err: any) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ message: 'Error fetching dashboard stats', error: err.message });
  }
});

export default router;
