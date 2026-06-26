import { Router } from 'express';
import { executeQuery } from '../config/db';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const productsCountRes = await executeQuery<any>(
      "SELECT COUNT(*) AS COUNT FROM PRODUCTOS"
    );
    const totalStockRes = await executeQuery<any>(
      "SELECT SUM(PRO_STOCK) AS TOTAL_STOCK FROM PRODUCTOS"
    );
    const clientsCountRes = await executeQuery<any>(
      "SELECT COUNT(*) AS COUNT FROM CLIENTES WHERE CLI_ACTIVO = 'S'"
    );
    const totalSalesRes = await executeQuery<any>(
      "SELECT SUM(VEN_TOTAL) AS TOTAL_SALES FROM VENTAS WHERE VEN_ESTADO = 'COMPLETADA'"
    );
    const criticalStockRes = await executeQuery<any>(
      "SELECT COUNT(*) AS COUNT FROM PRODUCTOS WHERE PRO_STOCK <= 10"
    );

    // Recent sales
    const recentSalesRes = await executeQuery<any>(`
      SELECT v.VEN_ID, v.VEN_NUMERO_FACTURA, v.VEN_FECHA, v.VEN_TOTAL, v.VEN_ESTADO,
             c.CLI_NOMBRE, c.CLI_APELLIDO
      FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.VEN_CLI_ID = c.CLI_ID
      ORDER BY v.VEN_FECHA DESC
      FETCH FIRST 5 ROWS ONLY
    `);

    // Recent audit logs
    const recentAuditsRes = await executeQuery<any>(`
      SELECT AUD_ID, AUD_TABLA, AUD_ACCION, AUD_USUARIO, AUD_FECHA, AUD_PK_VALOR
      FROM AUDIT_LOGS
      ORDER BY AUD_FECHA DESC
      FETCH FIRST 6 ROWS ONLY
    `);

    const stats = {
      totalProducts: productsCountRes.rows?.[0]?.COUNT || 0,
      totalStock: totalStockRes.rows?.[0]?.TOTAL_STOCK || 0,
      totalClients: clientsCountRes.rows?.[0]?.COUNT || 0,
      totalSalesRevenue: totalSalesRes.rows?.[0]?.TOTAL_SALES || 0,
      criticalStockAlerts: criticalStockRes.rows?.[0]?.COUNT || 0,
      recentSales: recentSalesRes.rows?.map((row: any) => ({
        id: row.VEN_ID,
        invoiceNumber: row.VEN_NUMERO_FACTURA,
        date: row.VEN_FECHA,
        total: row.VEN_TOTAL,
        status: row.VEN_ESTADO,
        clientName: `${row.CLI_NOMBRE || ''} ${row.CLI_APELLIDO || ''}`.trim()
      })) || [],
      recentAudits: recentAuditsRes.rows?.map((row: any) => ({
        id: row.AUD_ID,
        table: row.AUD_TABLA,
        action: row.AUD_ACCION,
        user: row.AUD_USUARIO,
        date: row.AUD_FECHA,
        registerId: row.AUD_PK_VALOR
      })) || []
    };

    res.json(stats);
  } catch (err: any) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ message: 'Error fetching dashboard stats', error: err.message });
  }
});

export default router;
