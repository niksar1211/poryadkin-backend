const { createHash } = require('crypto');

const pool = require('../db');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// Looks up the bearer token and attaches { id, family_id, child_id, role }
// as req.auth. Does not check that the token grants access to whatever
// resource the URL names — that's the job of requireFamilyParam /
// requireChildParam / requireTaskOwnership below, run after this.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return res.status(401).json({ status: 'error', message: 'missing bearer token' });
  }

  try {
    const tokenHash = hashToken(match[1]);
    const result = await pool.query(
      'SELECT id, family_id, child_id, role FROM device_tokens WHERE token_hash = $1',
      [tokenHash]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ status: 'error', message: 'invalid token' });
    }

    req.auth = result.rows[0];

    // Fire-and-forget — a slow/failed bookkeeping write shouldn't hold up
    // or fail the actual request.
    pool
      .query('UPDATE device_tokens SET last_used_at = now() WHERE id = $1', [req.auth.id])
      .catch(() => {});

    next();
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
}

// For routes shaped /families/:familyId/... — the token's own family_id
// must equal the family_id named in the URL.
function requireFamilyParam(req, res, next) {
  if (req.params.familyId !== req.auth.family_id) {
    return res
      .status(403)
      .json({ status: 'error', message: 'token does not grant access to this family' });
  }
  next();
}

// For routes shaped /children/:childId/... — a child token's own child_id
// must equal the URL's childId. A parent token doesn't carry a child_id
// (it's null), so ownership is resolved by checking the child actually
// belongs to the token's family instead.
async function requireChildParam(req, res, next) {
  const { childId } = req.params;
  const auth = req.auth;

  if (auth.child_id) {
    if (auth.child_id !== childId) {
      return res
        .status(403)
        .json({ status: 'error', message: 'token does not grant access to this child' });
    }
    return next();
  }

  try {
    const child = await pool.query('SELECT family_id FROM children WHERE id = $1', [childId]);
    if (child.rowCount === 0 || child.rows[0].family_id !== auth.family_id) {
      return res
        .status(403)
        .json({ status: 'error', message: 'token does not grant access to this child' });
    }
    next();
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
}

// For routes shaped /tasks/:taskId/... — there's no family_id/child_id in
// the URL to compare directly, so ownership is resolved by looking up the
// task's own family_id/child_id and comparing those to the token instead.
async function requireTaskOwnership(req, res, next) {
  const { taskId } = req.params;
  const auth = req.auth;

  try {
    const task = await pool.query('SELECT family_id, child_id FROM tasks WHERE id = $1', [
      taskId,
    ]);

    const deny = () =>
      res.status(403).json({ status: 'error', message: 'token does not grant access to this task' });

    if (task.rowCount === 0) return deny();

    const t = task.rows[0];
    if (t.family_id !== auth.family_id) return deny();
    if (auth.child_id && auth.child_id !== t.child_id) return deny();

    next();
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
}

module.exports = { hashToken, authenticate, requireFamilyParam, requireChildParam, requireTaskOwnership };
