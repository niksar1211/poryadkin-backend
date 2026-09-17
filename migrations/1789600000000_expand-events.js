exports.shorthands = undefined;

// Widens the events feed to the full "События" spec: task_overdue and
// task_archived (one-time-task deadline / age-out of a confirmed task) and
// reward_purchased (a real shop purchase, not a suggestion). coins_awarded
// becomes coins_amount because it's now signed — positive for
// task_confirmed, negative for reward_purchased. reward_purchased points at
// an actual `rewards` row, unlike the suggestion-lifecycle types
// (reward_proposed/approved/declined), which is why it needs its own
// related_reward_id column alongside the existing related_suggestion_id —
// the API layer COALESCEs whichever one a given row actually has.
exports.up = (pgm) => {
  pgm.renameColumn('events', 'coins_awarded', 'coins_amount');

  pgm.addColumns('events', {
    related_reward_id: { type: 'uuid', references: 'rewards', onDelete: 'SET NULL' },
  });

  pgm.dropConstraint('events', 'events_type_check');
  pgm.addConstraint('events', 'events_type_check', {
    check:
      "type IN ('task_confirmed', 'task_needs_rework', 'task_overdue', 'task_archived', 'reward_proposed', 'reward_approved', 'reward_declined', 'reward_purchased')",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('events', 'events_type_check');
  pgm.addConstraint('events', 'events_type_check', {
    check: "type IN ('task_confirmed', 'task_needs_rework', 'reward_proposed', 'reward_approved', 'reward_declined')",
  });

  pgm.dropColumns('events', ['related_reward_id']);
  pgm.renameColumn('events', 'coins_amount', 'coins_awarded');
};
