const express = require('express');
const { randomUUID } = require('crypto');

const pool = require('../db');
const { authenticate, requireFamilyParam } = require('../middleware/auth');

const router = express.Router();

const RARITY_TIERS = ['Обычная', 'Редкая', 'Особая', 'Легендарная'];

// Every route below is /:familyId/... — the token must belong to that
// exact family. Mounted with the ':familyId' path (not a bare .use()) so
// Express actually binds req.params.familyId before these run — an unpath'd
// .use() runs before route matching, leaving req.params empty.
router.use('/:familyId', authenticate, requireFamilyParam);

router.post('/:familyId/children', async (req, res) => {
  try {
    const { familyId } = req.params;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

    if (!name) {
      return res.status(400).json({ status: 'error', message: 'name is required' });
    }

    const family = await pool.query('SELECT id FROM families WHERE id = $1', [familyId]);
    if (family.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'family not found' });
    }

    const id = randomUUID();
    await pool.query('INSERT INTO children (id, family_id, name) VALUES ($1, $2, $3)', [
      id,
      familyId,
      name,
    ]);
    res.status(201).json({ child_id: id });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/:familyId/children', async (req, res) => {
  try {
    const { familyId } = req.params;
    const result = await pool.query(
      'SELECT id, name FROM children WHERE family_id = $1 ORDER BY created_at ASC',
      [familyId]
    );
    res.json({ children: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/:familyId/children/:childId/tasks', async (req, res) => {
  try {
    const { familyId, childId } = req.params;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const coinValue = Number(req.body?.coin_value);
    const recurrence = req.body?.recurrence === 'daily' ? 'daily' : 'one_time';

    if (!title) {
      return res.status(400).json({ status: 'error', message: 'title is required' });
    }
    if (!Number.isInteger(coinValue) || coinValue <= 0) {
      return res
        .status(400)
        .json({ status: 'error', message: 'coin_value must be a positive integer' });
    }

    const child = await pool.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [
      childId,
      familyId,
    ]);
    if (child.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'child not found in this family' });
    }

    const id = randomUUID();
    const isTemplate = recurrence === 'daily';

    // 'daily' creates only the template row (is_template=true, occurrence_date
    // NULL) — it's never shown to the child directly. GET /children/:childId/tasks
    // generates the actual per-day occurrences from it on read.
    await pool.query(
      `INSERT INTO tasks (id, child_id, family_id, title, coin_value, status, recurrence, is_template)
       VALUES ($1, $2, $3, $4, $5, 'assigned', $6, $7)`,
      [id, childId, familyId, title, coinValue, recurrence, isTemplate]
    );

    res.status(201).json({ task_id: id });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/:familyId/tasks', async (req, res) => {
  try {
    const { familyId } = req.params;
    const result = await pool.query(
      `SELECT t.id, t.child_id, c.name AS child_name, t.title, t.coin_value, t.status,
              t.created_at, t.completed_at, t.confirmed_at
       FROM tasks t
       JOIN children c ON c.id = t.child_id
       WHERE t.family_id = $1 AND t.is_template = false
       ORDER BY t.created_at ASC`,
      [familyId]
    );
    res.json({ tasks: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/:familyId/tasks/pending-confirmation', async (req, res) => {
  try {
    const { familyId } = req.params;
    const result = await pool.query(
      `SELECT t.id, t.child_id, c.name AS child_name, t.title, t.coin_value, t.status,
              t.created_at, t.completed_at
       FROM tasks t
       JOIN children c ON c.id = t.child_id
       WHERE t.family_id = $1 AND t.status = 'pending_confirmation'
       ORDER BY t.completed_at ASC`,
      [familyId]
    );
    res.json({ tasks: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/:familyId/rewards', async (req, res) => {
  try {
    const { familyId } = req.params;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const coinCost = Number(req.body?.coin_cost);
    const rarityTier = req.body?.rarity_tier;

    if (!title) {
      return res.status(400).json({ status: 'error', message: 'title is required' });
    }
    if (!Number.isInteger(coinCost) || coinCost <= 0) {
      return res
        .status(400)
        .json({ status: 'error', message: 'coin_cost must be a positive integer' });
    }
    if (!RARITY_TIERS.includes(rarityTier)) {
      return res
        .status(400)
        .json({ status: 'error', message: `rarity_tier must be one of: ${RARITY_TIERS.join(', ')}` });
    }

    const family = await pool.query('SELECT id FROM families WHERE id = $1', [familyId]);
    if (family.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'family not found' });
    }

    const id = randomUUID();
    await pool.query(
      `INSERT INTO rewards (id, family_id, title, coin_cost, rarity_tier)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, familyId, title, coinCost, rarityTier]
    );

    res.status(201).json({ reward_id: id });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/:familyId/rewards', async (req, res) => {
  try {
    const { familyId } = req.params;
    const result = await pool.query(
      `SELECT id, title, coin_cost, rarity_tier, is_active, created_at
       FROM rewards
       WHERE family_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [familyId]
    );
    res.json({ rewards: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Partial update of title/coin_cost only. rarity_tier and is_active are
// intentionally out of scope here — they have (or will have) their own
// dedicated endpoints/logic.
router.patch('/:familyId/rewards/:rewardId', async (req, res) => {
  try {
    const { familyId, rewardId } = req.params;
    const hasTitle = typeof req.body?.title === 'string';
    const hasCoinCost = req.body?.coin_cost !== undefined;

    if (!hasTitle && !hasCoinCost) {
      return res.status(400).json({ status: 'error', message: 'nothing to update' });
    }

    const title = hasTitle ? req.body.title.trim() : undefined;
    if (hasTitle && !title) {
      return res.status(400).json({ status: 'error', message: 'title is required' });
    }

    const coinCost = hasCoinCost ? Number(req.body.coin_cost) : undefined;
    if (hasCoinCost && (!Number.isInteger(coinCost) || coinCost <= 0)) {
      return res
        .status(400)
        .json({ status: 'error', message: 'coin_cost must be a positive integer' });
    }

    const setClauses = [];
    const values = [];
    let i = 1;
    if (hasTitle) {
      setClauses.push(`title = $${i++}`);
      values.push(title);
    }
    if (hasCoinCost) {
      setClauses.push(`coin_cost = $${i++}`);
      values.push(coinCost);
    }
    values.push(rewardId, familyId);

    const result = await pool.query(
      `UPDATE rewards
       SET ${setClauses.join(', ')}
       WHERE id = $${i++} AND family_id = $${i++} AND is_active = true
       RETURNING id, title, coin_cost, rarity_tier, is_active, created_at`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'reward not found' });
    }

    res.json({ reward: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Soft-delete only — coin_transactions.reward_id points at rewards, so a
// redeemed-in-the-past reward must keep existing for that history to still
// make sense. Deactivating just hides it from the parent's list and the
// child's shop (both already filter on is_active = true).
router.patch('/:familyId/rewards/:rewardId/deactivate', async (req, res) => {
  try {
    const { familyId, rewardId } = req.params;
    const result = await pool.query(
      `UPDATE rewards
       SET is_active = false
       WHERE id = $1 AND family_id = $2 AND is_active = true
       RETURNING id`,
      [rewardId, familyId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'reward not found' });
    }
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
