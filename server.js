const express = require('express');

const app = express();
const PORT = 3000;
const HOST = '127.0.0.1';

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, HOST, () => {
  console.log(`poryadkin-api listening on ${HOST}:${PORT}`);
});
