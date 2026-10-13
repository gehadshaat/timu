import type { SessionRow } from "./types";

/** The slice of a session that lists need (keeps big transcripts off the client). */
export type SessionLite = Pick<
  SessionRow,
  | "id"
  | "external_id"
  | "title"
  | "summary"
  | "source"
  | "status"
  | "status_detail"
  | "repo"
  | "branch"
  | "url"
  | "last_activity_at"
  | "archived"
  | "agent_id"
  | "team_id"
  | "project_id"
  | "goal_id"
  | "status_override"
  | "account"
> & {
  /** The status Claude reports (`status` is what boards show: yours when you set one). */
  claude_status: SessionRow["status"];
};

export function toSessionLite(s: SessionRow): SessionLite {
  return {
    id: s.id,
    external_id: s.external_id,
    title: s.title,
    summary: s.summary,
    source: s.source,
    // What the boards show: your status when you set one, otherwise Claude's.
    status: s.status_override ?? s.status,
    status_detail: s.status_detail,
    repo: s.repo,
    branch: s.branch,
    url: s.url,
    last_activity_at: s.last_activity_at,
    archived: s.archived,
    agent_id: s.agent_id,
    team_id: s.team_id,
    project_id: s.project_id,
    goal_id: s.goal_id,
    status_override: s.status_override ?? null,
    account: s.account ?? null,
    claude_status: s.status,
  };
}
