import { boardStatus, SESSION_STATUS } from "@/components/board/palette";
import { resumeFor } from "../links";
import type { AgentRow, CompanyRow, GoalRow, MilestoneRow, ProjectRow, SessionRow, TaskRow, TeamRow } from "../types";
import type { StatusIntent } from "./statuses";

/**
 * What the org should look like in ClickUp, worked out from Timu's rows alone (no requests), so it is
 * easy to test. Everything goes in one Space:
 *
 *   Space "Timu"
 *   ├─ Folder "<Company> · <emoji> <Project>"   (one per project)
 *   │  ├─ List "<Team>"                          (one per team: its sessions)
 *   │  ├─ List "No team"                         (sessions filed to the project but no team)
 *   │  ├─ List "🎯 Goals"                         (goals; milestones are their subtasks)
 *   │  └─ List "✅ To-dos"
 *   ├─ List "📥 Unfiled sessions"
 *   └─ List "✅ To-dos"                           (to-dos with no project)
 *
 * A session shows the status its board cell shows (`boardStatus`), and teammates are tags.
 */

export type MirrorSession = Pick<
  SessionRow,
  | "id"
  | "source"
  | "external_id"
  | "title"
  | "url"
  | "repo"
  | "branch"
  | "status"
  | "status_override"
  | "status_detail"
  | "summary"
  | "started_at"
  | "last_activity_at"
  | "project_id"
  | "team_id"
  | "agent_id"
  | "goal_id"
  | "archived"
  | "account"
  | "local_id"
>;

export type MirrorAsk = Pick<TaskRow, "session_id" | "kind" | "title" | "detail" | "status" | "snoozed_until">;
export type MirrorTodo = Pick<TaskRow, "id" | "title" | "detail" | "status" | "snoozed_until" | "agent_id" | "project_id" | "goal_id" | "due_date" | "priority">;
export interface MirrorArtifact {
  url: string;
  title: string | null;
  session_id: string;
}

export interface MirrorSnapshot {
  companies: CompanyRow[];
  projects: ProjectRow[];
  teams: TeamRow[];
  agents: AgentRow[];
  goals: GoalRow[];
  milestones: MilestoneRow[];
  sessions: MirrorSession[];
  /** Session asks that aren't done (one per session at most). */
  asks: MirrorAsk[];
  todos: MirrorTodo[];
  artifacts: MirrorArtifact[];
}

export interface PlannedFolder {
  key: string;
  name: string;
}

export interface PlannedList {
  key: string;
  name: string;
  /** The folder's key, or null for a list straight in the space. */
  folder: string | null;
}

export interface PlannedTask {
  key: string;
  list: string;
  /** The parent task's key (a milestone's goal). */
  parent: string | null;
  name: string;
  markdown: string;
  status: StatusIntent;
  tags: string[];
  /** ClickUp priority: 2 high, 4 low, null normal. */
  priority: number | null;
  dueDate: number | null;
  startDate: number | null;
  archived: boolean;
  /** Not worth creating if it isn't in ClickUp yet (an archived session, a finished to-do); still updated if it is. */
  skipIfNew: boolean;
}

export interface MirrorPlan {
  folders: PlannedFolder[];
  lists: PlannedList[];
  /** In the order to write them: goals before their milestones, recent sessions first. */
  tasks: PlannedTask[];
}

export const LIST_NAMES = { loose: "No team", goals: "🎯 Goals", todos: "✅ To-dos", unfiled: "📥 Unfiled sessions" } as const;

const FOOTER = "_Mirrored from Timu. Edits made here are replaced the next time this changes in Timu._";

const SOURCE_LABEL: Record<string, string> = {
  cloud: "Claude Code on the web",
  local: "Claude Code in the terminal",
  claude_ai: "claude.ai chat",
};
const ASK_LABEL: Record<string, string> = { respond: "reply", review: "review", decide: "decide", unblock: "unblock", run: "run", todo: "to-do" };
const GOAL_LABEL = { active: "Active", achieved: "Achieved", dropped: "Dropped" } as const;

const MAX_NAME = 200;
const name = (s: string, fallback: string) => {
  const t = s.replace(/\s+/g, " ").trim() || fallback;
  return t.length > MAX_NAME ? `${t.slice(0, MAX_NAME - 1)}…` : t;
};
/** Link text can't hold brackets. */
const linkText = (s: string) => s.replace(/[[\]]/g, (c) => (c === "[" ? "(" : ")"));
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const minute = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : null);
/** A date-only due date at noon UTC, so it lands on the same day in nearly every time zone. */
const dueMs = (d: string | null | undefined): number | null => {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null;
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
};
const ms = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};
const priorityOf = (p: string) => (p === "high" ? 2 : p === "low" ? 4 : null);
const tagOf = (agent: AgentRow | undefined) => (agent ? [agent.name.trim().toLowerCase()].filter(Boolean) : []);
const bullets = (rows: [string, string | null | undefined][]) =>
  rows.filter(([, v]) => v).map(([k, v]) => `- **${k}:** ${v}`).join("\n");
const paragraphs = (...parts: (string | null | undefined | false)[]) => parts.filter((p): p is string => !!p && !!p.trim()).join("\n\n");

export function folderName(project: ProjectRow, company: CompanyRow | undefined): string {
  const p = `${project.emoji} ${project.name}`.trim();
  return name(company ? `${company.name} · ${p}` : p, "Project");
}

export function planMirror(s: MirrorSnapshot): MirrorPlan {
  const companies = new Map(s.companies.map((c) => [c.id, c]));
  const projects = new Map(s.projects.map((p) => [p.id, p]));
  const teams = new Map(s.teams.map((t) => [t.id, t]));
  const agents = new Map(s.agents.map((a) => [a.id, a]));
  const goals = new Map(s.goals.map((g) => [g.id, g]));
  const asks = new Map(s.asks.filter((a) => a.session_id).map((a) => [a.session_id!, a]));
  const artifacts = new Map<string, MirrorArtifact[]>();
  for (const a of s.artifacts) artifacts.set(a.session_id, [...(artifacts.get(a.session_id) ?? []), a]);

  const folders: PlannedFolder[] = s.projects.map((p) => ({ key: `folder:${p.id}`, name: folderName(p, p.company_id ? companies.get(p.company_id) : undefined) }));
  const lists = new Map<string, PlannedList>();
  for (const t of s.teams) if (projects.has(t.project_id)) lists.set(`list:team:${t.id}`, { key: `list:team:${t.id}`, name: name(t.name, "Team"), folder: `folder:${t.project_id}` });
  const needList = (key: string, listName: string, folder: string | null) => {
    if (!lists.has(key)) lists.set(key, { key, name: listName, folder });
    return key;
  };
  const projectList = (kind: "loose" | "goals" | "todos", projectId: string) => needList(`list:${kind}:${projectId}`, LIST_NAMES[kind], `folder:${projectId}`);

  const tasks: PlannedTask[] = [];

  // Goals, then their milestones as subtasks.
  for (const g of s.goals) {
    if (!projects.has(g.project_id)) continue;
    const list = projectList("goals", g.project_id);
    const ms_ = s.milestones.filter((m) => m.goal_id === g.id);
    const team = g.team_id ? teams.get(g.team_id) : undefined;
    tasks.push({
      key: `goal:${g.id}`,
      list,
      parent: null,
      name: name(g.title, "Untitled goal"),
      markdown: paragraphs(
        g.description,
        bullets([
          ["Status", g.status === "achieved" && g.achieved_at ? `Achieved on ${day(g.achieved_at)}` : GOAL_LABEL[g.status]],
          ["Team", team?.name],
          ["Due", day(g.due_date)],
          ["Milestones", ms_.length ? `${ms_.filter((m) => m.done).length} of ${ms_.length} done (subtasks)` : null],
        ]),
        FOOTER,
      ),
      status: g.status === "achieved" ? "done" : g.status === "dropped" ? "dropped" : "working",
      tags: [],
      priority: priorityOf(g.priority),
      dueDate: dueMs(g.due_date),
      startDate: null,
      archived: false,
      skipIfNew: false,
    });
  }
  for (const m of [...s.milestones].sort((a, b) => a.position - b.position)) {
    const g = goals.get(m.goal_id);
    if (!g || !projects.has(g.project_id)) continue;
    tasks.push({
      key: `milestone:${m.id}`,
      list: projectList("goals", g.project_id),
      parent: `goal:${g.id}`,
      name: name(m.title, "Milestone"),
      markdown: paragraphs(bullets([["Milestone of", g.title], ["Done", m.done ? day(m.done_at) ?? "yes" : null]]), FOOTER),
      status: m.done ? "done" : "idle",
      tags: [],
      priority: null,
      dueDate: null,
      startDate: null,
      archived: false,
      skipIfNew: false,
    });
  }

  // To-dos: in their project's To-dos list, else the space's.
  for (const t of s.todos) {
    const list = t.project_id && projects.has(t.project_id) ? projectList("todos", t.project_id) : needList("list:todos:none", LIST_NAMES.todos, null);
    const agent = t.agent_id ? agents.get(t.agent_id) : undefined;
    const goal = t.goal_id ? goals.get(t.goal_id) : undefined;
    const snoozed = t.status === "snoozed";
    tasks.push({
      key: `todo:${t.id}`,
      list,
      parent: null,
      name: name(t.title, "To-do"),
      markdown: paragraphs(
        t.detail,
        bullets([
          ["For", agent ? `${agent.name} (${agent.role})` : "you"],
          ["Goal", goal?.title],
          ["Snoozed until", snoozed ? minute(t.snoozed_until) : null],
        ]),
        FOOTER,
      ),
      status: t.status === "done" ? "done" : snoozed ? "snoozed" : "idle",
      tags: tagOf(agent),
      priority: priorityOf(t.priority),
      dueDate: dueMs(t.due_date),
      startDate: null,
      archived: false,
      skipIfNew: t.status === "done",
    });
  }

  // Sessions, most recently active first, so a long first push fills in what matters soonest.
  const recent = [...s.sessions].sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
  for (const x of recent) {
    const agent = x.agent_id ? agents.get(x.agent_id) : undefined;
    const team = teams.get(agent?.team_id ?? x.team_id ?? "");
    const projectId = x.project_id ?? team?.project_id ?? null;
    const project = projectId ? projects.get(projectId) : undefined;
    const list = !project
      ? needList("list:unfiled", LIST_NAMES.unfiled, null)
      : team && team.project_id === project.id
        ? `list:team:${team.id}`
        : projectList("loose", project.id);
    const ask = asks.get(x.id);
    const status = boardStatus(x, !!ask) as StatusIntent;
    // Asks are often raised from the status detail: say each thing once.
    const askDetail = ask?.detail && ask.detail.trim() !== ask.title.trim() ? ask.detail : null;
    const detail = x.status_detail && ![ask?.title, ask?.detail].some((t) => t?.trim() === x.status_detail!.trim()) ? x.status_detail : null;
    const goal = x.goal_id ? goals.get(x.goal_id) : undefined;
    const resume = resumeFor(x);
    const made = artifacts.get(x.id) ?? [];
    tasks.push({
      key: `session:${x.id}`,
      list,
      parent: null,
      name: name(x.title, "Untitled session"),
      markdown: paragraphs(
        ask
          ? `> 🙋 **Needs you (${ASK_LABEL[ask.kind] ?? ask.kind}):** ${ask.title}${askDetail ? `\n> ${askDetail.replace(/\n+/g, "\n> ")}` : ""}${
              ask.status === "snoozed" && ask.snoozed_until ? `\n> _Snoozed until ${minute(ask.snoozed_until)}_` : ""
            }`
          : null,
        x.summary,
        bullets([
          ["Status", `${SESSION_STATUS[status]?.label ?? status}${detail ? ` — ${detail}` : ""}`],
          ["Teammate", agent ? `${agent.name} (${agent.role}${team ? ` · ${team.name}` : ""})` : null],
          ["Goal", goal?.title],
          ["Source", `${SOURCE_LABEL[x.source] ?? x.source}${x.account ? ` · account ${x.account}` : ""}`],
          ["Repo", x.repo ? `${x.repo}${x.branch ? ` @ ${x.branch}` : ""}` : null],
          ["Started", minute(x.started_at)],
        ]),
        [x.url ? `[Open the session ↗](${x.url})` : null, resume ? `Resume in the terminal: \`${resume}\`` : null].filter(Boolean).join("  \n"),
        made.length ? `**Artifacts:** ${made.map((a) => `[${linkText(a.title || "Artifact")}](${a.url})`).join(" · ")}` : null,
        FOOTER,
      ),
      status,
      tags: tagOf(agent),
      priority: null,
      dueDate: null,
      startDate: ms(x.started_at),
      archived: x.archived,
      skipIfNew: x.archived,
    });
  }

  return { folders, lists: [...lists.values()], tasks };
}
