exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('tasks', {
    id: { type: 'uuid', primaryKey: true },
    child_id: {
      type: 'uuid',
      notNull: true,
      references: 'children',
      onDelete: 'CASCADE',
    },
    family_id: {
      type: 'uuid',
      notNull: true,
      references: 'families',
      onDelete: 'CASCADE',
    },
    title: { type: 'text', notNull: true },
    coin_value: { type: 'integer', notNull: true },
    status: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
    confirmed_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('tasks', 'tasks_status_check', {
    check: "status IN ('assigned', 'pending_confirmation', 'confirmed', 'needs_revision')",
  });

  pgm.createIndex('tasks', 'child_id');
  pgm.createIndex('tasks', 'family_id');
  pgm.createIndex('tasks', 'status');

  pgm.createTable('coin_transactions', {
    id: { type: 'uuid', primaryKey: true },
    child_id: {
      type: 'uuid',
      notNull: true,
      references: 'children',
      onDelete: 'CASCADE',
    },
    task_id: {
      type: 'uuid',
      references: 'tasks',
      onDelete: 'SET NULL',
    },
    amount: { type: 'integer', notNull: true },
    reason: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('coin_transactions', 'child_id');
};

exports.down = (pgm) => {
  pgm.dropTable('coin_transactions');
  pgm.dropTable('tasks');
};
