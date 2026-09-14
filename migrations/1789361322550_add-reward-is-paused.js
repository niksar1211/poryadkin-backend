exports.shorthands = undefined;

// Same idea as tasks.is_paused — a parent can hide a reward from the
// child's shop without deactivating it outright, then bring it back later.
// Separate from is_active (deactivate = permanent, soft-delete) since
// pausing is meant to be reversible.
exports.up = (pgm) => {
  pgm.addColumns('rewards', {
    is_paused: { type: 'boolean', notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('rewards', ['is_paused']);
};
