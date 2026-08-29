require('dotenv').config();
const express = require('express');

const pool = require('./src/db');
const devRouter = require('./src/routes/dev');
const familiesRouter = require('./src/routes/families');
const childrenRouter = require('./src/routes/children');
const pairingRouter = require('./src/routes/pairing');

const app = express();
const PORT = 3000;
const HOST = '127.0.0.1';

app.use(express.json());

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

app.use('/dev', devRouter);
app.use('/families', familiesRouter);
app.use('/children', childrenRouter);
app.use('/pairing', pairingRouter);

app.listen(PORT, HOST, () => {
  console.log(`poryadkin-api listening on ${HOST}:${PORT}`);
});
