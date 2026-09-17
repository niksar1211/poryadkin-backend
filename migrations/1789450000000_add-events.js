exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('events', {
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
    type: { type: 'text', notNull: true },
    // Set for task_confirmed / task_needs_rework, null otherwise.
    related_task_id: {
      type: 'uuid',
      references: 'tasks',
      onDelete: 'SET NULL',
    },
    // Set for reward_proposed / reward_approved / reward_declined — points
    // at the reward_suggestions row, not a rewards row: accepting a
    // suggestion only flips its own status, the parent still fills out a
    // separate create-reward form afterwards, so there's no rewards row
    // yet at the moment a reward_approved event is created.
    related_suggestion_id: {
      type: 'uuid',
      references: 'reward_suggestions',
      onDelete: 'SET NULL',
    },
    // Only set for task_confirmed — the coins awarded for that specific
    // task, purely informational for display. Coin awarding itself already
    // happened via coin_transactions in the same request that creates this
    // event; this column never drives balance math.
    coins_awarded: { type: 'integer' },
    is_read: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('events', 'events_type_check', {
    check:
      "type IN ('task_confirmed', 'task_needs_rework', 'reward_proposed', 'reward_approved', 'reward_declined')",
  });

  // Covers both the events-screen query (child_id, is_read, created_at
  // sort) and the app-foreground unread check.
  pgm.createIndex('events', ['child_id', 'is_read', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('events');
};
