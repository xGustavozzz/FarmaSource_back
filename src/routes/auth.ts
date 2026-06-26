import { Router } from 'express';
import { executeQuery } from '../config/db';
import bcrypt from 'bcryptjs';
import { authMiddleware } from '../middleware/security';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const sql = `
      SELECT u.USU_ID, u.USU_USERNAME, u.USU_EMAIL, u.USU_ROL, u.USU_PASSWORD_HASH, e.EMP_NOMBRE, e.EMP_APELLIDO
      FROM USUARIOS_APP u
      LEFT JOIN EMPLEADOS e ON u.USU_EMP_ID = e.EMP_ID
      WHERE u.USU_USERNAME = :username AND u.USU_ACTIVO = 'S'
    `;
    const result = await executeQuery<any>(sql, { username });
    
    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado o inactivo.' });
    }

    const user = result.rows[0];
    
    // Verify password using bcryptjs
    const passwordMatch = bcrypt.compareSync(password, user.USU_PASSWORD_HASH);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Contraseña incorrecta.' });
    }

    // Log the successful login in AUDIT_LOGS
    try {
      await executeQuery(`
        INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
        VALUES ('USUARIOS_APP', 'UPDATE', :username, 'Usuario inició sesión exitosamente', :username, SYSTIMESTAMP)
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

// POST change password
router.post('/change-password', authMiddleware, async (req: any, res) => {
  const { oldPassword, newPassword } = req.body;
  const username = req.user?.username;

  if (!username) {
    return res.status(401).json({ message: 'Usuario no autenticado.' });
  }

  try {
    // 1. Get current hash
    const userRes = await executeQuery<any>(
      `SELECT USU_PASSWORD_HASH FROM USUARIOS_APP WHERE USU_USERNAME = :username AND USU_ACTIVO = 'S'`,
      { username }
    );
    const user = userRes.rows?.[0];
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    // 2. Verify old password
    const match = bcrypt.compareSync(oldPassword, user.USU_PASSWORD_HASH);
    if (!match) {
      return res.status(400).json({ message: 'La contraseña actual es incorrecta.' });
    }

    // 3. Hash new password
    const newHash = bcrypt.hashSync(newPassword, 12);

    // 4. Update in DB
    await executeQuery(
      `UPDATE USUARIOS_APP SET USU_PASSWORD_HASH = :newHash WHERE USU_USERNAME = :username`,
      { newHash, username }
    );

    // 5. Audit log
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('USUARIOS_APP', 'UPDATE', :username, 'Cambio de contraseña realizado por el usuario', :username, SYSTIMESTAMP)
    `, { username });

    res.json({ message: 'Contraseña actualizada exitosamente.' });
  } catch (err: any) {
    console.error('Error changing password:', err);
    res.status(500).json({ message: 'Error interno al cambiar la contraseña.', error: err.message });
  }
});

export default router;
