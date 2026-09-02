exports.shorthands = undefined;

// Rarity tier names are taken verbatim from kukumi-screens.md (section on
// the child's rewards shop) — do not translate or invent alternatives here.
const RARITY_TIERS = ['Обычная', 'Редкая', 'Особая', 'Легендарная'];

exports.up = (pgm) => {
  pgm.createTable('rewards', {
    id: { type: 'uuid', primaryKey: true },
    family_id: {
      type: 'uuid',
      notNull: true,
      references: 'families',
      onDelete: 'CASCADE',
    },
    title: { type: 'text', notNull: true },
    coin_cost: { type: 'integer', notNull: true },
    rarity_tier: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('rewards', 'rewards_rarity_tier_check', {
    check: `rarity_tier IN ('${RARITY_TIERS.join("', '")}')`,
  });

  pgm.createIndex('rewards', 'family_id');

  pgm.addColumns('coin_transactions', {
    reward_id: {
      type: 'uuid',
      references: 'rewards',
      onDelete: 'SET NULL',
    },
  });

  pgm.addConstraint('coin_transactions', 'coin_transactions_reason_check', {
    check: "reason IN ('task_reward', 'reward_redemption')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('coin_transactions', 'coin_transactions_reason_check');
  pgm.dropColumns('coin_transactions', ['reward_id']);
  pgm.dropTable('rewards');
};
