-- Timu syncs by itself every minute, so a session you're in the middle of changes on almost every sync.
-- When its new activity needs the triage model (the rules can't decide) and it was active moments ago,
-- judging waits until it has been quiet until `triage_due_at`; each sync judges the sessions that are due.
-- That keeps model calls to one per pause, not one per sync. null = nothing waiting to be judged.
alter table sessions add column triage_due_at text;
create index sessions_triage_due_idx on sessions (triage_due_at) where triage_due_at is not null;
