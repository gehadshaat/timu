import "server-only";
import { all, get, scalar } from "./db";
import { busyPoseFor, poseFor, type Pose } from "./avatar";
import { goalProgress } from "./progress";
import type { AgentRow, CompanyRow, GoalRow, MilestoneRow, ProjectRow, SessionRow, TaskRow, TeamRow } from "./types";

export interface InboxItem {
  task: TaskRow;
  session: SessionRow;
  agent: AgentRow | null;
  team: TeamRow | null;
  project: ProjectRow | null;
}

const SESSION_LIST_COLUMNS =
  "id, source, external_id, title, url, repo, branch, status, status_detail, first_user_message, last_message, last_message_role, message_count, started_at, last_activity_at, project_id, team_id, agent_id, goal_id, summary, classified_at, archived, title_locked, triage, status_override, account";

/** Open tasks, plus snoozed ones whose snooze has expired. */
export async function getInbox(orgIn?: Org): Promise<InboxItem[]> {
  const now = new Date().toISOString();
  const tasks = all<TaskRow>(
    `select * from tasks
     where session_id is not null and (status = 'open' or (status = 'snoozed' and snoozed_until < ?))
     order by raised_at desc, id`,
    now,
  );
  if (!tasks.length) return [];

  const sessions = all<SessionRow>(
    `select ${SESSION_LIST_COLUMNS} from sessions where id in (select value from json_each(?))`,
    [...new Set(tasks.map((t) => t.session_id!))],
  );
  const org = orgIn ?? (await getOrg());
  const byId = new Map(sessions.map((s) => [s.id, s]));

  return tasks.flatMap((task) => {
    const session = byId.get(task.session_id!);
    if (!session) return [];
    const agent = org.agents.find((a) => a.id === session.agent_id) ?? null;
    const team = org.teams.find((t) => t.id === (agent?.team_id ?? session.team_id)) ?? null;
    const project = org.projects.find((p) => p.id === (session.project_id ?? team?.project_id)) ?? null;
    return [{ task, session, agent, team, project }];
  });
}

export async function getSnoozedCount(): Promise<number> {
  return scalar("select count(*) from tasks where status = 'snoozed' and snoozed_until > ?", new Date().toISOString());
}

export interface Org {
  companies: CompanyRow[];
  projects: ProjectRow[];
  teams: TeamRow[];
  agents: AgentRow[];
  goals: GoalRow[];
}

export async function getOrg(): Promise<Org> {
  return {
    companies: all<CompanyRow>("select * from companies order by name"),
    projects: all<ProjectRow>("select * from projects order by name"),
    teams: all<TeamRow>("select * from teams order by name"),
    agents: all<AgentRow>("select * from agents order by name"),
    goals: all<GoalRow>("select * from goals order by created_at"),
  };
}

export interface MemberView {
  agent: AgentRow;
  pose: Pose;
  /** What the speech bubble says. */
  line: string;
  sessions: SessionRow[];
  /** Session asks waiting on you. */
  openTasks: TaskRow[];
  /** To-dos you assigned to this teammate. */
  todos: TaskRow[];
}

export interface TeamView {
  team: TeamRow;
  project: ProjectRow;
  members: MemberView[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Everything the office needs: each team with members, their pose and current line. */
export async function getOffice(projectId?: string): Promise<TeamView[]> {
  const org = await getOrg();
  const sessions = all<SessionRow>(
    `select ${SESSION_LIST_COLUMNS} from sessions
     where agent_id is not null and archived = 0 and (? is null or project_id = ?)
     order by last_activity_at desc nulls last, id`,
    projectId ?? null,
    projectId ?? null,
  );
  const tasks = all<TaskRow>("select * from tasks where status <> 'done'");
  const todos = tasks.filter((t) => t.origin === "manual" && t.agent_id);
  const now = Date.now();

  const teams = org.teams.filter((t) => !projectId || t.project_id === projectId);
  return teams
    .map((team) => {
      const project = org.projects.find((p) => p.id === team.project_id)!;
      const members = org.agents
        .filter((a) => a.team_id === team.id)
        .map((agent) => {
          const mine = sessions.filter((s) => s.agent_id === agent.id);
          const ids = new Set(mine.map((s) => s.id));
          const openTasks = tasks.filter(
            (t) => !!t.session_id && ids.has(t.session_id) && (t.status === "open" || (t.snoozed_until && Date.parse(t.snoozed_until) < now)),
          );
          const myTodos = todos.filter((t) => t.agent_id === agent.id);
          const working = mine.find((s) => s.status === "working");
          const recentDone = mine.find(
            (s) => (s.status === "done" || s.status === "idle") && s.last_activity_at && now - Date.parse(s.last_activity_at) < DAY,
          );
          let pose = poseFor({
            openTaskKinds: openTasks.map((t) => t.kind),
            working: !!working,
            recentlyDone: !!recentDone && recentDone.status === "done",
          });
          if (pose === "working") pose = busyPoseFor(`${agent.id}:${working?.id ?? ""}`);
          const line =
            (pose === "idle" || pose === "done") && myTodos[0]
              ? `Next up: ${myTodos[0].title}`
              : lineFor(pose, openTasks, working ?? mine[0]);
          return { agent, pose, line, sessions: mine, openTasks, todos: myTodos };
        });
      return { team, project, members };
    })
    .filter((t) => t.members.length > 0 || !!projectId);
}

function lineFor(pose: Pose, openTasks: TaskRow[], session: SessionRow | undefined): string {
  const topic = session?.summary || session?.title || "";
  switch (pose) {
    case "needs_you":
    case "review":
    case "failed":
      return openTasks[0]?.title ?? topic;
    case "working":
    case "thinking":
    case "reading":
    case "call":
      return `On it: ${session?.status_detail || topic}`;
    case "done":
      return `Shipped: ${topic}`;
    default:
      return topic ? `Last up: ${topic}` : "Waiting for work";
  }
}

export interface SourceStats {
  source: string;
  sessions: number;
  lastImport: { finished_at: string | null; imported: number; updated: number; error: string | null } | null;
}

export async function getSourceStats(): Promise<SourceStats[]> {
  return ["cloud", "local", "claude_ai"].map((source) => ({
    source,
    sessions: scalar("select count(*) from sessions where source = ?", source),
    lastImport: get<NonNullable<SourceStats["lastImport"]>>(
      "select finished_at, imported, updated, error from import_runs where source = ? order by started_at desc limit 1",
      source,
    ),
  }));
}

export async function getSessions(
  filter: {
    projectId?: string;
    agentId?: string;
    teamId?: string;
    status?: string;
    source?: string;
    q?: string;
    archived?: boolean;
    unfiled?: boolean;
    limit?: number;
  } = {},
): Promise<SessionRow[]> {
  const where = ["archived = ?"];
  const params: (string | number | boolean)[] = [!!filter.archived];
  const add = (sql: string, value?: string) => {
    where.push(sql);
    if (value !== undefined) params.push(value);
  };
  if (filter.teamId) add("team_id = ?", filter.teamId);
  if (filter.unfiled) add("agent_id is null");
  if (filter.projectId) add("project_id = ?", filter.projectId);
  if (filter.agentId) add("agent_id = ?", filter.agentId);
  if (filter.status) add("coalesce(status_override, status) = ?", filter.status);
  if (filter.source) add("source = ?", filter.source);
  if (filter.q) add("title like ? escape '\\'", `%${filter.q.replace(/[\\%_]/g, "\\$&")}%`);
  return all<SessionRow>(
    `select ${SESSION_LIST_COLUMNS} from sessions where ${where.join(" and ")} order by last_activity_at desc nulls last limit ?`,
    ...params,
    filter.limit ?? 500,
  );
}

export async function getProjectBySlug(slug: string): Promise<ProjectRow | null> {
  return get<ProjectRow>("select * from projects where slug = ?", slug);
}

export interface TodoItem {
  task: TaskRow;
  agent: AgentRow | null;
  project: ProjectRow | null;
  goal: GoalRow | null;
}

/** Hand-written to-dos. `mine` = assigned to you (no teammate). */
export async function getTodos(filter: { mine?: boolean; projectId?: string; includeDone?: boolean } = {}): Promise<TodoItem[]> {
  const tasks = all<TaskRow>(
    `select * from tasks
     where origin = 'manual' and (? = 0 or agent_id is null) and (? is null or project_id = ?) and (? = 1 or status <> 'done')
     order by created_at desc`,
    !!filter.mine,
    filter.projectId ?? null,
    filter.projectId ?? null,
    !!filter.includeDone,
  );
  const org = await getOrg();
  const rank = { high: 0, normal: 1, low: 2 } as const;
  return tasks
    .map((task) => ({
      task,
      agent: org.agents.find((a) => a.id === task.agent_id) ?? null,
      project: org.projects.find((p) => p.id === task.project_id) ?? null,
      goal: org.goals.find((g) => g.id === task.goal_id) ?? null,
    }))
    .sort((a, b) => {
      const done = Number(a.task.status === "done") - Number(b.task.status === "done");
      if (done) return done;
      const due = (a.task.due_date ?? "9999") .localeCompare(b.task.due_date ?? "9999");
      return due || rank[a.task.priority] - rank[b.task.priority];
    });
}

export interface GoalView {
  goal: GoalRow;
  team: TeamRow | null;
  milestones: MilestoneRow[];
  sessions: SessionRow[];
  todos: TaskRow[];
  /** 0..1 — finished milestones, done sessions and done to-dos over all of them. */
  progress: number;
}

export async function getGoals(projectId: string): Promise<GoalView[]> {
  const org = await getOrg();
  const goals = org.goals.filter((g) => g.project_id === projectId);
  if (!goals.length) return [];
  const ids = goals.map((g) => g.id);
  const M = all<MilestoneRow>("select * from goal_milestones where goal_id in (select value from json_each(?)) order by position", ids);
  const S = all<SessionRow>(
    `select ${SESSION_LIST_COLUMNS} from sessions where goal_id in (select value from json_each(?)) and archived = 0`,
    ids,
  );
  const T = all<TaskRow>("select * from tasks where origin = 'manual' and goal_id in (select value from json_each(?))", ids);
  const rank = { active: 0, achieved: 1, dropped: 2 } as const;
  return goals
    .map((goal) => {
      const m = M.filter((x) => x.goal_id === goal.id);
      const s = S.filter((x) => x.goal_id === goal.id);
      const t = T.filter((x) => x.goal_id === goal.id);
      return { goal, team: org.teams.find((x) => x.id === goal.team_id) ?? null, milestones: m, sessions: s, todos: t, progress: goalProgress(m, s, t) };
    })
    .sort((a, b) => rank[a.goal.status] - rank[b.goal.status] || (a.goal.due_date ?? "9999").localeCompare(b.goal.due_date ?? "9999"));
}

/** Goals achieved in the last day, keyed by project — the office throws confetti for these. */
export async function getRecentWins(): Promise<Map<string, GoalRow[]>> {
  const since = new Date(Date.now() - DAY).toISOString();
  const rows = all<GoalRow>("select * from goals where status = 'achieved' and achieved_at >= ?", since);
  const out = new Map<string, GoalRow[]>();
  for (const g of rows) out.set(g.project_id, [...(out.get(g.project_id) ?? []), g]);
  return out;
}

/** Plain option lists for client-side pickers. */
export interface OrgOptions {
  companies: { id: string; name: string; emoji: string; slug: string }[];
  projects: { id: string; name: string; emoji: string; slug: string; company_id: string | null }[];
  teams: { id: string; name: string; project_id: string }[];
  goals: { id: string; title: string; project_id: string; status: string }[];
  agents: { id: string; name: string; role: string; project_id: string; team_id: string; avatar: AgentRow["avatar"] }[];
}

export function orgOptions(org: Org): OrgOptions {
  return {
    companies: org.companies.map(({ id, name, emoji, slug }) => ({ id, name, emoji, slug })),
    projects: org.projects.map(({ id, name, emoji, slug, company_id }) => ({ id, name, emoji, slug, company_id })),
    teams: org.teams.map(({ id, name, project_id }) => ({ id, name, project_id })),
    goals: org.goals.map(({ id, title, project_id, status }) => ({ id, title, project_id, status })),
    agents: org.agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      avatar: a.avatar,
      team_id: a.team_id,
      project_id: org.teams.find((t) => t.id === a.team_id)?.project_id ?? "",
    })),
  };
}

/** Every team as a "move sessions here" choice, labelled with its project. */
export function teamTargets(org: Org): { id: string; label: string; project_id: string }[] {
  return org.teams.map((t) => {
    const p = org.projects.find((x) => x.id === t.project_id);
    return { id: t.id, label: `${p?.emoji ?? ""} ${p?.name ?? "?"} / ${t.name}`.trim(), project_id: t.project_id };
  });
}

/** Where a teammate sits: their team, project and company. */
export function placeOf(org: Org, agentId: string | null | undefined) {
  const agent = org.agents.find((a) => a.id === agentId) ?? null;
  const team = org.teams.find((t) => t.id === agent?.team_id) ?? null;
  const project = org.projects.find((p) => p.id === team?.project_id) ?? null;
  const company = org.companies.find((c) => c.id === project?.company_id) ?? null;
  return { agent, team, project, company };
}

export async function getCompanyBySlug(slug: string): Promise<CompanyRow | null> {
  return get<CompanyRow>("select * from companies where slug = ?", slug);
}

export interface SessionDetail {
  session: SessionRow & { raw: Record<string, unknown>; imported_at: string };
  tasks: TaskRow[];
  agent: AgentRow | null;
  team: TeamRow | null;
  project: ProjectRow | null;
  company: CompanyRow | null;
  goal: GoalRow | null;
  org: Org;
}

export async function getSessionDetail(id: string): Promise<SessionDetail | null> {
  const session = get<SessionDetail["session"]>("select * from sessions where id = ?", id);
  if (!session) return null;
  const tasks = all<TaskRow>("select * from tasks where session_id = ? order by raised_at desc", id);
  const org = await getOrg();
  const agent = org.agents.find((a) => a.id === session.agent_id) ?? null;
  const team = org.teams.find((t) => t.id === (agent?.team_id ?? session.team_id)) ?? null;
  const project = org.projects.find((p) => p.id === (session.project_id ?? team?.project_id)) ?? null;
  return {
    session,
    tasks,
    agent,
    team,
    project,
    company: org.companies.find((c) => c.id === project?.company_id) ?? null,
    goal: org.goals.find((g) => g.id === session.goal_id) ?? null,
    org,
  };
}
