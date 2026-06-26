import { Router } from 'express';
import { executeQuery } from '../config/db';
import oracledb from 'oracledb';
import { requireRole } from '../middleware/security';

const router = Router();

// GET all products
router.get('/', async (req, res) => {
  try {
    let result;
    try {
      const sql = `
        SELECT v.PRO_ID, v.PRO_NOMBRE, v.PRO_DESCRIPCION, v.PRO_LABORATORIO, v.PRO_PRESENTACION,
               v.CATEGORIA as CAT_NOMBRE, v.PRO_PRECIO_VENTA, v.PRO_STOCK, v.PRO_REQUIERE_RECETA, v.PRO_ACTIVO,
               p.PRO_CAT_ID, p.PRO_PROV_ID, p.PRO_PRECIO_COMPRA, pr.PROV_RAZON_SOCIAL
        FROM V_PRODUCTOS_CATALOGO v
        LEFT JOIN PRODUCTOS p ON v.PRO_ID = p.PRO_ID
        LEFT JOIN PROVEEDORES pr ON p.PRO_PROV_ID = pr.PROV_ID
        ORDER BY v.PRO_ID DESC
      `;
      result = await executeQuery<any>(sql);
    } catch (err) {
      console.warn('V_PRODUCTOS_CATALOGO not available, falling back to base table query:', err);
      const sqlFallback = `
        SELECT p.PRO_ID, p.PRO_CAT_ID, p.PRO_PROV_ID, p.PRO_NOMBRE, p.PRO_DESCRIPCION,
               p.PRO_LABORATORIO, p.PRO_PRESENTACION, p.PRO_PRECIO_COMPRA, p.PRO_PRECIO_VENTA, p.PRO_STOCK,
               c.CAT_NOMBRE, pr.PROV_RAZON_SOCIAL, 'N' AS PRO_REQUIERE_RECETA, p.PRO_ACTIVO
        FROM PRODUCTOS p
        LEFT JOIN CATEGORIAS c ON p.PRO_CAT_ID = c.CAT_ID
        LEFT JOIN PROVEEDORES pr ON p.PRO_PROV_ID = pr.PROV_ID
        ORDER BY p.PRO_ID DESC
      `;
      result = await executeQuery<any>(sqlFallback);
    }
    const products = result.rows?.map((row: any) => ({
      id: row.PRO_ID,
      catId: row.PRO_CAT_ID,
      provId: row.PRO_PROV_ID,
      name: row.PRO_NOMBRE,
      description: row.PRO_DESCRIPCION,
      laboratory: row.PRO_LABORATORIO,
      presentation: row.PRO_PRESENTACION,
      purchasePrice: row.PRO_PRECIO_COMPRA,
      price: row.PRO_PRECIO_VENTA,
      stock: row.PRO_STOCK,
      categoryName: row.CAT_NOMBRE,
      providerName: row.PROV_RAZON_SOCIAL,
      requiereReceta: row.PRO_REQUIERE_RECETA === 'S'
    })) || [];
    res.json(products);
  } catch (err: any) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Error fetching products', error: err.message });
  }
});

// GET categories
router.get('/categories', async (req, res) => {
  try {
    const result = await executeQuery<any>("SELECT CAT_ID, CAT_NOMBRE, CAT_DESCRIPCION FROM CATEGORIAS WHERE CAT_ACTIVO = 'S' ORDER BY CAT_NOMBRE");
    const categories = result.rows?.map((row: any) => ({
      id: row.CAT_ID,
      name: row.CAT_NOMBRE,
      description: row.CAT_DESCRIPCION
    })) || [];
    res.json(categories);
  } catch (err: any) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ message: 'Error fetching categories', error: err.message });
  }
});

// GET providers
router.get('/providers', async (req, res) => {
  try {
    const result = await executeQuery<any>("SELECT PROV_ID, PROV_RAZON_SOCIAL, PROV_RUC FROM PROVEEDORES WHERE PROV_ACTIVO = 'S' ORDER BY PROV_RAZON_SOCIAL");
    const providers = result.rows?.map((row: any) => ({
      id: row.PROV_ID,
      name: row.PROV_RAZON_SOCIAL,
      ruc: row.PROV_RUC
    })) || [];
    res.json(providers);
  } catch (err: any) {
    console.error('Error fetching providers:', err);
    res.status(500).json({ message: 'Error fetching providers', error: err.message });
  }
});

// POST create product
router.post('/', requireRole('ADMINISTRADOR', 'FARMACEUTICO'), async (req, res) => {
  const { catId, provId, name, description, laboratory, presentation, purchasePrice, price, stock } = req.body;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';
  
  try {
    const sql = `
      INSERT INTO PRODUCTOS (PRO_CAT_ID, PRO_PROV_ID, PRO_NOMBRE, PRO_DESCRIPCION, PRO_LABORATORIO, PRO_PRESENTACION, PRO_PRECIO_COMPRA, PRO_PRECIO_VENTA, PRO_STOCK)
      VALUES (:catId, :provId, :nombre, :descripcion, :laboratorio, :presentacion, :precioCompra, :precioVenta, :stock)
      RETURNING PRO_ID INTO :id
    `;
    
    const result = await executeQuery<any>(sql, {
      catId: Number(catId),
      provId: provId ? Number(provId) : null,
      nombre: name,
      descripcion: description || null,
      laboratorio: laboratory || null,
      presentacion: presentation || null,
      precioCompra: Number(purchasePrice || 0),
      precioVenta: Number(price || 0),
      stock: Number(stock || 0),
      id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
    });

    const newId = result.outBinds?.id?.[0];

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('PRODUCTOS', 'INSERT', :pk, :datos, :usuario, SYSTIMESTAMP)
    `, {
      pk: String(newId),
      datos: JSON.stringify({ name, price, stock }),
      usuario: username
    });

    res.status(201).json({ id: newId, message: 'Producto creado exitosamente' });
  } catch (err: any) {
    console.error('Error creating product:', err);
    res.status(500).json({ message: 'Error al crear producto', error: err.message });
  }
});

// PUT update product
router.put('/:id', requireRole('ADMINISTRADOR', 'FARMACEUTICO'), async (req, res) => {
  const { id } = req.params;
  const { catId, provId, name, description, laboratory, presentation, purchasePrice, price, stock } = req.body;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  try {
    // Get previous state for audit log
    const prevRes = await executeQuery<any>('SELECT PRO_NOMBRE, PRO_PRECIO_VENTA, PRO_STOCK FROM PRODUCTOS WHERE PRO_ID = :id', { id: Number(id) });
    const prev = prevRes.rows?.[0];

    const sql = `
      UPDATE PRODUCTOS SET
        PRO_CAT_ID = :catId,
        PRO_PROV_ID = :provId,
        PRO_NOMBRE = :nombre,
        PRO_DESCRIPCION = :descripcion,
        PRO_LABORATORIO = :laboratorio,
        PRO_PRESENTACION = :presentacion,
        PRO_PRECIO_COMPRA = :precioCompra,
        PRO_PRECIO_VENTA = :precioVenta,
        PRO_STOCK = :stock
      WHERE PRO_ID = :id
    `;
    
    await executeQuery(sql, {
      id: Number(id),
      catId: Number(catId),
      provId: provId ? Number(provId) : null,
      nombre: name,
      descripcion: description || null,
      laboratorio: laboratory || null,
      presentacion: presentation || null,
      precioCompra: Number(purchasePrice || 0),
      precioVenta: Number(price || 0),
      stock: Number(stock || 0)
    });

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_ANT, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('PRODUCTOS', 'UPDATE', :pk, :ant, :dsp, :usuario, SYSTIMESTAMP)
    `, {
      pk: String(id),
      ant: prev ? JSON.stringify(prev) : null,
      dsp: JSON.stringify({ name, price, stock }),
      usuario: username
    });

    res.json({ message: 'Producto actualizado exitosamente' });
  } catch (err: any) {
    console.error('Error updating product:', err);
    res.status(500).json({ message: 'Error al actualizar producto', error: err.message });
  }
});

// DELETE product
router.delete('/:id', requireRole('ADMINISTRADOR', 'FARMACEUTICO'), async (req, res) => {
  const { id } = req.params;
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';

  try {
    // Get previous state for audit log
    const prevRes = await executeQuery<any>('SELECT PRO_NOMBRE FROM PRODUCTOS WHERE PRO_ID = :id', { id: Number(id) });
    const prev = prevRes.rows?.[0];

    await executeQuery('DELETE FROM PRODUCTOS WHERE PRO_ID = :id', { id: Number(id) });

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_ANT, AUD_USUARIO, AUD_FECHA)
      VALUES ('PRODUCTOS', 'DELETE', :pk, :ant, :usuario, SYSTIMESTAMP)
    `, {
      pk: String(id),
      ant: prev ? JSON.stringify(prev) : null,
      usuario: username
    });

    res.json({ message: 'Producto eliminado exitosamente' });
  } catch (err: any) {
    console.error('Error deleting product:', err);
    res.status(500).json({ message: 'Error al eliminar producto', error: err.message });
  }
});

// POST replenish critical stock
router.post('/replenish', requireRole('ADMINISTRADOR', 'FARMACEUTICO'), async (req, res) => {
  const username = (req.headers['x-user-username'] as string) || 'SYSTEM';
  try {
    await executeQuery(`
      UPDATE PRODUCTOS
      SET PRO_STOCK = PRO_STOCK + 50
      WHERE PRO_STOCK <= 10
    `);

    // Log in AUDIT_LOGS
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('PRODUCTOS', 'UPDATE', 'GLOBAL', 'Reabastecimiento de stock crítico (+50 unidades)', :usuario, SYSTIMESTAMP)
    `, {
      usuario: username
    });

    res.json({ message: 'Stock crítico reabastecido exitosamente' });
  } catch (err: any) {
    console.error('Error replenishing products:', err);
    res.status(500).json({ message: 'Error al reabastecer productos', error: err.message });
  }
});

export default router;
