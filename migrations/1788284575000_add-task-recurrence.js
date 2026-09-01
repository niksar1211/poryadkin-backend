exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('tasks', {
    recurrence: { type: 'text', notNull: true, default: 'one_time' },
    is_template: { type: 'boolean', notNull: true, default: false },
    template_id: {
      type: 'uuid',
      references: 'tasks',
      onDelete: 'CASCADE',
    },
    occurrence_date: { type: 'date' },
  });

  pgm.addConstraint('tasks', 'tasks_recurrence_check', {
    check: "recurrence IN ('one_time', 'daily')",
  });

  // Guards occurrence generation against a race between concurrent
  // GET /children/:childId/tasks requests: whichever INSERT ... ON CONFLICT
  // DO NOTHING for a given (template_id, occurrence_date) lands first wins,
  // the other silently no-ops instead of creating a duplicate occurrence.
  pgm.addConstraint('tasks', 'tasks_template_occurrence_unique', {
    unique: ['template_id', 'occurrence_date'],
  });

  pgm.createIndex('tasks', 'template_id');
};

exports.down = (pgm) => {
  pgm.dropConstraint('tasks', 'tasks_template_occurrence_unique');
  pgm.dropConstraint('tasks', 'tasks_recurrence_check');
  pgm.dropColumns('tasks', ['recurrence', 'is_template', 'template_id', 'occurrence_date']);
};
