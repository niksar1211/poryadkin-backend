exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('tasks', {
    sort_order: { type: 'integer', notNull: true, default: 0 },
  });

  // Backfill so existing tasks keep their current (created_at) order once
  // reads switch to ORDER BY sort_order — otherwise every existing row
  // would collapse to 0 and re-sort arbitrarily among ties.
  pgm.sql(`
    UPDATE tasks t
    SET sort_order = ranked.rn
    FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY child_id ORDER BY created_at ASC) - 1 AS rn
      FROM tasks
    ) ranked
    WHERE t.id = ranked.id
  `);
};

exports.down = (pgm) => {
  pgm.dropColumns('tasks', ['sort_order']);
};
