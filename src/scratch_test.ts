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
    
    // Query CIUDADES
    const citiesRes = await connection.execute(`
      SELECT CIU_ID, CIU_NOMBRE, CIU_ACTIVO FROM CIUDADES
    `);
    console.log('CIUDADES:', citiesRes.rows);
    
    // Query CLIENTES to see CLI_CIU_ID values
    const clientsRes = await connection.execute(`
      SELECT CLI_ID, CLI_NOMBRE, CLI_APELLIDO, CLI_CIU_ID FROM CLIENTES
    `);
    console.log('CLIENTES:', clientsRes.rows);

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
