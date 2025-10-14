import mysql from 'mysql2/promise';


const pool = mysql.createPool({

  host: "localhost",
  user: "root",
  password: "", 
  database: "mymoney",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
});

export async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error("Database query error:", error);
    throw error;
  }
}

export function getPool() {
  return pool;
}
