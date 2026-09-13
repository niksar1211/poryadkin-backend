exports.shorthands = undefined;

// A parent can pause an open (assigned/needs_revision) task without
// deleting it — it just stops showing up for the child (and, for a daily
// task, stops generating new day-to-day occurrences) until unpaused. Lives
// alongside status rather than as a status value itself, since pausing
// doesn't belong to the assigned -> pending_confirmation -> confirmed
// workflow the status column already models.
exports.up = (pgm) => {
  pgm.addColumns('tasks', {
    is_paused: { type: 'boolean', notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('tasks', ['is_paused']);
};
