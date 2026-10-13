import "server-only";
import { all, scalar } from "./db";
import { busyPoseFor, poseFor, type Pose } from "./avatar";
import { goalProgress } from "./progress";
import { getInbox, getOrg, type InboxItem, type Org } from "./queries";
import { computeSignals, groupDepartments, isBigCompany, sumSignals, HEALTH_RANK, type Signals } from "./signals";
import type { AgentRow, CompanyRow, MilestoneRow, ProjectRow, TaskRow, TeamRow } from "./types";
import type { NavCompany, NavCounts } from "@/components/Nav";

/** The light slice of a session the structure views need. */
export interface LiteSession {
  id: string;
  project_id: string | null;
  team_id: string | null;
  agent_id: string | null;
  goal_id: string | null;
  status: string;
  last_activity_at: string | null;
  started_at: string | null;
}

export async function getLiteSessions(): Promise<LiteSession[]> {
  return all<LiteSession>(
    "select id, project_id, team_id, agent_id, goal_id, coalesce(status_override, status) as status, last_activity_at, started_at from sessions where archived = 0 order by id",
  );
}

/** Progress (0..1) of every goal, from its milestones, linked sessions and to-dos. */
export async function getGoalProgressMap(sessions: LiteSession[]): Promise<Map<string, number>> {
  const milestones = all<MilestoneRow>("select * from goal_milestones order by id");
  const todos = all<TaskRow>("select id, goal_id, status from tasks where origin = 'manual' and goal_id is not null order by id");
  const ids = new Set([...milestones.map((m) => m.goal_id), ...todos.map((t) => t.goal_id!), ...sessions.filter((s) => s.goal_id).map((s) => s.goal_id!)]);
  const out = new Map<string, number>();
  for (const id of ids) {
    out.set(
      id,
      goalProgress(
        milestones.filter((m) => m.goal_id === id),
        sessions.filter((s) => s.goal_id === id),
        todos.filter((t) => t.goal_id === id),
      ),
    );
  }
  return out;
}

export interface ProjectCard {
  project: ProjectRow;
  signals: Signals;
  teams: TeamRow[];
  people: AgentRow[];
}

export interface DepartmentCard {
  key: string;
  name: string;
  teams: (TeamRow & { project: ProjectRow })[];
  people: AgentRow[];
  signals: Signals;
}

export interface CompanyCard {
  /** null = projects without a company */
  company: CompanyRow | null;
  projects: ProjectCard[];
  /** Only for big companies. */
  departments: DepartmentCard[] | null;
  signals: Signals;
}

export interface CastMember {
  agent: AgentRow;
  pose: Pose;
  asks: number;
}

export interface HomeData {
  org: Org;
  companies: CompanyCard[];
  totals: Signals;
  unfiled: number;
  inbox: InboxItem[];
  /** The most interesting teammates right now (asking, working, just shipped). */
  cast: CastMember[];
}

export async function getHome(): Promise<HomeData> {
  const org = await getOrg();
  const [sessions, inbox] = await Promise.all([getLiteSessions(), getInbox(org)]);
  const progress = await getGoalProgressMap(sessions);
  const now = Date.now();

  const asksByProject = new Map<string, number>();
  const asksByTeam = new Map<string, number>();
  for (const it of inbox) {
    if (it.project) asksByProject.set(it.project.id, (asksByProject.get(it.project.id) ?? 0) + 1);
    if (it.team) asksByTeam.set(it.team.id, (asksByTeam.get(it.team.id) ?? 0) + 1);
  }
  const goalsFor = (pred: (g: Org["goals"][number]) => boolean) =>
    org.goals.filter(pred).map((g) => ({ status: g.status, progress: progress.get(g.id) ?? 0 }));

  const projectCard = (project: ProjectRow): ProjectCard => {
    const teams = org.teams.filter((t) => t.project_id === project.id);
    const teamIds = new Set(teams.map((t) => t.id));
    const people = org.agents.filter((a) => teamIds.has(a.team_id));
    const signals = computeSignals(
      {
        sessions: sessions.filter((s) => s.project_id === project.id),
        asks: asksByProject.get(project.id) ?? 0,
        goals: goalsFor((g) => g.project_id === project.id),
        people: people.length,
      },
      now,
    );
    return { project, signals, teams, people };
  };

  const byUrgency = (a: ProjectCard, b: ProjectCard) =>
    HEALTH_RANK[a.signals.health] - HEALTH_RANK[b.signals.health] ||
    b.signals.asks - a.signals.asks ||
    (b.signals.lastActive ?? "").localeCompare(a.signals.lastActive ?? "");

  const companyCard = (company: CompanyRow | null): CompanyCard => {
    const projects = org.projects
      .filter((p) => (company ? p.company_id === company.id : !p.company_id))
      .map(projectCard)
      .sort(byUrgency);
    const teams = projects.flatMap((p) => p.teams.map((t) => ({ ...t, project: p.project })));
    let departments: DepartmentCard[] | null = null;
    const grouped = company && isBigCompany(projects.length, teams.length) ? groupDepartments(teams) : [];
    // Departments only add something when they group teams across projects (or there are many teams).
    if (grouped.length > 1 && (grouped.some((d) => d.teams.length > 1) || teams.length >= 5)) {
      departments = grouped.map((d) => {
        const teamIds = new Set(d.teams.map((t) => t.id));
        const people = org.agents.filter((a) => teamIds.has(a.team_id));
        const signals = computeSignals(
          {
            sessions: sessions.filter((s) => s.team_id && teamIds.has(s.team_id)),
            asks: d.teams.reduce((n, t) => n + (asksByTeam.get(t.id) ?? 0), 0),
            goals: goalsFor((g) => !!g.team_id && teamIds.has(g.team_id)),
            people: people.length,
          },
          now,
        );
        return { key: d.key, name: d.name, teams: d.teams, people, signals };
      });
    }
    return { company, projects, departments, signals: sumSignals(projects.map((p) => p.signals), now) };
  };

  const companies = org.companies
    .map(companyCard)
    .sort((a, b) => b.signals.asks - a.signals.asks || (a.company?.name ?? "").localeCompare(b.company?.name ?? ""));
  const loose = companyCard(null);
  if (loose.projects.length) companies.push(loose);

  const kindsByAgent = new Map<string, string[]>();
  for (const it of inbox) if (it.agent) kindsByAgent.set(it.agent.id, [...(kindsByAgent.get(it.agent.id) ?? []), it.task.kind]);
  const cast = org.agents
    .map((agent) => {
      const mine = sessions.filter((s) => s.agent_id === agent.id);
      const working = mine.find((s) => s.status === "working");
      const recentlyDone = mine.some((s) => s.status === "done" && !!s.last_activity_at && now - Date.parse(s.last_activity_at) < 86_400_000);
      const kinds = kindsByAgent.get(agent.id) ?? [];
      let pose = poseFor({ openTaskKinds: kinds, working: !!working, recentlyDone });
      if (pose === "working") pose = busyPoseFor(`${agent.id}:${working?.id ?? ""}`);
      const rank = kinds.length ? 0 : working ? 1 : recentlyDone ? 2 : 3;
      return { agent, pose, asks: kinds.length, rank };
    })
    .sort((a, b) => a.rank - b.rank || b.asks - a.asks)
    .slice(0, 7)
    .map((m) => ({ agent: m.agent, pose: m.pose, asks: m.asks }));

  return {
    org,
    cast,
    companies,
    totals: computeSignals({ sessions, asks: inbox.length, goals: goalsFor(() => true), people: org.agents.length }, now),
    unfiled: sessions.filter((s) => !s.agent_id).length,
    inbox,
  };
}

export async function countUnfiled(): Promise<number> {
  return scalar("select count(*) from sessions where archived = 0 and agent_id is null");
}

/** Open asks (including snoozes that ran out), counted per project. */
export async function getAskCounts(org: Org): Promise<{ total: number; byProject: Map<string, number> }> {
  const now = new Date().toISOString();
  const tasks = all<{ id: string; session_id: string }>(
    "select id, session_id from tasks where session_id is not null and (status = 'open' or (status = 'snoozed' and snoozed_until < ?)) order by id",
    now,
  );
  const sessions = all<{ id: string; project_id: string | null; team_id: string | null; agent_id: string | null }>(
    "select id, project_id, team_id, agent_id from sessions where id in (select value from json_each(?))",
    [...new Set(tasks.map((t) => t.session_id))],
  );
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const byProject = new Map<string, number>();
  let total = 0;
  for (const t of tasks) {
    const s = byId.get(t.session_id);
    if (!s) continue;
    total++;
    const agent = org.agents.find((a) => a.id === s.agent_id);
    const team = org.teams.find((x) => x.id === (agent?.team_id ?? s.team_id));
    const projectId = s.project_id ?? team?.project_id;
    if (projectId) byProject.set(projectId, (byProject.get(projectId) ?? 0) + 1);
  }
  return { total, byProject };
}

/** Sidebar data: badge counts and the company → project tree. */
export async function getNav(): Promise<{ counts: NavCounts; tree: NavCompany[] }> {
  const org = await getOrg();
  const [asks, unfiled] = await Promise.all([getAskCounts(org), countUnfiled()]);
  const todos = scalar("select count(*) from tasks where origin = 'manual' and status <> 'done' and agent_id is null");
  const project = (p: ProjectRow) => ({ id: p.id, name: p.name, emoji: p.emoji, slug: p.slug, asks: asks.byProject.get(p.id) ?? 0 });
  const tree: NavCompany[] = org.companies.map((c) => {
    const projects = org.projects.filter((p) => p.company_id === c.id).map(project);
    return { id: c.id, name: c.name, emoji: c.emoji, slug: c.slug, asks: projects.reduce((n, p) => n + p.asks, 0), projects };
  });
  const loose = org.projects.filter((p) => !p.company_id).map(project);
  if (loose.length) tree.push({ id: null, name: "No company", emoji: "📦", slug: null, asks: loose.reduce((n, p) => n + p.asks, 0), projects: loose });
  return { counts: { inbox: asks.total, unfiled, todos }, tree };
}
