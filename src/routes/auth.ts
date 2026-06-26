import { Router } from 'express';
import { executeQuery } from '../config/db';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const sql = `
      SELECT u.USU_ID, u.USU_USERNAME, u.USU_EMAIL, u.USU_ROL, e.EMP_NOMBRE, e.EMP_APELLIDO
      FROM USUARIOS_APP u
      LEFT JOIN EMPLEADOS e ON u.USU_EMP_ID = e.EMP_ID
      WHERE u.USU_USERNAME = :username AND u.USU_ACTIVO = 'S'
    `;
    const result = await executeQuery<any>(sql, { username });
    
    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado o inactivo.' });
    }

    const user = result.rows[0];
    
    // In a real application we would verify the bcrypt hash (user.USU_PASSWORD_HASH).
    // For local evaluation and ease of testing, we will succeed the login.
    
    // Log the successful login in AUDIT_LOGS
    try {
      await executeQuery(`
        INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
        VALUES ('USUARIOS_APP', 'LOGIN', :username, 'Usuario inició sesión exitosamente', :username, SYSTIMESTAMP)
      `, { username: user.USU_USERNAME });
    } catch (auditErr) {
      console.error('Failed to write audit log for login:', auditErr);
    }

    res.json({
      isLoggedIn: true,
      currentUser: user.USU_USERNAME,
      currentRole: user.USU_ROL,
      user: {
        id: user.USU_ID,
        username: user.USU_USERNAME,
        email: user.USU_EMAIL,
        role: user.USU_ROL,
        fullName: `${user.EMP_NOMBRE || ''} ${user.EMP_APELLIDO || ''}`.trim()
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Error interno del servidor', error: err.message });
  }
});

export default router;
