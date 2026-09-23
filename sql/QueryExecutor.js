// sql/QueryExecutor.js
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const dns = require('node:dns');

dns.setDefaultResultOrder('ipv4first');

const pools = new Map();

function buildSslConfig() {
  const caPath = process.env.DB_SSL_CA_PATH;
  if (caPath) {
    return { ca: fs.readFileSync(caPath), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

const sslConfig = buildSslConfig();

function getPool(dbName) {
  if (!dbName) throw new Error('QueryExecutor: tenantId/dbName is required');

  if (pools.has(dbName)) return pools.get(dbName);

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: dbName,
    ssl: sslConfig,
    decimalNumbers: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Without an explicit bound, a silently-dropped connection (a firewall/VPN
    // issue rather than an actively refused one) can hang for minutes on some
    // networks/OSes instead of failing fast with a clear error -- a manual run
    // then just spins forever with no feedback. 10s is generous for a reachable
    // DB and short enough that a genuine network problem surfaces quickly.
    connectTimeout: 10000
  });

  pools.set(dbName, pool);
  return pool;
}

const DEFAULT_QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS) || 20000;

// connectTimeout above only bounds the TCP handshake phase. A connection that
// succeeds but then hangs mid-query (a frozen socket, a silently-dropped packet
// after the handshake, a lock wait) has no bound at all otherwise -- this race
// guarantees execute() always settles, so a manual run in the UI fails with a
// clear error instead of spinning forever regardless of where the hang occurs.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

    const [rows] = await withTimeout(
      pool.query(querySpec.sql, params),
      DEFAULT_QUERY_TIMEOUT_MS,
      `QueryExecutor: query timed out after ${DEFAULT_QUERY_TIMEOUT_MS}ms (tenant=${tenantId})`
    );
    return { rows };
  }
};
