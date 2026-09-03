exports.shorthands = undefined;

// Picked once, randomly, when a child is created, and never recomputed —
// the palette's actual colors live in the frontend (src/theme/childColors.ts);
// this is just a stable index into it, from 0 to 5 (6-color palette).
exports.up = (pgm) => {
  pgm.addColumns('children', {
    color_key: { type: 'smallint', notNull: true, default: 0 },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('children', ['color_key']);
};
