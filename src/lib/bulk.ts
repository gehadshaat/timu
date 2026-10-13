import "server-only";
import { propForRole } from "./classify/heuristic";
import type { CommentRow } from "./comments";
import { all, cleanIds, get, insert, isUuid, run, scalar, tx, update } from "./db";
import { startOrganize } from "./organize";
import { parseLines, parsePersonLine } from "./quickadd";
import type { Priority, TaskRow } from "./types";

/**
 * Bulk operations, shared by the UI's server actions and the MCP tools. Each returns how
 * many rows changed and, where it can be undone, a snapshot to hand to `applyUndo`: full
 * task rows (restored with an upsert), the previous filing of sessions, people or projects
 * (restored with updates), or the ids a bulk add created (deleted again).
 */

export interface SessionPrev {
  id: string;
  agent_id: string | null;
  team_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  archived: boolean;
  classified_at: string | null;
  triage: unknown;
  status_override: string | null;
}

export interface UndoSnapshot {
  tasks?: TaskRow[];
  sessions?: SessionPrev[];
  agents?: { id: string; team_id: string }[];
  projects?: { id: string; company_id: string | null }[];
  goals?: { id: string; status: "active" | "achieved" | "dropped"; achieved_at: string | null }[];
  /** Deleted comments; undo puts them back. */
  comments?: CommentRow[];
  /** Rows a bulk add created; undo deletes them. */
  created?: { table: CreatedTable; ids: string[] }[];
}

type CreatedTable = "tasks" | "goals" | "goal_milestones" | "agents";
const CREATED_TABLES: CreatedTable[] = ["tasks", "goals", "goal_milestones", "agents"];

export interface BulkResult {
  ok: boolean;
  message: string;
  count: number;
  undo?: UndoSnapshot;
  /** For adds: the ids of the new rows. */
  ids?: string[];
}

const PRIORITIES: Priority[] = ["low", "normal", "high"];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fail = (err: unknown): BulkResult => ({ ok: false, count: 0, message: err instanceof Error ? err.message : String(err) });
const done = (message: string, count: number, undo?: UndoSnapshot, ids?: string[]): BulkResult => ({ ok: true, message, count, undo, ids });

const SESSION_PREV = "id, agent_id, team_id, project_id, goal_id, archived, classified_at, triage, status_override";

/** `column in (…)` with the id array bound as one JSON param. */
const IN = "in (select value from json_each(?))";

/** A row that must exist, like `.single()`: throws when it's missing. */
function need<T>(row: T | null, what: string): T {
  if (!row) throw new Error(`${what}: not found`);
  return row;
}

// ---------- asks (session tasks) ----------

export type TaskOp = { type: "handled" } | { type: "not_needed" } | { type: "snooze"; hours: number } | { type: "reopen" };

export async function bulkTasks(rawIds: string[], op: TaskOp): Promise<BulkResult> {
  const requested = cleanIds(rawIds);
  if (!requested.length) return { ok: false, count: 0, message: "Nothing selected." };
  try {
    // Only ever inbox asks: hand-written to-dos have their own operations.
    const before = all<TaskRow>(`select * from tasks where id ${IN} and origin <> 'manual'`, requested);
    if (!before.length) return { ok: false, count: 0, message: "None of those are inbox asks." };
    const ids = before.map((t) => t.id);
    const now = new Date().toISOString();
    let message = "";
    const undo: UndoSnapshot = { tasks: before };
    if (op.type === "handled") {
      update("tasks", { status: "done", resolved_at: now }, `id ${IN}`, ids);
      message = `${plural(ids.length, "ask")} handled ✓`;
    } else if (op.type === "not_needed") {
      const verdict = { needed: false, kind: "none", confidence: 1, engine: "you", reason: "You said it wasn't needed", at: now };
      const sessionIds = [...new Set(before.map((t) => t.session_id).filter((x): x is string => !!x))];
      undo.sessions = all<SessionPrev>(`select ${SESSION_PREV} from sessions where id ${IN}`, sessionIds);
      tx(() => {
        update("tasks", { status: "done", resolved_at: now, judge: verdict }, `id ${IN}`, ids);
        update("sessions", { triage: verdict }, `id ${IN}`, sessionIds);
      });
      message = `${plural(ids.length, "ask")} dismissed`;
    } else if (op.type === "snooze") {
      const hours = Math.min(24 * 90, Math.max(1, Number(op.hours) || 24));
      update("tasks", { status: "snoozed", snoozed_until: new Date(Date.now() + hours * 3600_000).toISOString() }, `id ${IN}`, ids);
      message = `${plural(ids.length, "ask")} snoozed`;
    } else {
      update("tasks", { status: "open", resolved_at: null, snoozed_until: null }, `id ${IN}`, ids);
      message = `${plural(ids.length, "ask")} reopened`;
    }
    return done(message, ids.length, undo);
  } catch (err) {
    return fail(err);
  }
}

// ---------- sessions ----------

export type SessionOp =
  | { type: "assign"; agentId: string }
  | { type: "team"; teamId: string }
  | { type: "project"; projectId: string | null }
  | { type: "goal"; goalId: string | null }
  | { type: "unassign" }
  | { type: "archive" }
  | { type: "unarchive" }
  | { type: "refile" }
  /** Set the board status by hand: "needs_you" opens an ask, "done"/"idle" close any; null goes back to Claude's status. */
  | { type: "status"; status: "needs_you" | "done" | "idle" | null };

export async function bulkSessions(rawIds: string[], op: SessionOp): Promise<BulkResult> {
  const ids = cleanIds(rawIds);
  if (!ids.length) return { ok: false, count: 0, message: "Nothing selected." };
  try {
    const undo: UndoSnapshot = { sessions: all<SessionPrev>(`select ${SESSION_PREV} from sessions where id ${IN}`, ids) };
    let message = "";
    switch (op.type) {
      case "assign": {
        if (!isUuid(op.agentId)) return { ok: false, count: 0, message: "Pick a teammate." };
        const agent = need(
          get<{ id: string; name: string; team_id: string; project_id: string }>(
            "select a.id, a.name, a.team_id, t.project_id from agents a join teams t on t.id = a.team_id where a.id = ?",
            op.agentId,
          ),
          "load teammate",
        );
        update("sessions", { agent_id: agent.id, team_id: agent.team_id, project_id: agent.project_id }, `id ${IN}`, ids);
        message = `${plural(ids.length, "session")} → ${agent.name}`;
        break;
      }
      case "team": {
        if (!isUuid(op.teamId)) return { ok: false, count: 0, message: "Pick a team." };
        const team = need(get<{ id: string; name: string; project_id: string }>("select id, name, project_id from teams where id = ?", op.teamId), "load team");
        const first = get<{ id: string }>("select id from agents where team_id = ? order by created_at limit 1", team.id);
        update("sessions", { team_id: team.id, project_id: team.project_id, agent_id: first?.id ?? null }, `id ${IN}`, ids);
        message = `${plural(ids.length, "session")} → ${team.name}`;
        break;
      }
      case "project": {
        if (op.projectId !== null && !isUuid(op.projectId)) return { ok: false, count: 0, message: "Pick a project." };
        update("sessions", { project_id: op.projectId, team_id: null, agent_id: null, goal_id: null }, `id ${IN}`, ids);
        message = op.projectId ? `${plural(ids.length, "session")} moved to the project` : `${plural(ids.length, "session")} removed from their project`;
        break;
      }
      case "goal": {
        if (op.goalId === null) {
          update("sessions", { goal_id: null }, `id ${IN}`, ids);
          message = `${plural(ids.length, "session")} unlinked from their goal`;
        } else {
          if (!isUuid(op.goalId)) return { ok: false, count: 0, message: "Pick a goal." };
          const goal = need(get<{ project_id: string; title: string }>("select project_id, title from goals where id = ?", op.goalId), "load goal");
          update("sessions", { goal_id: op.goalId, project_id: goal.project_id }, `id ${IN}`, ids);
          message = `${plural(ids.length, "session")} linked to “${goal.title}”`;
        }
        break;
      }
      case "unassign":
        update("sessions", { agent_id: null, team_id: null }, `id ${IN}`, ids);
        message = `${plural(ids.length, "session")} unassigned`;
        break;
      case "archive": {
        const openTasks = all<TaskRow>(`select * from tasks where session_id ${IN} and status <> 'done'`, ids);
        undo.tasks = openTasks;
        tx(() => {
          update("sessions", { archived: true, agent_id: null, team_id: null, goal_id: null }, `id ${IN}`, ids);
          update("tasks", { status: "done", resolved_at: new Date().toISOString() }, `id ${IN}`, openTasks.map((t) => t.id));
        });
        message = `${plural(ids.length, "session")} archived`;
        break;
      }
      case "unarchive":
        update("sessions", { archived: false, classified_at: null }, `id ${IN}`, ids);
        message = `${plural(ids.length, "session")} restored`;
        break;
      case "status": {
        const at = new Date().toISOString();
        const open = all<TaskRow>(`select * from tasks where session_id ${IN} and status <> 'done'`, ids);
        undo.tasks = open;
        if (op.status === "needs_you") {
          // Raise an ask on each session that doesn't have one; undo closes them again.
          const verdict = { needed: true, kind: "respond", confidence: 1, engine: "you", reason: "You flagged it", at };
          const have = new Set(open.map((t) => t.session_id));
          const sessions = all<{ id: string; title: string; status_detail: string | null }>(`select id, title, status_detail from sessions where id ${IN}`, ids);
          tx(() => {
            update("sessions", { status_override: "needs_you", triage: verdict }, `id ${IN}`, ids);
            for (const s of sessions.filter((x) => !have.has(x.id))) {
              const [row] = insert<TaskRow>("tasks", {
                session_id: s.id,
                origin: "classifier",
                kind: "respond",
                title: `Look at: ${s.title}`.slice(0, 140),
                detail: s.status_detail ?? "",
                judge: verdict,
                raised_at: at,
              });
              if (row) undo.tasks!.push({ ...row, status: "done", resolved_at: at });
            }
          });
          message = `${plural(ids.length, "session")} flagged as needing you`;
        } else if (op.status === null) {
          update("sessions", { status_override: null }, `id ${IN}`, ids);
          message = `${plural(ids.length, "session")} back to Claude's status`;
        } else {
          tx(() => {
            update("sessions", { status_override: op.status }, `id ${IN}`, ids);
            if (open.length) update("tasks", { status: "done", resolved_at: at }, `id ${IN}`, open.map((t) => t.id));
          });
          message = `${plural(ids.length, "session")} marked ${op.status === "done" ? "done" : "idle"}`;
        }
        break;
      }
      case "refile":
        update("sessions", { classified_at: null, agent_id: null, team_id: null, project_id: null, goal_id: null }, `id ${IN}`, ids);
        await startOrganize("incremental");
        message = `Re-filing ${plural(ids.length, "session")}…`;
        break;
    }
    return done(message, ids.length, undo);
  } catch (err) {
    return fail(err);
  }
}

// ---------- to-dos ----------

export type TodoOp =
  | { type: "done" }
  | { type: "open" }
  | { type: "delete" }
  | { type: "assign"; agentId: string | null }
  | { type: "due"; date: string | null }
  | { type: "priority"; priority: Priority }
  | { type: "goal"; goalId: string | null };

export async function bulkTodos(rawIds: string[], op: TodoOp): Promise<BulkResult> {
  const ids = cleanIds(rawIds);
  if (!ids.length) return { ok: false, count: 0, message: "Nothing selected." };
  try {
    const before = all<TaskRow>(`select * from tasks where id ${IN} and origin = 'manual'`, ids);
    const mine = before.map((t) => t.id);
    const n = mine.length;
    const undo: UndoSnapshot = { tasks: before };
    switch (op.type) {
      case "done":
        update("tasks", { status: "done", resolved_at: new Date().toISOString() }, `id ${IN}`, mine);
        return done(`${plural(n, "to-do")} done ✓`, n, undo);
      case "open":
        update("tasks", { status: "open", resolved_at: null }, `id ${IN}`, mine);
        return done(`${plural(n, "to-do")} reopened`, n, undo);
      case "delete":
        run(`delete from tasks where id ${IN}`, mine);
        return done(`${plural(n, "to-do")} deleted`, n, undo);
      case "assign": {
        if (op.agentId !== null && !isUuid(op.agentId)) return { ok: false, count: 0, message: "Pick a teammate." };
        update("tasks", { agent_id: op.agentId }, `id ${IN}`, mine);
        return done(`${plural(n, "to-do")} reassigned`, n, undo);
      }
      case "due": {
        const date = op.date && /^\d{4}-\d{2}-\d{2}$/.test(op.date) ? op.date : null;
        update("tasks", { due_date: date }, `id ${IN}`, mine);
        return done(date ? `${plural(n, "to-do")} due ${date}` : `Cleared due dates on ${plural(n, "to-do")}`, n, undo);
      }
      case "priority": {
        if (!PRIORITIES.includes(op.priority)) return { ok: false, count: 0, message: "Unknown priority." };
        update("tasks", { priority: op.priority }, `id ${IN}`, mine);
        return done(`${plural(n, "to-do")} set to ${op.priority} priority`, n, undo);
      }
      case "goal": {
        if (op.goalId !== null && !isUuid(op.goalId)) return { ok: false, count: 0, message: "Pick a goal." };
        const values: Record<string, unknown> = { goal_id: op.goalId };
        if (op.goalId) {
          const goal = need(get<{ project_id: string }>("select project_id from goals where id = ?", op.goalId), "load goal");
          values.project_id = goal.project_id;
        }
        update("tasks", values, `id ${IN}`, mine);
        return done(op.goalId ? `${plural(n, "to-do")} linked to the goal` : `${plural(n, "to-do")} unlinked from goals`, n, undo);
      }
    }
  } catch (err) {
    return fail(err);
  }
}

export interface QuickTodo {
  title: string;
  agentId?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  dueDate?: string | null;
  priority?: Priority;
}

/** Create many to-dos at once (from the quick-add box). Project is inferred from goal or assignee when missing. */
export async function bulkAddTodos(items: QuickTodo[]): Promise<BulkResult> {
  if (!Array.isArray(items) || !items.length) return { ok: false, count: 0, message: "Nothing to add." };
  try {
    const agentProject = new Map(
      all<{ id: string; project_id: string | null }>("select a.id, t.project_id from agents a left join teams t on t.id = a.team_id").map((a) => [a.id, a.project_id]),
    );
    const goalProject = new Map(all<{ id: string; project_id: string }>("select id, project_id from goals").map((g) => [g.id, g.project_id]));
    const rows = items.slice(0, 500).flatMap((it) => {
      const title = String(it.title ?? "").trim().slice(0, 300);
      if (!title) return [];
      const agentId = isUuid(it.agentId) && agentProject.has(it.agentId) ? it.agentId : null;
      const goalId = isUuid(it.goalId) && goalProject.has(it.goalId) ? it.goalId : null;
      const projectId = (isUuid(it.projectId) ? it.projectId : null) ?? (goalId ? goalProject.get(goalId)! : null) ?? (agentId ? agentProject.get(agentId) ?? null : null);
      return [
        {
          title,
          detail: "",
          kind: "todo",
          origin: "manual",
          agent_id: agentId,
          project_id: projectId,
          goal_id: goalId,
          due_date: it.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(it.dueDate) ? it.dueDate : null,
          priority: it.priority && PRIORITIES.includes(it.priority) ? it.priority : "normal",
        },
      ];
    });
    if (!rows.length) return { ok: false, count: 0, message: "Nothing to add." };
    const saved = insert<{ id: string }>("tasks", rows);
    const ids = saved.map((r) => r.id);
    return done(`Added ${plural(rows.length, "to-do")}`, rows.length, { created: [{ table: "tasks", ids }] }, ids);
  } catch (err) {
    return fail(err);
  }
}

// ---------- goals & milestones ----------

export type GoalOp = { type: "status"; status: "active" | "achieved" | "dropped" } | { type: "delete" };

export async function bulkGoals(rawIds: string[], op: GoalOp): Promise<BulkResult> {
  const ids = cleanIds(rawIds);
  if (!ids.length) return { ok: false, count: 0, message: "Nothing selected." };
  try {
    if (op.type === "delete") {
      run(`delete from goals where id ${IN}`, ids);
      return done(`${plural(ids.length, "goal")} deleted`, ids.length);
    }
    if (!["active", "achieved", "dropped"].includes(op.status)) return { ok: false, count: 0, message: "Unknown status." };
    const now = new Date().toISOString();
    const goals = all<{ id: string; status: "active" | "achieved" | "dropped"; achieved_at: string | null }>(`select id, status, achieved_at from goals where id ${IN}`, ids);
    update("goals", { status: op.status, achieved_at: op.status === "achieved" ? now : null, updated_at: now }, `id ${IN}`, ids);
    return done(`${plural(ids.length, "goal")} ${op.status === "active" ? "reopened" : op.status}`, ids.length, { goals });
  } catch (err) {
    return fail(err);
  }
}

/** One goal per line. */
export async function bulkAddGoals(projectId: string, text: string, teamId?: string | null): Promise<BulkResult> {
  if (!isUuid(projectId)) return { ok: false, count: 0, message: "Pick a project." };
  const titles = parseLines(text, 100);
  if (!titles.length) return { ok: false, count: 0, message: "Write one goal per line." };
  try {
    const saved = insert<{ id: string }>("goals", titles.map((title) => ({ project_id: projectId, title, team_id: isUuid(teamId) ? teamId : null })));
    const ids = saved.map((r) => r.id);
    return done(`Added ${plural(titles.length, "goal")}`, titles.length, { created: [{ table: "goals", ids }] }, ids);
  } catch (err) {
    return fail(err);
  }
}

/** One milestone per line, appended after the existing ones. */
export async function bulkAddMilestones(goalId: string, text: string): Promise<BulkResult> {
  if (!isUuid(goalId)) return { ok: false, count: 0, message: "Unknown goal." };
  const titles = parseLines(text, 100);
  if (!titles.length) return { ok: false, count: 0, message: "Write one milestone per line." };
  try {
    const count = scalar("select count(*) from goal_milestones where goal_id = ?", goalId);
    const saved = insert<{ id: string }>("goal_milestones", titles.map((title, i) => ({ goal_id: goalId, title, position: count + i })));
    const ids = saved.map((r) => r.id);
    return done(`Added ${plural(titles.length, "milestone")}`, titles.length, { created: [{ table: "goal_milestones", ids }] }, ids);
  } catch (err) {
    return fail(err);
  }
}

// ---------- people ----------

export type AgentOp = { type: "team"; teamId: string } | { type: "delete" };

export async function bulkAgents(rawIds: string[], op: AgentOp): Promise<BulkResult> {
  const ids = cleanIds(rawIds);
  if (!ids.length) return { ok: false, count: 0, message: "Nothing selected." };
  try {
    if (op.type === "delete") {
      tx(() => {
        update("sessions", { agent_id: null, team_id: null }, `agent_id ${IN}`, ids);
        run(`delete from agents where id ${IN}`, ids);
      });
      return done(`${plural(ids.length, "teammate")} removed; their sessions are unfiled`, ids.length);
    }
    if (!isUuid(op.teamId)) return { ok: false, count: 0, message: "Pick a team." };
    const team = need(get<{ id: string; name: string; project_id: string }>("select id, name, project_id from teams where id = ?", op.teamId), "load team");
    const agents = all<{ id: string; team_id: string }>(`select id, team_id from agents where id ${IN}`, ids);
    const sessions = all<SessionPrev>(`select ${SESSION_PREV} from sessions where agent_id ${IN}`, ids);
    tx(() => {
      update("agents", { team_id: team.id }, `id ${IN}`, ids);
      // Sessions follow their owner.
      update("sessions", { team_id: team.id, project_id: team.project_id }, `agent_id ${IN}`, ids);
    });
    return done(`${plural(ids.length, "teammate")} moved to ${team.name}`, ids.length, { agents, sessions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(msg.includes("UNIQUE constraint failed") ? new Error("Someone with that name is already on that team.") : err);
  }
}

/** "Name — Role" per line. Names already on the team are skipped. */
export async function bulkHire(teamId: string, text: string): Promise<BulkResult> {
  const people = text
    .split(/\r?\n/)
    .map(parsePersonLine)
    .filter((p): p is { name: string; role: string } => !!p);
  if (!people.length) return { ok: false, count: 0, message: "Write one person per line, like “Noor — Marketing Manager”." };
  return hirePeople(teamId, people);
}

/** Hire up to 50 people onto a team. Names already on the team are skipped. */
export async function hirePeople(teamId: string, list: { name: string; role: string }[]): Promise<BulkResult> {
  if (!isUuid(teamId)) return { ok: false, count: 0, message: "Pick a team." };
  const people = list.map((p) => ({ name: p.name.trim(), role: p.role.trim() || "Teammate" })).filter((p) => p.name).slice(0, 50);
  if (!people.length) return { ok: false, count: 0, message: "Nobody to hire." };
  try {
    const rows = people.map((p) => ({
      team_id: teamId,
      name: p.name.slice(0, 60),
      role: p.role.slice(0, 80),
      persona: "",
      avatar: { seed: `${p.name}:${p.role}`, prop: propForRole(p.role) },
    }));
    const saved = insert<{ id: string }>("agents", rows, { on: "team_id, name", do: "nothing" });
    const skipped = rows.length - saved.length;
    const ids = saved.map((r) => r.id);
    return done(`Hired ${plural(saved.length, "teammate")}${skipped ? ` (${skipped} already on the team)` : ""}`, saved.length, { created: [{ table: "agents", ids }] }, ids);
  } catch (err) {
    return fail(err);
  }
}

// ---------- projects ----------

export type ProjectOp = { type: "company"; companyId: string | null } | { type: "delete" };

export async function bulkProjects(rawIds: string[], op: ProjectOp): Promise<BulkResult> {
  const ids = cleanIds(rawIds);
  if (!ids.length) return { ok: false, count: 0, message: "Nothing selected." };
  try {
    if (op.type === "delete") {
      // Sessions stay imported, just unfiled; teams, people and goals go with their project.
      tx(() => {
        update("sessions", { project_id: null, team_id: null, agent_id: null, goal_id: null }, `project_id ${IN}`, ids);
        run(`delete from projects where id ${IN}`, ids);
      });
      return done(`${plural(ids.length, "project")} deleted`, ids.length);
    }
    if (op.companyId !== null && !isUuid(op.companyId)) return { ok: false, count: 0, message: "Pick a company." };
    const projects = all<{ id: string; company_id: string | null }>(`select id, company_id from projects where id ${IN}`, ids);
    update("projects", { company_id: op.companyId }, `id ${IN}`, ids);
    return done(op.companyId ? `${plural(ids.length, "project")} moved` : `${plural(ids.length, "project")} taken out of their company`, ids.length, { projects });
  } catch (err) {
    return fail(err);
  }
}

// ---------- undo ----------

const TASK_COLUMNS = [
  "id", "owner_id", "session_id", "kind", "title", "detail", "status", "origin", "snoozed_until", "raised_at",
  "resolved_at", "created_at", "agent_id", "project_id", "goal_id", "due_date", "priority", "judge",
] as const;

/** Group rows by the values we restore, so one update per distinct value set. */
function groupBy<T extends { id: string }>(rows: T[], pick: (r: T) => Record<string, unknown>): { values: Record<string, unknown>; ids: string[] }[] {
  const groups = new Map<string, { values: Record<string, unknown>; ids: string[] }>();
  for (const r of rows) {
    if (!isUuid(r.id)) continue;
    const values = pick(r);
    const key = JSON.stringify(values);
    const g = groups.get(key) ?? { values, ids: [] };
    g.ids.push(r.id);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export async function applyUndo(snapshot: UndoSnapshot): Promise<BulkResult> {
  try {
    return tx(() => done("Undone", restore(snapshot)));
  } catch (err) {
    return fail(err);
  }
}

/** Put a snapshot back; returns how many rows it touched. Runs inside applyUndo's transaction. */
function restore(snapshot: UndoSnapshot): number {
  let n = 0;
  if (snapshot.tasks?.length) {
    const rows = snapshot.tasks
      .filter((t) => isUuid(t.id))
      .map((t) => Object.fromEntries(TASK_COLUMNS.map((c) => [c, (t as unknown as Record<string, unknown>)[c] ?? null])));
    insert("tasks", rows, { on: "id", do: "update" });
    n += rows.length;
  }
  if (snapshot.sessions?.length) {
    for (const g of groupBy(snapshot.sessions, (s) => ({
      agent_id: s.agent_id,
      team_id: s.team_id,
      project_id: s.project_id,
      goal_id: s.goal_id,
      archived: !!s.archived,
      classified_at: s.classified_at,
      triage: s.triage ?? null,
      status_override: s.status_override ?? null,
    })))
      update("sessions", g.values, `id ${IN}`, g.ids);
    n += snapshot.sessions.length;
  }
  if (snapshot.agents?.length) {
    for (const g of groupBy(snapshot.agents, (a) => ({ team_id: a.team_id }))) update("agents", g.values, `id ${IN}`, g.ids);
    n += snapshot.agents.length;
  }
  if (snapshot.projects?.length) {
    for (const g of groupBy(snapshot.projects, (p) => ({ company_id: p.company_id }))) update("projects", g.values, `id ${IN}`, g.ids);
    n += snapshot.projects.length;
  }
  if (snapshot.goals?.length) {
    for (const g of groupBy(snapshot.goals, (x) => ({ status: x.status, achieved_at: x.achieved_at }))) update("goals", g.values, `id ${IN}`, g.ids);
    n += snapshot.goals.length;
  }
  if (snapshot.comments?.length) {
    const rows = snapshot.comments
      .filter((c) => isUuid(c.id) && isUuid(c.entity_id))
      .map(({ id, entity_type, entity_id, body, created_at, updated_at }) => ({ id, entity_type, entity_id, body, created_at, updated_at }));
    if (rows.length) insert("comments", rows, { on: "id", do: "update" });
    n += rows.length;
  }
  for (const c of snapshot.created ?? []) {
    if (!CREATED_TABLES.includes(c.table)) continue;
    const ids = cleanIds(c.ids);
    if (c.table === "agents") update("sessions", { agent_id: null, team_id: null }, `agent_id ${IN}`, ids);
    if (c.table === "tasks") {
      // Only hand-written to-dos can be removed this way, never session asks.
      run(`delete from tasks where id ${IN} and origin = 'manual'`, ids);
    } else run(`delete from ${c.table} where id ${IN}`, ids);
    n += ids.length;
  }
  return n;
}
