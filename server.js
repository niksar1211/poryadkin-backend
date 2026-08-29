const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = 3000;
const HOST = '127.0.0.1';

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/health/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', db_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`poryadkin-api listening on ${HOST}:${PORT}`);
});
