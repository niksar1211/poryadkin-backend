exports.shorthands = undefined;

// Optional, longer free-text field alongside title — parent-only for now
// (not surfaced to the child on either screen). Nullable: most tasks/rewards
// won't have one, and an empty description is meaningless to store as ''.
exports.up = (pgm) => {
  pgm.addColumns('tasks', {
    description: { type: 'text', notNull: false, default: null },
  });
  pgm.addColumns('rewards', {
    description: { type: 'text', notNull: false, default: null },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('tasks', ['description']);
  pgm.dropColumns('rewards', ['description']);
};
