-- The ClickUp mirror (src/lib/clickup/): with CLICKUP_API_TOKEN set, every sync pushes the org into one
-- ClickUp Space: a folder per project, a list per team plus Goals and To-dos lists, and a task for each
-- session, goal, milestone and to-do. One row per thing Timu put in ClickUp, so the next push updates
-- that thing instead of making another, and an unchanged one costs no request.
--
-- key: what it mirrors. 'space'; 'folder:<project id>'; lists 'list:team:<team id>',
--      'list:loose:<project id>' (sessions in a project but no team), 'list:goals:<project id>',
--      'list:todos:<project id>', 'list:todos:none' and 'list:unfiled'; tasks 'session:<id>',
--      'goal:<id>', 'milestone:<id>' and 'todo:<id>'.
-- clickup_id: the ClickUp space, folder, list or task id.
-- parent: for a task, the ClickUp list it is in (when the plan names another, the task moves);
--         for 'space', the workspace it is in.
-- hash: what was last written (a task's fields, a folder or list's name), so unchanged things are skipped.
-- tags: a task's tags as last written, so a changed teammate swaps one tag for the other.
-- url: the task's ClickUp link.
create table clickup_links (
  key text primary key,
  clickup_id text not null,
  parent text,
  hash text not null default '',
  tags json not null default '[]',
  url text,
  synced_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
