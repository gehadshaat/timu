-- Which Claude account a session or routine came from (the id of its Claude Code config folder,
-- e.g. "claude" or "claude-work"). Accounts share one org: this is only a source tag, never a filter
-- on companies, projects or goals. Null for sessions imported before accounts, and for claude.ai chats.
alter table sessions add column account text;
alter table routines add column account text;
