-- Claude artifacts (pages published to claude.ai), filed into the org like sessions are.
-- `id` is the id in the artifact's claude.ai link. An artifact is filed under the session whose
-- transcript links to it, else by its title against project and company names, else by you.
create table artifacts (
  id text primary key,
  url text not null,
  title text,
  -- 'mine' (you published it) or 'shared' (someone shared it with you)
  owner text,
  updated_at text,
  -- the latest session whose transcript links to it
  session_id text references sessions(id) on delete set null,
  project_id text references projects(id) on delete set null,
  company_id text references companies(id) on delete set null,
  -- how it was filed: 'session', 'title' or 'you' (yours is never overwritten)
  filed_by text,
  account text,
  imported_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index artifacts_project_idx on artifacts (project_id);
create index artifacts_session_idx on artifacts (session_id);
