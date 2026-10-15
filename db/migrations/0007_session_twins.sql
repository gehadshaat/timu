-- One conversation can reach Timu twice: a Claude Code session you run in the terminal with Remote
-- Control (or a claude.ai/code session you teleport to the terminal) is both a local transcript and a
-- cloud session. Its transcript names the cloud session (a `remote_session_change` line), and Timu keeps
-- one row for it: the cloud one, which the local transcript is folded into.
--
-- cloud_id, on a local row: the claude.ai/code session (session_…) this transcript mirrors. It is only
-- seen on a local row until that cloud session is imported; then the two become one cloud row.
alter table sessions add column cloud_id text;
-- local_id, on a cloud row: the transcript folded into it, so the row can offer `claude --resume`.
alter table sessions add column local_id text;
create index sessions_cloud_id_idx on sessions (cloud_id) where cloud_id is not null;
