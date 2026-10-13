-- Claude Code routines (scheduled cloud agents) and the check-ins sessions schedule for themselves,
-- imported from the routines API or a pasted JSON list. `id` is Claude's trigger id (trig_…).
create table routines (
  id text primary key,
  name text not null default 'Untitled routine',
  -- 'routine' (recurring), 'reminder' (a session's scheduled check-in), 'cowork_task', or 'other'
  kind text not null default 'routine',
  enabled boolean not null default 1,
  cron_expression text,
  run_once_at text,
  next_run_at text,
  last_fired_at text,
  -- 'succeeded' | 'failed' | 'running' | null
  last_run_status text,
  -- session_… ids: the last run, and the session a check-in posts back into
  last_run_session text,
  home_session text,
  ended_reason text,
  prompt text,
  created_at text,
  updated_at text,
  raw json not null default '{}',
  imported_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index routines_next_idx on routines (next_run_at);
