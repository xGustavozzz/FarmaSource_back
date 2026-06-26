import { Request, Response, NextFunction } from 'express';
import { executeQuery } from '../config/db';

export interface AuthenticatedRequest extends Request {
  user?: {
    username: string;
    role: string;
    fullName?: string;
  };
}

// Helper to normalize role
export function normalizeRole(role: string): string {
  if (!role) return '';
  const r = role.trim().toUpperCase();
  if (r === 'REGENTE FARMACÉUTICO' || r === 'REGENTE' || r === 'FARMACEUTICO') {
    return 'FARMACEUTICO';
  }
  if (r === 'CAJERO' || r === 'VENDEDOR') {
    return 'VENDEDOR';
  }
  return r;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const usernameHeader = req.headers['x-user-username'];
  
  if (!usernameHeader) {
    return res.status(401).json({ message: 'Acceso no autorizado. Falta cabecera x-user-username.' });
  }

  const username = String(usernameHeader).trim();

  try {
    // Query database for user
    const sql = `
      SELECT u.USU_USERNAME, u.USU_ROL, e.EMP_NOMBRE, e.EMP_APELLIDO
      FROM USUARIOS_APP u
      LEFT JOIN EMPLEADOS e ON u.USU_EMP_ID = e.EMP_ID
      WHERE u.USU_USERNAME = :username AND u.USU_ACTIVO = 'S'
    `;
    const result = await executeQuery<any>(sql, { username });

    if (result.rows && result.rows.length > 0) {
      const dbUser = result.rows[0];
      const normalizedRole = normalizeRole(dbUser.USU_ROL);
      (req as any).user = {
        username: dbUser.USU_USERNAME,
        role: normalizedRole,
        fullName: `${dbUser.EMP_NOMBRE || ''} ${dbUser.EMP_APELLIDO || ''}`.trim()
      };
      return next();
    } else {
      return res.status(401).json({ message: 'Usuario no encontrado o inactivo en la base de datos.' });
    }
  } catch (dbErr: any) {
    console.error('Database connection or query failed in authMiddleware:', dbErr);
    return res.status(500).json({ message: 'Error de base de datos en autenticación', error: dbErr.message });
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ message: 'Usuario no autenticado.' });
    }

    const userRole = normalizeRole(user.role);
    const normalizedAllowed = allowedRoles.map(r => normalizeRole(r));

    if (normalizedAllowed.includes(userRole)) {
      return next();
    }

    return res.status(403).json({
      message: `Acceso prohibido para el rol: ${userRole}. Se requiere uno de los siguientes: ${allowedRoles.join(', ')}`
    });
  };
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Error interno del servidor (Manejador Global)',
    error: err.message || String(err)
  });
}

export function validateRequest(schemaFn: (body: any) => string | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errorMsg = schemaFn(req.body);
    if (errorMsg) {
      return res.status(400).json({ message: 'Petición inválida', error: errorMsg });
    }
    next();
  };
}
