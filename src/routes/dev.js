const express = require('express');
const { randomUUID, randomBytes } = require('crypto');

const pool = require('../db');
const { hashToken } = require('../middleware/auth');

const router = express.Router();

// TEMPORARY / DEV-ONLY endpoint.
// Stands in for real parent registration (VK ID / Yandex ID auth) which doesn't
// exist yet. Delete this route once that flow creates families for real.
router.post('/families', async (req, res) => {
  try {
    const id = randomUUID();
    await pool.query('INSERT INTO families (id) VALUES ($1)', [id]);

    const token = randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO device_tokens (id, token_hash, family_id, child_id, role)
       VALUES ($1, $2, $3, NULL, 'parent')`,
      [randomUUID(), hashToken(token), id]
    );

    res.status(201).json({ family_id: id, token });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
