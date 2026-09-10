exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('reward_suggestions', {
    id: { type: 'uuid', primaryKey: true },
    family_id: {
      type: 'uuid',
      notNull: true,
      references: 'families',
      onDelete: 'CASCADE',
    },
    child_id: {
      type: 'uuid',
      notNull: true,
      references: 'children',
      onDelete: 'CASCADE',
    },
    title: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'pending' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    resolved_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('reward_suggestions', 'reward_suggestions_status_check', {
    check: "status IN ('pending', 'accepted', 'rejected')",
  });

  pgm.createIndex('reward_suggestions', 'child_id');
  pgm.createIndex('reward_suggestions', ['family_id', 'status']);
};

exports.down = (pgm) => {
  pgm.dropTable('reward_suggestions');
};
