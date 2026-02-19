const mysql = require("mysql2/promise");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

let pool;

function getPool() {
  if (pool) return pool;

  const host = requireEnv("DB_HOST");
  const user = requireEnv("DB_USER");
  const password = requireEnv("DB_PASSWORD");
  const database = requireEnv("DB_NAME");
  const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;

  console.log(`Creating MySQL pool with host=${host} user=${user} database=${database} port=${port}`);

  pool = mysql.createPool({
    host,
    user,
    password,
    database,
    port,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });

  return pool;
}

module.exports = { getPool };
