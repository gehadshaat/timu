-- The status you set on a session from a board ("done", "idle", …). It wins over the status Claude
-- reports until the session has new activity, when the next sync clears it.
alter table sessions add column status_override text
  check (status_override in ('working', 'needs_you', 'review', 'idle', 'done', 'failed'));
