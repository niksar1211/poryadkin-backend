exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('device_tokens', {
    id: { type: 'uuid', primaryKey: true },
    // SHA-256 hex digest of the token — the token itself is never stored.
    token_hash: { type: 'text', notNull: true, unique: true },
    family_id: {
      type: 'uuid',
      notNull: true,
      references: 'families',
      onDelete: 'CASCADE',
    },
    child_id: {
      type: 'uuid',
      references: 'children',
      onDelete: 'CASCADE',
    },
    role: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('device_tokens', 'device_tokens_role_check', {
    check: "role IN ('parent', 'child')",
  });
};

exports.down = (pgm) => {
  pgm.dropTable('device_tokens');
};
