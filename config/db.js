// import mysql from 'mysql2/promise';


// const pool = mysql.createPool({
//   host: process.env.DB_HOST || "localhost",
//   user: process.env.DB_USER || "root",
//   password: process.env.DB_PASSWORD || "",
//   database: process.env.DB_NAME || "mymoney",
//   port: process.env.DB_PORT || 3306,
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0,
//   decimalNumbers: true
// });

// export async function query(sql, params = []) {
//   try {
//     const [rows] = await pool.execute(sql, params);
//     return rows;
//   } catch (error) {
//     console.error("Database query error:", error);
//     throw error;
//   }
// }

// export function getPool() {
//   return pool;
// }


import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: "shortline.proxy.rlwy.net",
  user: "root",
  password: "UzkNQbiofsskGdnFflYVuEevkzKbTxVH",
  database: "railway",
  port: 59203,
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
