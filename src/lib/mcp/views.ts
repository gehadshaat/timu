import "server-only";
import { all } from "../db";
import { resumeFor } from "../links";
import type { Org, TodoItem } from "../queries";
import { clip } from "../text";
import type { AgentRow, ProjectRow, SessionRow, TaskRow } from "../types";

/** Compact JSON shapes for MCP responses: enough to act on, small enough to list. */

export interface Workload {
  byAgent: Map<string, { sessions: number; working: number; asks: number }>;
  /** Live sessions nobody owns yet. */
  unfiled: number;
  openAsks: number;
}

/** Session and open-ask counts per teammate, over every non-archived session. */
export async function getWorkload(): Promise<Workload> {
  const sessions = all<{ id: string; agent_id: string | null; status: string }>(
    "select id, agent_id, status from sessions where archived = 0 order by id",
  );
  const now = new Date().toISOString();
  const asks = all<{ session_id: string }>(
    "select session_id from tasks where session_id is not null and (status = 'open' or (status = 'snoozed' and snoozed_until < ?))",
    now,
  );

  const byAgent: Workload["byAgent"] = new Map();
  const live = new Set(sessions.map((s) => s.id));
  const owner = new Map<string, string>();
  let unfiled = 0;
  for (const s of sessions) {
    if (!s.agent_id) {
      unfiled++;
      continue;
    }
    owner.set(s.id, s.agent_id);
    const load = byAgent.get(s.agent_id) ?? { sessions: 0, working: 0, asks: 0 };
    load.sessions++;
    if (s.status === "working") load.working++;
    byAgent.set(s.agent_id, load);
  }
  let openAsks = 0;
  for (const a of asks) {
    const agentId = owner.get(a.session_id);
    if (!live.has(a.session_id)) continue; // archived session
    openAsks++;
    if (agentId) byAgent.get(agentId)!.asks++;
  }
  return { byAgent, unfiled, openAsks };
}

export function teammateNode(a: AgentRow, load?: Workload) {
  const l = load?.byAgent.get(a.id);
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    persona: a.persona,
    prop: a.avatar?.prop ?? "mug",
    ...(load ? { sessions: l?.sessions ?? 0, working: l?.working ?? 0, asks: l?.asks ?? 0 } : {}),
  };
}

export function projectNode(org: Org, p: ProjectRow, load?: Workload) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    emoji: p.emoji,
    description: p.description,
    theme: p.theme,
    teams: org.teams
      .filter((t) => t.project_id === p.id)
      .map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        teammates: org.agents.filter((a) => a.team_id === t.id).map((a) => teammateNode(a, load)),
      })),
    goals: org.goals
      .filter((g) => g.project_id === p.id)
      .map((g) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        priority: g.priority,
        due_date: g.due_date,
        team: org.teams.find((t) => t.id === g.team_id)?.name ?? null,
      })),
  };
}

/** Who owns a session, following the same fallbacks as the inbox. */
export function placeOfSession(org: Org, s: Pick<SessionRow, "agent_id" | "team_id" | "project_id" | "goal_id">) {
  const agent = org.agents.find((a) => a.id === s.agent_id) ?? null;
  const team = org.teams.find((t) => t.id === (agent?.team_id ?? s.team_id)) ?? null;
  const project = org.projects.find((p) => p.id === (s.project_id ?? team?.project_id)) ?? null;
  const company = org.companies.find((c) => c.id === project?.company_id) ?? null;
  const goal = org.goals.find((g) => g.id === s.goal_id) ?? null;
  return { agent, team, project, company, goal };
}

export function sessionBrief(org: Org, s: SessionRow) {
  const { agent, team, project, goal } = placeOfSession(org, s);
  const resume = resumeFor(s);
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    source: s.source,
    repo: s.repo,
    url: s.url,
    // How to pick it up in the terminal: local sessions, and cloud ones whose transcript is here too.
    ...(resume ? { resume } : {}),
    last_activity_at: s.last_activity_at,
    summary: s.summary,
    teammate: agent ? { id: agent.id, name: agent.name } : null,
    team: team?.name ?? null,
    project: project ? { id: project.id, name: project.name } : null,
    goal: goal ? { id: goal.id, title: goal.title } : null,
    ...(s.archived ? { archived: true } : {}),
  };
}

export function askBrief(org: Org, task: TaskRow, session: SessionRow | null) {
  const place = session ? placeOfSession(org, session) : null;
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    detail: clip(task.detail, 400),
    status: task.status,
    raised_at: task.raised_at,
    ...(task.status === "snoozed" ? { snoozed_until: task.snoozed_until } : {}),
    session: session ? { id: session.id, title: session.title, url: session.url, status: session.status } : null,
    teammate: place?.agent ? { id: place.agent.id, name: place.agent.name } : null,
    project: place?.project?.name ?? null,
    why: task.judge ? `${task.judge.reason} (${task.judge.engine})` : null,
  };
}

export function todoBrief({ task, agent, project, goal }: TodoItem) {
  return {
    id: task.id,
    title: task.title,
    detail: task.detail,
    done: task.status === "done",
    due_date: task.due_date,
    priority: task.priority,
    assignee: agent ? { id: agent.id, name: agent.name } : "you",
    project: project ? { id: project.id, name: project.name } : null,
    goal: goal ? { id: goal.id, title: goal.title } : null,
  };
}
