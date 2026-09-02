const express = require('express');
const { randomUUID } = require('crypto');

const pool = require('../db');

const router = express.Router();

const RARITY_TIERS = ['Обычная', 'Редкая', 'Особая', 'Легендарная'];

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

module.exports = router;
