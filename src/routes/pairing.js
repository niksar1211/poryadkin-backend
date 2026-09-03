const express = require('express');
const { randomUUID, randomBytes } = require('crypto');

const pool = require('../db');
const { hashToken } = require('../middleware/auth');

const router = express.Router();

router.post('/redeem', async (req, res) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) {
      return res.status(400).json({ status: 'error', message: 'code is required' });
    }

    // Atomic: claim the code only if it's still valid, in one statement,
    // so two simultaneous redeems of the same code can't both succeed.
    const redeemed = await pool.query(
      `UPDATE pairing_codes
       SET used_at = now()
       WHERE code = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING child_id`,
      [code]
    );

    if (redeemed.rowCount > 0) {
      const child = await pool.query('SELECT id, family_id, name FROM children WHERE id = $1', [
        redeemed.rows[0].child_id,
      ]);
      const c = child.rows[0];

      const token = randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO device_tokens (id, token_hash, family_id, child_id, role)
         VALUES ($1, $2, $3, $4, 'child')`,
        [randomUUID(), hashToken(token), c.family_id, c.id]
      );

      return res.json({ child_id: c.id, family_id: c.family_id, child_name: c.name, token });
    }

    // Nothing got claimed above — look the code up to say why (404 vs 410).
    const existing = await pool.query(
      'SELECT 1 FROM pairing_codes WHERE code = $1 ORDER BY created_at DESC LIMIT 1',
      [code]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'code not found' });
    }

    return res.status(410).json({ status: 'error', message: 'code expired or already used' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
