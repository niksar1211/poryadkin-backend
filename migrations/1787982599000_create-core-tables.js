exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('families', {
    id: { type: 'uuid', primaryKey: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('children', {
    id: { type: 'uuid', primaryKey: true },
    family_id: {
      type: 'uuid',
      notNull: true,
      references: 'families',
      onDelete: 'CASCADE',
    },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('pairing_codes', {
    id: { type: 'uuid', primaryKey: true },
    child_id: {
      type: 'uuid',
      notNull: true,
      references: 'children',
      onDelete: 'CASCADE',
    },
    code: { type: 'varchar(6)', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('pairing_codes', 'code');
};

exports.down = (pgm) => {
  pgm.dropTable('pairing_codes');
  pgm.dropTable('children');
  pgm.dropTable('families');
};
