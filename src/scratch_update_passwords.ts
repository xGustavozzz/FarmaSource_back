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
    
    // Update all passwords to the bcrypt hash for 'admin123'
    const newHash = '$2b$12$RsWdInyGjR6xCovs1F2q3uGR4s8y8o8xPjZHXAO4DWtPBOh/wqHjG';
    const result = await connection.execute(
      `UPDATE USUARIOS_APP SET USU_PASSWORD_HASH = :newHash`,
      { newHash },
      { autoCommit: true }
    );
    console.log('Updated passwords rows:', result.rowsAffected);

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
