const express = require('express');
const { randomUUID } = require('crypto');

const pool = require('../db');
const { authenticate, requireChildParam } = require('../middleware/auth');

const router = express.Router();

// Every route below is /:childId/... — a child token must match that exact
// child; a parent token must own it through family membership. Mounted
// with the ':childId' path (not a bare .use()) so Express actually binds
// req.params.childId before these run.
router.use('/:childId', authenticate, requireChildParam);

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

router.get('/:childId/shop', async (req, res) => {
  try {
    const { childId } = req.params;

    const child = await pool.query('SELECT id, family_id FROM children WHERE id = $1', [childId]);
    if (child.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'child not found' });
    }
    const familyId = child.rows[0].family_id;

    // SUM(integer) comes back as bigint, and node-postgres returns bigint as a
    // string to avoid silent precision loss — cast to Number explicitly rather
    // than passing the raw driver value straight into the JSON response.
    const balanceResult = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) AS balance FROM coin_transactions WHERE child_id = $1',
      [childId]
    );
    const balance = Number(balanceResult.rows[0].balance);

    const rewardsResult = await pool.query(
      `SELECT id, title, coin_cost, rarity_tier
       FROM rewards
       WHERE family_id = $1 AND is_active = true
       ORDER BY coin_cost ASC`,
      [familyId]
    );

    res.json({ balance, rewards: rewardsResult.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/:childId/rewards/:rewardId/redeem', async (req, res) => {
  const client = await pool.connect();
  try {
    const { childId, rewardId } = req.params;

    await client.query('BEGIN');

    // Serializes concurrent redemptions for the same child (double-tap, or two
    // devices redeeming at once) so the balance check below can never race with
    // another redemption's INSERT. Held until COMMIT/ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [childId]);

    const child = await client.query('SELECT id FROM children WHERE id = $1', [childId]);
    if (child.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', message: 'child not found' });
    }

    // Reward must be active AND belong to this child's own family.
    const reward = await client.query(
      `SELECT r.id, r.coin_cost
       FROM rewards r
       JOIN children c ON c.family_id = r.family_id
       WHERE r.id = $1 AND c.id = $2 AND r.is_active = true`,
      [rewardId, childId]
    );
    if (reward.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ status: 'error', message: 'reward not found' });
    }
    const coinCost = reward.rows[0].coin_cost;

    const balanceResult = await client.query(
      'SELECT COALESCE(SUM(amount), 0) AS balance FROM coin_transactions WHERE child_id = $1',
      [childId]
    );
    const balance = Number(balanceResult.rows[0].balance);

    if (coinCost > balance) {
      await client.query('ROLLBACK');
      return res.status(409).json({ status: 'error', message: 'Недостаточно монет' });
    }

    const transactionId = randomUUID();
    await client.query(
      `INSERT INTO coin_transactions (id, child_id, reward_id, amount, reason)
       VALUES ($1, $2, $3, $4, 'reward_redemption')`,
      [transactionId, childId, rewardId, -coinCost]
    );

    await client.query('COMMIT');

    res.status(201).json({
      status: 'ok',
      reward_id: rewardId,
      coins_spent: coinCost,
      new_balance: balance - coinCost,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ status: 'error', message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
