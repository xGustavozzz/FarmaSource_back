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
    
    // Query USUARIOS_APP
    const usersRes = await connection.execute(`
      SELECT u.USU_ID, u.USU_USERNAME, u.USU_ROL, u.USU_ACTIVO, e.EMP_NOMBRE, e.EMP_APELLIDO
      FROM USUARIOS_APP u
      LEFT JOIN EMPLEADOS e ON u.USU_EMP_ID = e.EMP_ID
    `);
    console.log('USUARIOS_APP:');
    usersRes.rows?.forEach((row: any) => {
      console.log(`- Username: ${row[1]} | Role: ${row[2]} | Active: ${row[3]} | Employee: ${row[4]} ${row[5]}`);
    });

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
