import oracledb from 'oracledb';
import dotenv from 'dotenv';

dotenv.config();

export async function initDb() {
  try {
    await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECT_STRING,
      poolMin: 1,
      poolMax: 10,
      poolIncrement: 1,
    });
    console.log('Successfully connected to Oracle Database Pool (Thin Mode)');
  } catch (err) {
    console.error('Error initializing Oracle Database connection pool:', err);
    throw err;
  }
}

export async function executeQuery<T>(
  sql: string,
  binds: oracledb.BindParameters = {},
  options: oracledb.ExecuteOptions = { autoCommit: true, outFormat: oracledb.OUT_FORMAT_OBJECT }
): Promise<oracledb.Result<T>> {
  let connection;
  try {
    connection = await oracledb.getConnection();
    const result = await connection.execute<T>(sql, binds, options);
    return result;
  } catch (err) {
    console.error(`Database executeQuery error on SQL: ${sql}`, err);
    throw err;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('Error closing connection:', err);
      }
    }
  }
}
