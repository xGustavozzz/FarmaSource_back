import { Router } from 'express';
import { executeQuery } from '../config/db';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { authMiddleware } from '../middleware/security';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const sql = `
      SELECT u.USU_ID, u.USU_USERNAME, u.USU_EMAIL, u.USU_ROL, u.USU_PASSWORD_HASH,
             u.USU_SECRET_2FA, u.USU_IS_2FA_ENABLED,
             e.EMP_NOMBRE, e.EMP_APELLIDO
      FROM USUARIOS_APP u
      LEFT JOIN EMPLEADOS e ON u.USU_EMP_ID = e.EMP_ID
      WHERE u.USU_USERNAME = :username AND u.USU_ACTIVO = 'S'
    `;
    const result = await executeQuery<any>(sql, { username });

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado o inactivo.' });
    }

    const user = result.rows[0];

    const passwordMatch = bcrypt.compareSync(password, user.USU_PASSWORD_HASH);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Contraseña incorrecta.' });
    }

    // Check if 2FA is enabled
    if (user.USU_IS_2FA_ENABLED === 'S' && user.USU_SECRET_2FA) {
      return res.json({
        requires2FA: true,
        userId: user.USU_ID,
        message: 'Se requiere código de autenticación de dos factores'
      });
    }

    // Log audit
    try {
      await executeQuery(`
        INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
        VALUES ('USUARIOS_APP', 'UPDATE', :username, 'Usuario inició sesión exitosamente', :username, SYSTIMESTAMP)
      `, { username: user.USU_USERNAME });
    } catch (auditErr) {
      console.error('Failed to write audit log for login:', auditErr);
    }

    res.json({
      requires2FA: false,
      currentUser: user.USU_USERNAME,
      currentRole: user.USU_ROL,
      user: {
        id: user.USU_ID,
        username: user.USU_USERNAME,
        email: user.USU_EMAIL,
        role: user.USU_ROL,
        fullName: `${user.EMP_NOMBRE || ''} ${user.EMP_APELLIDO || ''}`.trim(),
        is2faEnabled: user.USU_IS_2FA_ENABLED === 'S'
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Error interno del servidor', error: err.message });
  }
});

router.post('/verify-2fa', async (req, res) => {
  const { userId, token } = req.body;
  try {
    if (!userId || !token) {
      return res.status(400).json({ message: 'userId y token son requeridos' });
    }
    if (!/^\d{6}$/.test(token)) {
      return res.status(400).json({ message: 'El código 2FA debe ser un número de 6 dígitos' });
    }

    const result = await executeQuery<any>(
      `SELECT u.*, e.EMP_NOMBRE, e.EMP_APELLIDO
       FROM USUARIOS_APP u
       LEFT JOIN EMPLEADOS e ON u.USU_EMP_ID = e.EMP_ID
       WHERE u.USU_ID = :userId AND u.USU_ACTIVO = 'S'`,
      { userId }
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }

    const user = result.rows[0];

    if (user.USU_IS_2FA_ENABLED !== 'S' || !user.USU_SECRET_2FA) {
      return res.status(400).json({ message: '2FA no está habilitado para este usuario' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.USU_SECRET_2FA,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!verified) {
      return res.status(401).json({ message: 'Código 2FA inválido' });
    }

    // Log audit
    try {
      await executeQuery(`
        INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
        VALUES ('USUARIOS_APP', 'UPDATE', :username, '2FA verificado - inicio de sesión completado', :username, SYSTIMESTAMP)
      `, { username: user.USU_USERNAME });
    } catch (auditErr) {
      console.error('Failed to write audit log for 2FA:', auditErr);
    }

    res.json({
      currentUser: user.USU_USERNAME,
      currentRole: user.USU_ROL,
      user: {
        id: user.USU_ID,
        username: user.USU_USERNAME,
        email: user.USU_EMAIL,
        role: user.USU_ROL,
        fullName: `${user.EMP_NOMBRE || ''} ${user.EMP_APELLIDO || ''}`.trim(),
        is2faEnabled: true
      }
    });
  } catch (err: any) {
    console.error('2FA verification error:', err);
    res.status(500).json({ message: 'Error interno del servidor', error: err.message });
  }
});

router.post('/generate-2fa-secret', authMiddleware, async (req: any, res) => {
  try {
    const username = req.headers['x-user-username'] as string;
    if (!username) {
      return res.status(401).json({ message: 'Usuario no autenticado' });
    }

    const userRes = await executeQuery<any>(
      `SELECT * FROM USUARIOS_APP WHERE USU_USERNAME = :username AND USU_ACTIVO = 'S'`,
      { username }
    );
    if (!userRes.rows || userRes.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const user = userRes.rows[0];

    if (user.USU_IS_2FA_ENABLED === 'S') {
      return res.status(400).json({ message: '2FA ya está habilitado' });
    }

    const tempSecret = speakeasy.generateSecret({
      name: `FarmaSecure (${user.USU_EMAIL || user.USU_USERNAME})`,
      issuer: 'FarmaSecure'
    });

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await executeQuery(
      `UPDATE USUARIOS_APP SET USU_TEMP_SECRET_2FA = :secret, USU_TEMP_SECRET_EXPIRES_AT = :expires WHERE USU_USERNAME = :username`,
      {
        secret: tempSecret.base32,
        expires: expiresAt,
        username
      }
    );

    const qrCodeUrl = await qrcode.toDataURL(tempSecret.otpauth_url);

    res.json({
      tempSecret: tempSecret.base32,
      qrCodeUrl,
      expiresAt,
      message: 'Escanea el código QR con tu app autenticadora'
    });
  } catch (err: any) {
    console.error('Error generating 2FA secret:', err);
    res.status(500).json({ message: 'Error al generar secreto 2FA', error: err.message });
  }
});

router.post('/enable-2fa', authMiddleware, async (req: any, res) => {
  try {
    const username = req.headers['x-user-username'] as string;
    const { token } = req.body;

    if (!token || !/^\d{6}$/.test(token)) {
      return res.status(400).json({ message: 'Código 2FA inválido (debe ser 6 dígitos)' });
    }

    const userRes = await executeQuery<any>(
      `SELECT * FROM USUARIOS_APP WHERE USU_USERNAME = :username AND USU_ACTIVO = 'S'`,
      { username }
    );
    if (!userRes.rows || userRes.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const user = userRes.rows[0];

    if (!user.USU_TEMP_SECRET_2FA) {
      return res.status(400).json({ message: 'No hay secreto temporal. Genera uno primero.' });
    }

    if (new Date() > new Date(user.USU_TEMP_SECRET_EXPIRES_AT)) {
      await executeQuery(
        `UPDATE USUARIOS_APP SET USU_TEMP_SECRET_2FA = NULL, USU_TEMP_SECRET_EXPIRES_AT = NULL WHERE USU_USERNAME = :username`,
        { username }
      );
      return res.status(400).json({ message: 'El secreto temporal ha expirado. Genera uno nuevo.' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.USU_TEMP_SECRET_2FA,
      encoding: 'base32',
      token,
      window: 1
    });

    if (!verified) {
      return res.status(401).json({ message: 'Código 2FA inválido' });
    }

    await executeQuery(
      `UPDATE USUARIOS_APP SET
         USU_SECRET_2FA = :secret,
         USU_IS_2FA_ENABLED = 'S',
         USU_TEMP_SECRET_2FA = NULL,
         USU_TEMP_SECRET_EXPIRES_AT = NULL
       WHERE USU_USERNAME = :username`,
      { secret: user.USU_TEMP_SECRET_2FA, username }
    );

    // Audit log
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('USUARIOS_APP', 'UPDATE', :username, '2FA habilitado exitosamente', :username, SYSTIMESTAMP)
    `, { username });

    res.json({ message: 'Autenticación de dos factores habilitada exitosamente' });
  } catch (err: any) {
    console.error('Error enabling 2FA:', err);
    res.status(500).json({ message: 'Error al habilitar 2FA', error: err.message });
  }
});

router.post('/disable-2fa', authMiddleware, async (req: any, res) => {
  try {
    const username = req.headers['x-user-username'] as string;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: 'Contraseña requerida para deshabilitar 2FA' });
    }

    const userRes = await executeQuery<any>(
      `SELECT * FROM USUARIOS_APP WHERE USU_USERNAME = :username AND USU_ACTIVO = 'S'`,
      { username }
    );
    if (!userRes.rows || userRes.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const user = userRes.rows[0];

    const passwordMatch = bcrypt.compareSync(password, user.USU_PASSWORD_HASH);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Contraseña incorrecta' });
    }

    await executeQuery(
      `UPDATE USUARIOS_APP SET
         USU_SECRET_2FA = NULL,
         USU_IS_2FA_ENABLED = 'N',
         USU_TEMP_SECRET_2FA = NULL,
         USU_TEMP_SECRET_EXPIRES_AT = NULL
       WHERE USU_USERNAME = :username`,
      { username }
    );

    // Audit log
    await executeQuery(`
      INSERT INTO AUDIT_LOGS (AUD_TABLA, AUD_ACCION, AUD_PK_VALOR, AUD_DATOS_DSP, AUD_USUARIO, AUD_FECHA)
      VALUES ('USUARIOS_APP', 'UPDATE', :username, '2FA deshabilitado', :username, SYSTIMESTAMP)
    `, { username });

    res.json({ message: 'Autenticación de dos factores deshabilitada' });
  } catch (err: any) {
    console.error('Error disabling 2FA:', err);
    res.status(500).json({ message: 'Error al deshabilitar 2FA', error: err.message });
  }
});

router.get('/2fa-status', authMiddleware, async (req: any, res) => {
  try {
    const username = req.headers['x-user-username'] as string;
    const userRes = await executeQuery<any>(
      `SELECT USU_SECRET_2FA, USU_IS_2FA_ENABLED FROM USUARIOS_APP WHERE USU_USERNAME = :username AND USU_ACTIVO = 'S'`,
      { username }
    );
    if (!userRes.rows || userRes.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const user = userRes.rows[0];
    res.json({
      isEnabled: user.USU_IS_2FA_ENABLED === 'S',
      hasSecret: !!user.USU_SECRET_2FA
    });
  } catch (err: any) {
    console.error('Error checking 2FA status:', err);
    res.status(500).json({ message: 'Error al verificar estado 2FA', error: err.message });
  }
});

router.post('/change-password', authMiddleware, async (req: any, res) => {
  const { oldPassword, newPassword } = req.body;
  const username = req.headers['x-user-username'] as string;

  if (!username) {
    return res.status(401).json({ message: 'Usuario no autenticado.' });
  }

  try {
    const userRes = await executeQuery<any>(
      `SELECT USU_PASSWORD_HASH FROM USUARIOS_APP WHERE USU_USERNAME = :username AND USU_ACTIVO = 'S'`,
      { username }
    );
    const user = userRes.rows?.[0];
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const match = bcrypt.compareSync(oldPassword, user.USU_PASSWORD_HASH);
    if (!match) {
      return res.status(400).json({ message: 'La contraseña actual es incorrecta.' });
    }

    const newHash = bcrypt.hashSync(newPassword, 12);

    await executeQuery(
      `UPDATE USUARIOS_APP SET USU_PASSWORD_HASH = :newHash WHERE USU_USERNAME = :username`,
      { newHash, username }
    );

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
