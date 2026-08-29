const fs = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(path.join(os.homedir(), '.postgresql', 'root.crt')).toString(),
  },
});

module.exports = pool;
