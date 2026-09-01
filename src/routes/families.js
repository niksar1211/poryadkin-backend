const express = require('express');
const { randomUUID } = require('crypto');

const pool = require('../db');

const router = express.Router();

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
    await pool.query(
      `INSERT INTO tasks (id, child_id, family_id, title, coin_value, status)
       VALUES ($1, $2, $3, $4, $5, 'assigned')`,
      [id, childId, familyId, title, coinValue]
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

module.exports = router;
