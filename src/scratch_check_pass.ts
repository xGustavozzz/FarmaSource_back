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
    
    const result = await connection.execute(`
      SELECT USU_USERNAME, USU_PASSWORD_HASH, USU_ROL FROM USUARIOS_APP
    `);
    console.log('USUARIOS_APP:');
    result.rows?.forEach((row: any) => {
      console.log(`- User: ${row[0]} | Hash: ${row[1]} | Role: ${row[2]}`);
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
