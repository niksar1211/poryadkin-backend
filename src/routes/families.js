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

module.exports = router;
