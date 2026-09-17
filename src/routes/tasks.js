const express = require('express');
const { randomUUID } = require('crypto');

const pool = require('../db');
const { authenticate, requireTaskOwnership } = require('../middleware/auth');

const router = express.Router();

// Every route below is /:taskId/... — there's no family_id/child_id in the
// URL to compare directly, so requireTaskOwnership resolves ownership by
// looking the task up first. Mounted with the ':taskId' path (not a bare
// .use()) so Express actually binds req.params.taskId before these run.
router.use('/:taskId', authenticate, requireTaskOwnership);

router.patch('/:taskId/complete', async (req, res) => {
  try {
    const { taskId } = req.params;

    const result = await pool.query(
      `UPDATE tasks
       SET status = 'pending_confirmation', completed_at = now()
       WHERE id = $1 AND status IN ('assigned', 'needs_revision')
       RETURNING id`,
      [taskId]
    );

    if (result.rowCount === 0) {
      return res
        .status(409)
        .json({ status: 'error', message: 'task cannot be completed from its current state' });
    }

    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.patch('/:taskId/confirm', async (req, res) => {
  try {
    const { taskId } = req.params;

    // Atomic: only one concurrent request can flip pending_confirmation -> confirmed.
    // The loser's UPDATE affects 0 rows and never reaches the coin_transactions insert
    // below, so a double tap can't award coins twice.
    const result = await pool.query(
      `UPDATE tasks
       SET status = 'confirmed', confirmed_at = now()
       WHERE id = $1 AND status = 'pending_confirmation'
       RETURNING id, family_id, child_id, title, coin_value`,
      [taskId]
    );

    if (result.rowCount === 0) {
      return res
        .status(409)
        .json({ status: 'error', message: 'task is not awaiting confirmation' });
    }

    const task = result.rows[0];
    const transactionId = randomUUID();
    // Coins are awarded here, unconditionally — the events insert right
    // after is just a notification of this already-committed fact. It's
    // never a gate on the coin_transactions write, and the child's balance
    // doesn't depend on whether the event/popup was ever created or seen.
    await pool.query(
      `INSERT INTO coin_transactions (id, child_id, task_id, amount, reason)
       VALUES ($1, $2, $3, $4, 'task_reward')`,
      [transactionId, task.child_id, task.id, task.coin_value]
    );

    await pool.query(
      `INSERT INTO events (id, family_id, child_id, type, related_task_id, coins_amount)
       VALUES ($1, $2, $3, 'task_confirmed', $4, $5)`,
      [randomUUID(), task.family_id, task.child_id, task.id, task.coin_value]
    );

    res.json({ status: 'ok', task_id: task.id, coins_awarded: task.coin_value });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.patch('/:taskId/reject', async (req, res) => {
  try {
    const { taskId } = req.params;

    const result = await pool.query(
      `UPDATE tasks
       SET status = 'needs_revision'
       WHERE id = $1 AND status = 'pending_confirmation'
       RETURNING id, family_id, child_id`,
      [taskId]
    );

    if (result.rowCount === 0) {
      return res
        .status(409)
        .json({ status: 'error', message: 'task is not awaiting confirmation' });
    }

    const task = result.rows[0];
    await pool.query(
      `INSERT INTO events (id, family_id, child_id, type, related_task_id)
       VALUES ($1, $2, $3, 'task_needs_rework', $4)`,
      [randomUUID(), task.family_id, task.child_id, task.id]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
