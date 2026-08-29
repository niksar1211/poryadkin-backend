const express = require('express');
const { randomUUID } = require('crypto');

const pool = require('../db');

const router = express.Router();

// TEMPORARY / DEV-ONLY endpoint.
// Stands in for real parent registration (VK ID / Yandex ID auth) which doesn't
// exist yet. Delete this route once that flow creates families for real.
router.post('/families', async (req, res) => {
  try {
    const id = randomUUID();
    await pool.query('INSERT INTO families (id) VALUES ($1)', [id]);
    res.status(201).json({ family_id: id });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
