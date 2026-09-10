const express = require('express');
const { randomUUID, randomBytes } = require('crypto');

const pool = require('../db');
const { hashToken } = require('../middleware/auth');
const { computeRarityTier } = require('../utils/rewardTier');

const router = express.Router();

// Every new family starts with these four already in the shop, so it's
// never empty on first open — no parent action needed to seed it.
const STARTER_REWARDS = [
  { title: 'Экранное время 30 минут', coin_cost: 20 },
  { title: 'Лечь спать на час позже', coin_cost: 25 },
  { title: 'Карманные деньги 100 рублей', coin_cost: 60 },
  { title: 'Пицца на ужин', coin_cost: 35 },
  { title: 'Новый смартфон', coin_cost: 5000 },
];

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

    for (const reward of STARTER_REWARDS) {
      await pool.query(
        `INSERT INTO rewards (id, family_id, title, coin_cost, rarity_tier)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), id, reward.title, reward.coin_cost, computeRarityTier(reward.coin_cost)]
      );
    }

    res.status(201).json({ family_id: id, token });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
