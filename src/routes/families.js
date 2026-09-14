const express = require('express');
const { randomUUID } = require('crypto');

const pool = require('../db');
const { authenticate, requireFamilyParam } = require('../middleware/auth');
const { computeRarityTier } = require('../utils/rewardTier');

const router = express.Router();

// Must match the palette length in the frontend's src/theme/childColors.ts —
// picked once at creation and stored, not recomputed on every read.
const CHILD_COLOR_COUNT = 7;

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

    // Deterministic default — the Nth child in a family gets the Nth color
    // in the fixed palette, cycling after CHILD_COLOR_COUNT — but the
    // parent can override it (color picker on the add-child sheet), so an
    // explicit, in-range color_key from the request wins when present.
    const existing = await pool.query(
      'SELECT COUNT(*)::int AS count FROM children WHERE family_id = $1',
      [familyId]
    );
    const defaultColorKey = existing.rows[0].count % CHILD_COLOR_COUNT;
    const requestedColorKey = req.body?.color_key;
    const colorKey =
      Number.isInteger(requestedColorKey) &&
      requestedColorKey >= 0 &&
      requestedColorKey < CHILD_COLOR_COUNT
        ? requestedColorKey
        : defaultColorKey;

    await pool.query(
      'INSERT INTO children (id, family_id, name, color_key) VALUES ($1, $2, $3, $4)',
      [id, familyId, name, colorKey]
    );
    res.status(201).json({ child_id: id, color_key: colorKey });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/:familyId/children', async (req, res) => {
  try {
    const { familyId } = req.params;
    // balance cast to ::int right in SQL so it comes back as a JS number —
    // node-pg otherwise stringifies a bare SUM() (it's bigint) to dodge
    // precision loss, which isn't a concern at these amounts.
    const result = await pool.query(
      `SELECT id, name, created_at, color_key,
              EXISTS (
                SELECT 1 FROM device_tokens dt
                WHERE dt.child_id = children.id AND dt.role = 'child'
              ) AS connected,
              COALESCE(
                (SELECT SUM(amount)::int FROM coin_transactions WHERE child_id = children.id),
                0
              ) AS balance
       FROM children
       WHERE family_id = $1
       ORDER BY created_at ASC`,
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
    // Optional — '' and omitted both mean "no description", stored as NULL
    // rather than an empty string.
    const description =
      typeof req.body?.description === 'string' ? req.body.description.trim() || null : null;

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

    // New tasks are appended after whatever this child already has —
    // templates included, since a generated occurrence inherits its
    // template's sort_order below. Keeps creation order stable and
    // predictable instead of relying on created_at, which several tasks
    // created back-to-back (e.g. the starter set) can't be trusted to order
    // correctly on its own.
    const order = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks WHERE child_id = $1',
      [childId]
    );
    const sortOrder = order.rows[0].next;

    // 'daily' creates only the template row (is_template=true, occurrence_date
    // NULL) — it's never shown to the child directly. GET /children/:childId/tasks
    // generates the actual per-day occurrences from it on read.
    await pool.query(
      `INSERT INTO tasks (id, child_id, family_id, title, description, coin_value, status, recurrence, is_template, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, 'assigned', $7, $8, $9)`,
      [id, childId, familyId, title, description, coinValue, recurrence, isTemplate, sortOrder]
    );

    res.status(201).json({ task_id: id });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Manual drag-to-reorder: body is the full list of that child's currently
// visible task ids, in the new order. A row not belonging to this child is
// silently skipped rather than erroring the whole request — keeps a stale
// client-side list (e.g. a task confirmed in another tab mid-drag) from
// failing the reorder outright.
//
// A reordered row that's a daily occurrence also pushes its new position
// onto its template, so the order survives into tomorrow's occurrence
// instead of reverting to creation order the next time it's generated.
router.patch('/:familyId/children/:childId/tasks/reorder', async (req, res) => {
  try {
    const { familyId, childId } = req.params;
    const taskIds = req.body?.task_ids;

    if (!Array.isArray(taskIds) || taskIds.some((id) => typeof id !== 'string')) {
      return res.status(400).json({ status: 'error', message: 'task_ids must be an array of strings' });
    }

    const child = await pool.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [
      childId,
      familyId,
    ]);
    if (child.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'child not found in this family' });
    }

    for (let i = 0; i < taskIds.length; i++) {
      const result = await pool.query(
        `UPDATE tasks SET sort_order = $1 WHERE id = $2 AND child_id = $3 RETURNING template_id`,
        [i, taskIds[i], childId]
      );
      if (result.rowCount === 0) continue;

      const templateId = result.rows[0].template_id;
      if (templateId) {
        await pool.query('UPDATE tasks SET sort_order = $1 WHERE id = $2', [i, templateId]);
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Only 'assigned'/'needs_revision' tasks are editable — matches what the
// app lets a parent tap into (pending/confirmed cards have their own
// dedicated actions instead). Editing a daily occurrence edits its template
// row too, in the same statement, so the change also carries into tomorrow's
// (and any other still-open) occurrence instead of reverting the next time
// one gets generated; a one-time task has no template_id, so this only ever
// touches the row itself. is_paused rides along the same statement — see
// GET /children/:childId/tasks for what it actually does (hides the task
// from the child, stops a daily task generating new occurrences).
router.patch('/:familyId/children/:childId/tasks/:taskId', async (req, res) => {
  try {
    const { familyId, childId, taskId } = req.params;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const coinValue = Number(req.body?.coin_value);
    const isPaused = req.body?.is_paused === true;
    const description =
      typeof req.body?.description === 'string' ? req.body.description.trim() || null : null;

    if (!title) {
      return res.status(400).json({ status: 'error', message: 'title is required' });
    }
    if (!Number.isInteger(coinValue) || coinValue <= 0) {
      return res
        .status(400)
        .json({ status: 'error', message: 'coin_value must be a positive integer' });
    }

    // Checked as its own step rather than folded into the UPDATE's WHERE —
    // a daily occurrence's template row is always 'assigned' (it never goes
    // through complete/confirm/reject itself), so a combined query would
    // happily match and update the template even while the occurrence the
    // parent actually tapped sits at pending_confirmation, silently
    // bypassing the check.
    const task = await pool.query(
      `SELECT id, template_id, status FROM tasks WHERE id = $1 AND family_id = $2 AND child_id = $3`,
      [taskId, familyId, childId]
    );
    if (task.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'task not found' });
    }
    if (!['assigned', 'needs_revision'].includes(task.rows[0].status)) {
      return res
        .status(409)
        .json({ status: 'error', message: 'task cannot be edited from its current state' });
    }

    const templateId = task.rows[0].template_id;
    await pool.query(
      'UPDATE tasks SET title = $1, coin_value = $2, is_paused = $3, description = $4 WHERE id = $5 OR id = $6',
      [title, coinValue, isPaused, description, taskId, templateId || taskId]
    );

    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Deleting a daily occurrence deletes its template instead — "delete this
// task" means the recurring habit itself, not just today's card. That
// cascades (tasks.template_id ON DELETE CASCADE) to every other occurrence
// still pointing at it, EXCEPT confirmed ones: those are detached first so
// they survive as standalone history, matching how a one-time task (no
// template at all) already displays. coin_transactions.task_id is ON DELETE
// SET NULL, so a child's earned balance is never affected by any of this —
// only the traceability of a deleted row's coin transaction back to it.
router.delete('/:familyId/children/:childId/tasks/:taskId', async (req, res) => {
  try {
    const { familyId, childId, taskId } = req.params;

    const task = await pool.query(
      `SELECT id, template_id, status FROM tasks WHERE id = $1 AND family_id = $2 AND child_id = $3`,
      [taskId, familyId, childId]
    );
    if (task.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'task not found' });
    }
    if (!['assigned', 'needs_revision'].includes(task.rows[0].status)) {
      return res
        .status(409)
        .json({ status: 'error', message: 'task cannot be deleted from its current state' });
    }

    const templateId = task.rows[0].template_id;
    const deleteTargetId = templateId || taskId;

    if (templateId) {
      await pool.query(
        `UPDATE tasks SET template_id = NULL WHERE template_id = $1 AND status = 'confirmed'`,
        [templateId]
      );
    }

    await pool.query('DELETE FROM tasks WHERE id = $1', [deleteTargetId]);

    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/:familyId/tasks', async (req, res) => {
  try {
    const { familyId } = req.params;

    // Same day-boundary generation as GET /children/:childId/tasks, just
    // scoped to the whole family instead of one child — without this, the
    // parent's list only ever showed a fresh daily occurrence once SOME
    // child's own device had opened the app that day (the only other place
    // this INSERT ran), so checking the parent screen first each day made
    // every still-active daily task look like it had vanished.
    await pool.query(
      `INSERT INTO tasks (
         id, child_id, family_id, title, description, coin_value, status,
         recurrence, is_template, template_id, occurrence_date, sort_order
       )
       SELECT
         gen_random_uuid(), t.child_id, t.family_id, t.title, t.description, t.coin_value, 'assigned',
         'daily', false, t.id,
         ((NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 hour')::date,
         t.sort_order
       FROM tasks t
       WHERE t.family_id = $1 AND t.is_template = true AND t.recurrence = 'daily' AND t.is_paused = false
       ON CONFLICT (template_id, occurrence_date) DO NOTHING`,
      [familyId]
    );

    // Same staleness filter as GET /children/:childId/tasks — a daily
    // occurrence past its day that was never touched (still
    // 'assigned'/'needs_revision') is dropped so it doesn't sit alongside
    // today's freshly generated card looking like a duplicate.
    // 'pending_confirmation' survives regardless of date (parent still owes
    // it a decision). A 'confirmed' daily occurrence only survives through
    // today's occurrence_date match; a 'confirmed' one-time task (no
    // occurrence_date at all) is judged by confirmed_at instead, so it
    // drops off the day after too instead of sitting there as "done"
    // forever. Everything else about a one-time task (still open, or
    // needs_revision) has no notion of "day" and always shows.
    const result = await pool.query(
      `SELECT t.id, t.child_id, c.name AS child_name, t.title, t.description, t.coin_value, t.status,
              t.recurrence, t.is_paused, t.created_at, t.completed_at, t.confirmed_at
       FROM tasks t
       JOIN children c ON c.id = t.child_id
       WHERE t.family_id = $1 AND t.is_template = false
         AND (
           t.status = 'pending_confirmation'
           OR t.occurrence_date = ((NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 hour')::date
           OR (
             t.template_id IS NULL
             AND (
               t.status <> 'confirmed'
               OR ((t.confirmed_at AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 hour')::date =
                  ((NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 hour')::date
             )
           )
         )
       ORDER BY t.sort_order ASC, t.created_at ASC`,
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
              t.recurrence, t.created_at, t.completed_at
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
    const description =
      typeof req.body?.description === 'string' ? req.body.description.trim() || null : null;

    if (!title) {
      return res.status(400).json({ status: 'error', message: 'title is required' });
    }
    if (!Number.isInteger(coinCost) || coinCost <= 0) {
      return res
        .status(400)
        .json({ status: 'error', message: 'coin_cost must be a positive integer' });
    }

    const family = await pool.query('SELECT id FROM families WHERE id = $1', [familyId]);
    if (family.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'family not found' });
    }

    const id = randomUUID();
    const rarityTier = computeRarityTier(coinCost);
    await pool.query(
      `INSERT INTO rewards (id, family_id, title, description, coin_cost, rarity_tier)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, familyId, title, description, coinCost, rarityTier]
    );

    res.status(201).json({ reward_id: id, rarity_tier: rarityTier });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.get('/:familyId/rewards', async (req, res) => {
  try {
    const { familyId } = req.params;
    const result = await pool.query(
      `SELECT id, title, description, coin_cost, rarity_tier, is_active, is_paused, created_at
       FROM rewards
       WHERE family_id = $1 AND is_active = true
       ORDER BY coin_cost ASC, created_at ASC`,
      [familyId]
    );
    res.json({ rewards: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Partial update of title/coin_cost only. rarity_tier and is_active are
// intentionally out of scope here — they have (or will have) their own
// dedicated endpoints/logic. rarity_tier isn't directly settable, but a
// coin_cost change recomputes and writes it too, so it can't go stale.
router.patch('/:familyId/rewards/:rewardId', async (req, res) => {
  try {
    const { familyId, rewardId } = req.params;
    const hasTitle = typeof req.body?.title === 'string';
    const hasCoinCost = req.body?.coin_cost !== undefined;
    const hasDescription = typeof req.body?.description === 'string';
    const hasIsPaused = typeof req.body?.is_paused === 'boolean';

    if (!hasTitle && !hasCoinCost && !hasDescription && !hasIsPaused) {
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

    const description = hasDescription ? req.body.description.trim() || null : undefined;

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
      setClauses.push(`rarity_tier = $${i++}`);
      values.push(computeRarityTier(coinCost));
    }
    if (hasDescription) {
      setClauses.push(`description = $${i++}`);
      values.push(description);
    }
    if (hasIsPaused) {
      setClauses.push(`is_paused = $${i++}`);
      values.push(req.body.is_paused);
    }
    values.push(rewardId, familyId);

    const result = await pool.query(
      `UPDATE rewards
       SET ${setClauses.join(', ')}
       WHERE id = $${i++} AND family_id = $${i++} AND is_active = true
       RETURNING id, title, description, coin_cost, rarity_tier, is_active, is_paused, created_at`,
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

router.get('/:familyId/reward-suggestions', async (req, res) => {
  try {
    const { familyId } = req.params;
    const result = await pool.query(
      `SELECT rs.id, rs.child_id, c.name AS child_name, rs.title, rs.created_at
       FROM reward_suggestions rs
       JOIN children c ON c.id = rs.child_id
       WHERE rs.family_id = $1 AND rs.status = 'pending'
       ORDER BY rs.created_at ASC`,
      [familyId]
    );
    res.json({ suggestions: result.rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Just flips the suggestion's status — it does NOT create the actual reward.
// The parent still picks the coin cost and rarity, same as any other reward,
// so the client pre-fills the existing create-reward form with this title
// and lets the parent finish it from there.
router.patch('/:familyId/reward-suggestions/:suggestionId/accept', async (req, res) => {
  try {
    const { familyId, suggestionId } = req.params;
    const result = await pool.query(
      `UPDATE reward_suggestions
       SET status = 'accepted', resolved_at = now()
       WHERE id = $1 AND family_id = $2 AND status = 'pending'
       RETURNING id`,
      [suggestionId, familyId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'suggestion not found' });
    }
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.patch('/:familyId/reward-suggestions/:suggestionId/reject', async (req, res) => {
  try {
    const { familyId, suggestionId } = req.params;
    const result = await pool.query(
      `UPDATE reward_suggestions
       SET status = 'rejected', resolved_at = now()
       WHERE id = $1 AND family_id = $2 AND status = 'pending'
       RETURNING id`,
      [suggestionId, familyId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'error', message: 'suggestion not found' });
    }
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
