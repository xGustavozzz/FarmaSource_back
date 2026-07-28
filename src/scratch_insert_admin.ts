import oracledb from 'oracledb';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  let connection;
  try {
    connection = await oracledb.getConnection({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECT_STRING,
    });
    console.log('Successfully connected to Oracle Database');
    
    // Check if there is an ADMINISTRADOR cargo employee
    const empRes = await connection.execute<any>(
      `SELECT EMP_ID, EMP_NOMBRE, EMP_APELLIDO FROM EMPLEADOS WHERE EMP_CARGO = 'ADMINISTRADOR'`
    );
    let empId: number | null = null;
    if (empRes.rows && empRes.rows.length > 0) {
      empId = (empRes.rows[0] as any).EMP_ID || (empRes.rows[0] as any)[0];
      console.log('Found existing admin employee:', empRes.rows[0]);
    } else {
      // Insert a new admin employee
      const insertEmpSql = `
        INSERT INTO EMPLEADOS (EMP_NOMBRE, EMP_APELLIDO, EMP_CEDULA, EMP_CARGO, EMP_TELEFONO, EMP_EMAIL, EMP_SALARIO, EMP_ACTIVO, EMP_CREATED_AT, EMP_UPDATED_AT)
        VALUES ('Admin', 'FarmaSecure', '9999999999', 'ADMINISTRADOR', '0999999999', 'admin@farmasecure.com', 1500, 'S', SYSTIMESTAMP, SYSTIMESTAMP)
        RETURNING EMP_ID INTO :id
      `;
      const result = await connection.execute<any>(
        insertEmpSql,
        { id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT } }
      );
      const binds = result.outBinds as any;
      empId = binds?.id?.[0] || binds?.id;
      console.log('Created new admin employee with ID:', empId);
    }
    
    // Check if user 'admin.secure' exists in USUARIOS_APP
    const userRes = await connection.execute<any>(
      `SELECT USU_ID FROM USUARIOS_APP WHERE USU_USERNAME = 'admin.secure'`
    );
    
    const adminHash = '$2b$12$RsWdInyGjR6xCovs1F2q3uGR4s8y8o8xPjZHXAO4DWtPBOh/wqHjG'; // bcrypt for 'admin123'
    if (userRes.rows && userRes.rows.length > 0) {
      console.log('admin.secure user already exists. Updating its password hash.');
      await connection.execute(
        `UPDATE USUARIOS_APP SET USU_PASSWORD_HASH = :adminHash, USU_ACTIVO = 'S', USU_ROL = 'ADMINISTRADOR' WHERE USU_USERNAME = 'admin.secure'`,
        { adminHash }
      );
    } else {
      // Insert new admin user
      console.log('Creating admin.secure user.');
      const insertUserSql = `
        INSERT INTO USUARIOS_APP (USU_EMP_ID, USU_USERNAME, USU_EMAIL, USU_PASSWORD_HASH, USU_ROL, USU_ACTIVO, USU_CREATED_AT)
        VALUES (:empId, 'admin.secure', 'admin@farmasecure.com', :adminHash, 'ADMINISTRADOR', 'S', SYSTIMESTAMP)
      `;
      await connection.execute(insertUserSql, { empId, adminHash });
    }
    
    await connection.commit();
    console.log('Transaction committed successfully');

  } catch (err) {
    console.error('Error executing query:', err);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error(err);
      }
    }
  }
}

run();
