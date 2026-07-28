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
    
    // Describe CLIENTES table
    const result = await connection.execute(`
      SELECT column_name, data_type, nullable, data_length
      FROM user_tab_cols
      WHERE table_name = 'CLIENTES'
    `);
    console.log('CLIENTES Columns:');
    result.rows?.forEach((row: any) => {
      console.log(`- ${row[0]}: ${row[1]} (Nullable: ${row[2]}, Length: ${row[3]})`);
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
