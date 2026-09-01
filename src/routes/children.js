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

    // Day boundary for daily tasks is 23:00 Moscow time, not midnight: shifting
    // "now" forward by 1 hour before truncating to a date means the reset lands
    // at 23:00 MSK, which is ~8:00 local time in Russia's easternmost regions
    // (Kamchatka, Chukotka, UTC+12) instead of falling in the middle of their day.
    //
    // Atomic per-row: ON CONFLICT (template_id, occurrence_date) DO NOTHING means
    // two concurrent requests generating "today" for the same template can't both
    // succeed — no separate existence check, no race window.
    await pool.query(
      `INSERT INTO tasks (
         id, child_id, family_id, title, coin_value, status,
         recurrence, is_template, template_id, occurrence_date
       )
       SELECT
         gen_random_uuid(), t.child_id, t.family_id, t.title, t.coin_value, 'assigned',
         'daily', false, t.id,
         ((NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 hour')::date
       FROM tasks t
       WHERE t.child_id = $1 AND t.is_template = true AND t.recurrence = 'daily'
       ON CONFLICT (template_id, occurrence_date) DO NOTHING`,
      [childId]
    );

    const result = await pool.query(
      `SELECT id, title, coin_value, status, created_at, completed_at, confirmed_at
       FROM tasks
       WHERE child_id = $1 AND is_template = false
       ORDER BY created_at ASC`,
      [childId]
    );

    res.json({ tasks: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
