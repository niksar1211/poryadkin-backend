const express = require('express');
const { randomUUID } = require('crypto');

const pool = require('../db');

const router = express.Router();

router.post('/:childId/pairing-code', async (req, res) => {
  try {
    const { childId } = req.params;

    const child = await pool.query('SELECT id FROM children WHERE id = $1', [childId]);
    if (child.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'child not found' });
    }

    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      'INSERT INTO pairing_codes (id, child_id, code, expires_at) VALUES ($1, $2, $3, $4)',
      [id, childId, code, expiresAt]
    );

    res.status(201).json({ code, expires_at: expiresAt.toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/:childId/tasks', async (req, res) => {
  try {
    const { childId } = req.params;

    const child = await pool.query('SELECT id FROM children WHERE id = $1', [childId]);
    if (child.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'child not found' });
    }

    const result = await pool.query(
      `SELECT id, title, coin_value, status, created_at, completed_at, confirmed_at
       FROM tasks
       WHERE child_id = $1
       ORDER BY created_at ASC`,
      [childId]
    );

    res.json({ tasks: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
