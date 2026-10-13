import "server-only";
import { all, getSetting } from "./db";
import { getGoals, getOrg, getTodos, type GoalView, type Org, type TodoItem } from "./queries";
import type { AgentRow, GoalRow, SessionRow, TaskRow } from "./types";

export const SEEN_KEY = "digest_seen_at";

export interface Digest {
  since: string;
  newAsks: { task: TaskRow; session: SessionRow | null }[];
  shipped: SessionRow[];
  stuck: SessionRow[];
  working: SessionRow[];
  handled: TaskRow[];
  goalsAchieved: GoalRow[];
  goalsMoving: GoalView[];
  newSessions: SessionRow[];
  newTeammates: AgentRow[];
  dueSoon: TodoItem[];
  org: Org;
}

const COLS =
  "id, source, external_id, title, url, repo, branch, status, status_detail, first_user_message, last_message, last_message_role, message_count, started_at, last_activity_at, project_id, team_id, agent_id, goal_id, summary, classified_at, archived, title_locked, triage";

/** Default window: since you last marked the digest read, else the last 24 hours. */
export async function digestSince(param?: string): Promise<string> {
  if (param === "7d") return new Date(Date.now() - 7 * 86_400_000).toISOString();
  if (param === "24h") return new Date(Date.now() - 86_400_000).toISOString();
  return (await getSetting<string>(SEEN_KEY)) ?? new Date(Date.now() - 86_400_000).toISOString();
}

export async function getDigest(since: string): Promise<Digest> {
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const askRows = all<TaskRow>(
    "select * from tasks where origin <> 'manual' and status <> 'done' and created_at >= ? order by created_at desc",
    since,
  );
  const activeRows = all<SessionRow>(
    `select ${COLS} from sessions where archived = 0 and last_activity_at >= ? order by last_activity_at desc`,
    since,
  );
  const handled = all<TaskRow>("select * from tasks where status = 'done' and resolved_at >= ? order by resolved_at desc", since);
  const achieved = all<GoalRow>("select * from goals where status = 'achieved' and achieved_at >= ?", since);
  const imported = all<SessionRow>(
    `select ${COLS} from sessions where archived = 0 and imported_at >= ? order by imported_at desc limit 50`,
    since,
  );
  const [org, todos] = await Promise.all([getOrg(), getTodos({ mine: true })]);
  const sessionIds = askRows.map((t) => t.session_id).filter((x): x is string => !!x);
  const askSessions = all<SessionRow>(`select ${COLS} from sessions where id in (select value from json_each(?))`, [...new Set(sessionIds)]);

  // Active goals where something moved in the window.
  const goalsMoving: GoalView[] = [];
  for (const p of org.projects) {
    for (const g of await getGoals(p.id)) {
      if (g.goal.status !== "active") continue;
      const moved =
        g.milestones.some((m) => m.done_at && m.done_at >= since) ||
        g.sessions.some((s) => s.last_activity_at && s.last_activity_at >= since) ||
        g.todos.some((t) => t.resolved_at && t.resolved_at >= since);
      if (moved) goalsMoving.push(g);
    }
  }

  return {
    since,
    newAsks: askRows.map((task) => ({ task, session: askSessions.find((s) => s.id === task.session_id) ?? null })),
    shipped: activeRows.filter((s) => s.status === "done"),
    stuck: activeRows.filter((s) => s.status === "failed"),
    working: activeRows.filter((s) => s.status === "working"),
    handled,
    goalsAchieved: achieved,
    goalsMoving,
    newSessions: imported,
    newTeammates: org.agents.filter((a) => a.created_at && a.created_at >= since),
    dueSoon: todos.filter((t) => t.task.due_date && t.task.due_date <= soon),
    org,
  };
}

