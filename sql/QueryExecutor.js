// sql/QueryExecutor.js
const mysql = require('mysql2/promise');
const dns = require('node:dns');

dns.setDefaultResultOrder('ipv4first');

const pools = new Map();

function getPool(dbName) {
  if (!dbName) throw new Error('QueryExecutor: tenantId/dbName is required');

  if (pools.has(dbName)) return pools.get(dbName);

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: dbName,
    ssl: { rejectUnauthorized: false },
    decimalNumbers: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  pools.set(dbName, pool);
  return pool;
}

module.exports = {
  async execute(querySpec) {
    if (!querySpec?.sql) {
      throw new Error('QueryExecutor.execute: querySpec.sql is required');
    }

    const tenantId = querySpec.meta?.tenantId;
    if (!tenantId) {
      throw new Error('QueryExecutor.execute: querySpec.meta.tenantId is required');
    }

    const pool = getPool(tenantId);
    const params = querySpec.params || [];

    const [rows] = await pool.query(querySpec.sql, params);
    return { rows };
  }
};
