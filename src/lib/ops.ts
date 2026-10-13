import "server-only";
import { all, get, insert, now, run, setSetting, tx, update } from "./db";
import { uniqueSlug } from "./slugs";
import { importCloudFromApi, importLocal } from "./importers";
import { startOrganize } from "./organize";
import { describeRoutines, importRoutinesFromApi } from "./routines";
import { ClaudeAuthError } from "./claude-auth";
import { cloudConfigFromEnv } from "./sources/cloud";
import { THEMES, themeForSlug } from "./themes";
import { getMemory, judgeSessions, saveMemory, STALE_KEY } from "./triage";
import { DEFAULT_MEMORY, type MemoryItem } from "./triage/memory";
import type { Priority } from "./types";
import type { IngestResult } from "./ingest";

/**
 * Everything you can change in Timu. The UI's server actions (src/app/actions.ts) and the
 * MCP server (src/lib/mcp) both call these, so there is one implementation of each rule.
 * Nothing here revalidates Next's cache; the server actions do that.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };
/** Like ActionResult, plus the id of the row that was created or saved. */
export type SaveResult = (ActionResult & { ok: false }) | { ok: true; message: string; id: string; slug?: string };

export function describe(r: IngestResult, label: string): string {
  const parts = [`${r.imported} new`, `${r.updated} updated`];
  if (r.tasksOpened) parts.push(`${r.tasksOpened} need you`);
  return `${label}: ${parts.join(", ")}${r.notes?.length ? ` (${r.notes.join("; ")})` : ""}`;
}

/** A row that must exist, like `.single()`: throws "<what>: not found" otherwise. */
function found<T>(row: T | null, what: string): T {
  if (!row) throw new Error(`${what}: not found`);
  return row;
}

/** A teammate with their team's project. */
const AGENT_WITH_PROJECT = "select a.id, a.team_id, t.project_id from agents a join teams t on t.id = a.team_id where a.id = ?";

/** Pull from every source that's configured, then file new sessions into the org. */
export async function syncAll(): Promise<ActionResult> {
  const messages: string[] = [];
  const errors: string[] = [];
  const run = async (label: string, fn: () => Promise<IngestResult>) => {
    try {
      messages.push(describe(await fn(), label));
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  await run("Local", importLocal);
  if (cloudConfigFromEnv()) {
    try {
      messages.push(describe(await importCloudFromApi(), "Cloud"));
      // Routines use the same login; a failure here never blocks the sessions sync.
      try {
        messages.push(describeRoutines(await importRoutinesFromApi()));
      } catch (err) {
        errors.push(`Routines: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      // A rejected login fails both pulls the same way; say it once.
      errors.push(`${err instanceof ClaudeAuthError ? "Claude" : "Cloud"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await startOrganize("incremental");
  const text = [...messages, ...errors].join(" · ") || "Nothing to sync.";
  return errors.length && !messages.length ? { ok: false, message: text } : { ok: true, message: text };
}

export async function snoozeTask(taskId: string, hours: number): Promise<void> {
  const until = new Date(Date.now() + hours * 3600_000).toISOString();
  update("tasks", { status: "snoozed", snoozed_until: until }, "id = ?", taskId);
}

export async function completeTask(taskId: string): Promise<void> {
  update("tasks", { status: "done", resolved_at: now() }, "id = ?", taskId);
}

/** Give a session to a teammate. It counts as filed, so the organiser won't move it again on the next sync. */
export async function reassignSession(sessionId: string, agentId: string): Promise<void> {
  const agent = found(get<{ id: string; team_id: string; project_id: string }>(AGENT_WITH_PROJECT, agentId), "load member");
  update("sessions", { agent_id: agent.id, team_id: agent.team_id, project_id: agent.project_id, classified_at: now() }, "id = ?", sessionId);
}

/** Wipe the org (keeps imported sessions) so setup can run again. */
export async function resetOrg(): Promise<void> {
  tx(() => {
    run("update sessions set project_id = null, team_id = null, agent_id = null, goal_id = null, classified_at = null");
    run("delete from projects");
    run("delete from proposals");
  });
  await setSetting("setup_complete", false);
  await setSetting("organize_job", { state: "idle", mode: "setup", engine: "heuristic", done: 0, total: 0 });
}

// ---------- goals ----------

export interface GoalInput {
  projectId: string;
  title: string;
  description?: string;
  teamId?: string | null;
  dueDate?: string | null;
  priority?: Priority;
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const PRIORITIES: Priority[] = ["low", "normal", "high"];
const priorityOf = (p: string | undefined): Priority => (PRIORITIES.includes(p as Priority) ? (p as Priority) : "normal");

export async function createGoal(input: GoalInput): Promise<SaveResult> {
  if (!input.title.trim()) return { ok: false, message: "Give the goal a title." };
  const [saved] = insert<{ id: string }>("goals", {
    project_id: input.projectId,
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    team_id: clean(input.teamId),
    due_date: clean(input.dueDate),
    priority: priorityOf(input.priority),
  });
  return { ok: true, message: "Goal added.", id: saved.id };
}

export async function updateGoal(goalId: string, input: Omit<GoalInput, "projectId">): Promise<ActionResult> {
  if (!input.title.trim()) return { ok: false, message: "Give the goal a title." };
  update(
    "goals",
    {
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      team_id: clean(input.teamId),
      due_date: clean(input.dueDate),
      priority: priorityOf(input.priority),
      updated_at: now(),
    },
    "id = ?",
    goalId,
  );
  return { ok: true, message: "Saved." };
}

export async function setGoalStatus(goalId: string, status: "active" | "achieved" | "dropped"): Promise<void> {
  update("goals", { status, achieved_at: status === "achieved" ? now() : null, updated_at: now() }, "id = ?", goalId);
}

export async function deleteGoal(goalId: string): Promise<void> {
  run("delete from goals where id = ?", goalId);
}

/** Returns the new milestone's id, or null when the title is blank. */
export async function addMilestone(goalId: string, title: string): Promise<string | null> {
  if (!title.trim()) return null;
  const [saved] = insert<{ id: string }>("goal_milestones", {
    goal_id: goalId,
    title: title.trim(),
    position: get<{ n: number }>("select count(*) as n from goal_milestones where goal_id = ?", goalId)?.n ?? 0,
  });
  return saved.id;
}

export async function toggleMilestone(milestoneId: string, done: boolean): Promise<void> {
  update("goal_milestones", { done, done_at: done ? now() : null }, "id = ?", milestoneId);
}

export async function deleteMilestone(milestoneId: string): Promise<void> {
  run("delete from goal_milestones where id = ?", milestoneId);
}

export async function renameMilestone(milestoneId: string, title: string): Promise<void> {
  if (!title.trim()) return;
  update("goal_milestones", { title: title.trim() }, "id = ?", milestoneId);
}

/** Attach a session to a goal (or detach with null). Also moves it into the goal's project. */
export async function linkSessionToGoal(sessionId: string, goalId: string | null): Promise<void> {
  const values: Record<string, string | null> = { goal_id: goalId };
  if (goalId) values.project_id = found(get<{ project_id: string }>("select project_id from goals where id = ?", goalId), "load goal").project_id;
  update("sessions", values, "id = ?", sessionId);
}

// ---------- to-dos ----------

export interface TodoInput {
  title: string;
  detail?: string;
  /** null = you */
  agentId?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  dueDate?: string | null;
  priority?: Priority;
}

async function todoFields(input: TodoInput) {
  let projectId = clean(input.projectId);
  const goalId = clean(input.goalId);
  const agentId = clean(input.agentId);
  // Infer the project from the goal or the assignee when it isn't given.
  if (!projectId && goalId) {
    projectId = get<{ project_id: string }>("select project_id from goals where id = ?", goalId)?.project_id ?? null;
  }
  if (!projectId && agentId) projectId = get<{ project_id: string }>(AGENT_WITH_PROJECT, agentId)?.project_id ?? null;
  return {
    title: input.title.trim(),
    detail: input.detail?.trim() ?? "",
    agent_id: agentId,
    project_id: projectId,
    goal_id: goalId,
    due_date: clean(input.dueDate),
    priority: priorityOf(input.priority),
  };
}

export async function createTodo(input: TodoInput): Promise<SaveResult> {
  if (!input.title.trim()) return { ok: false, message: "What needs doing?" };
  const [saved] = insert<{ id: string }>("tasks", { ...(await todoFields(input)), kind: "todo", origin: "manual" });
  return { ok: true, message: "To-do added.", id: saved.id };
}

export async function updateTodo(taskId: string, input: TodoInput): Promise<ActionResult> {
  if (!input.title.trim()) return { ok: false, message: "What needs doing?" };
  update("tasks", await todoFields(input), "id = ? and origin = 'manual'", taskId);
  return { ok: true, message: "Saved." };
}

export async function toggleTodo(taskId: string, done: boolean): Promise<void> {
  update("tasks", { status: done ? "done" : "open", resolved_at: done ? now() : null }, "id = ?", taskId);
}

export async function deleteTodo(taskId: string): Promise<void> {
  run("delete from tasks where id = ? and origin = 'manual'", taskId);
}

// ---------- office ----------

export async function setProjectTheme(projectId: string, theme: string): Promise<void> {
  if (!THEMES.some((t) => t.id === theme)) return;
  update("projects", { theme }, "id = ?", projectId);
}

// ---------- digest ----------

export async function markDigestSeen(): Promise<void> {
  await setSetting("digest_seen_at", now());
}

// ---------- deleting teams and projects ----------

export type SessionFate = { kind: "unfile" } | { kind: "refile" } | { kind: "move"; teamId: string };

/**
 * What happens to a deleted team's or project's sessions:
 * - unfile: they stay imported but belong to no one (reassign them from All sessions)
 * - refile: the next sync asks the organiser to place them again
 * - move: hand them to another team (its first teammate, if it has one)
 */
function releaseSessions(filter: { team_id?: string; project_id?: string }, fate: SessionFate): void {
  const [col, val] = Object.entries(filter)[0] as ["team_id" | "project_id", string];
  if (fate.kind === "move") {
    const team = found(get<{ id: string; project_id: string }>("select id, project_id from teams where id = ?", fate.teamId), "load target team");
    const first = get<{ id: string }>("select id from agents where team_id = ? order by created_at limit 1", team.id);
    update("sessions", { team_id: team.id, project_id: team.project_id, agent_id: first?.id ?? null, goal_id: null }, `${col} = ?`, val);
    return;
  }
  update(
    "sessions",
    {
      team_id: null,
      agent_id: null,
      goal_id: null,
      ...(filter.project_id ? { project_id: null } : {}),
      ...(fate.kind === "refile" ? { classified_at: null } : {}),
    },
    `${col} = ?`,
    val,
  );
}

export async function deleteTeam(teamId: string, fate: SessionFate): Promise<ActionResult> {
  if (fate.kind === "move" && fate.teamId === teamId) return { ok: false, message: "Pick a different team to move sessions to." };
  try {
    tx(() => {
      releaseSessions({ team_id: teamId }, fate);
      // Teammates go with the team; their to-dos fall back to you (agent_id → null by FK).
      run("delete from teams where id = ?", teamId);
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, message: "Team deleted." };
}

export async function deleteProject(projectId: string, fate: SessionFate): Promise<ActionResult> {
  try {
    if (fate.kind === "move") {
      const target = found(get<{ project_id: string }>("select project_id from teams where id = ?", fate.teamId), "load target team");
      if (target.project_id === projectId) return { ok: false, message: "Pick a team in a different project." };
    }
    tx(() => {
      releaseSessions({ project_id: projectId }, fate);
      // Teams, teammates, goals and milestones cascade; to-dos keep living without a project.
      run("delete from projects where id = ?", projectId);
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, message: "Project deleted." };
}

// ---------- triage ----------

/**
 * "Not needed": close the ask, remember the session doesn't need you (so the organiser
 * won't re-raise it), and optionally save a rule to triage memory.
 */
export async function notNeeded(taskId: string, remember?: string): Promise<ActionResult> {
  const task = found(get<{ id: string; session_id: string | null }>("select id, session_id from tasks where id = ?", taskId), "load task");
  const verdict = { needed: false, kind: "none", confidence: 1, engine: "you", reason: "You said it wasn't needed", at: now() };
  tx(() => {
    update("tasks", { status: "done", resolved_at: verdict.at, judge: verdict }, "id = ?", taskId);
    if (task.session_id) update("sessions", { triage: verdict }, "id = ?", task.session_id);
  });
  if (remember?.trim()) {
    const memory = await getMemory();
    await saveMemory([...memory, { id: crypto.randomUUID(), text: remember.trim(), source: "learned", created_at: verdict.at }]);
  }
  return { ok: true, message: remember?.trim() ? "Dismissed and remembered." : "Dismissed." };
}

/** Run every open ask past the triage judge again (e.g. after editing memory) and close the ones that aren't needed. */
export async function recheckOpenAsks(): Promise<ActionResult> {
  const tasks = all<{ id: string; session_id: string }>("select id, session_id from tasks where origin <> 'manual' and status <> 'done'");
  if (!tasks.length) return { ok: true, message: "No open asks to check." };
  const sessions = all<{ id: string; title: string; source: string; status: string; status_detail: string | null; last_message: string | null; last_message_role: string | null; repo: string | null; raw: Record<string, unknown>; last_activity_at: string | null }>(
    `select id, title, source, status, status_detail, last_message, last_message_role, repo, raw, last_activity_at
     from sessions where id in (select value from json_each(?))`,
    tasks.map((t) => t.session_id),
  );
  const verdicts = await judgeSessions(
    sessions.map(({ raw, ...s }) => ({ ...s, needs_action: (raw?.needs_action as string | null) ?? null })),
  );
  let closed = 0;
  tx(() => {
    for (const t of tasks) {
      const v = verdicts.get(t.session_id);
      if (!v) continue;
      update("sessions", { triage: v }, "id = ?", t.session_id);
      if (!v.needed) {
        closed++;
        update("tasks", { status: "done", resolved_at: now(), judge: v }, "id = ?", t.id);
      } else {
        update("tasks", { judge: v }, "id = ?", t.id);
      }
    }
  });
  return { ok: true, message: `Checked ${tasks.length} open ask${tasks.length === 1 ? "" : "s"}; ${closed} didn't actually need you.` };
}

/** Returns the saved rule, or null when the text is blank. */
export async function addMemory(text: string): Promise<MemoryItem | null> {
  if (!text.trim()) return null;
  const item: MemoryItem = { id: crypto.randomUUID(), text: text.trim(), source: "you", created_at: now() };
  await saveMemory([...(await getMemory()), item]);
  return item;
}

/** Blank text deletes the rule. */
export async function updateMemory(id: string, text: string): Promise<void> {
  const memory = await getMemory();
  await saveMemory(text.trim() ? memory.map((m) => (m.id === id ? { ...m, text: text.trim() } : m)) : memory.filter((m) => m.id !== id));
}

export async function deleteMemory(id: string): Promise<void> {
  await saveMemory((await getMemory()).filter((m) => m.id !== id));
}

export async function resetMemory(): Promise<void> {
  await saveMemory(DEFAULT_MEMORY);
}

/** Returns the value actually stored (clamped to 0..3650 days). */
export async function setStaleDays(days: number): Promise<number> {
  const n = Math.max(0, Math.min(3650, Math.round(Number(days) || 0)));
  await setSetting(STALE_KEY, n);
  return n;
}

// ---------- create / edit: companies, projects, teams, teammates ----------

export type EntityKind = "company" | "project" | "team" | "agent";
export type EntityValues = Record<string, string | null | undefined>;

const trimmed = (v: string | null | undefined) => (v ?? "").trim();

/**
 * Create (id = null) or update one entity. Returns the saved id and, for companies and
 * projects, the slug (pages are addressed by slug).
 */
export async function saveEntity(kind: EntityKind, id: string | null, values: EntityValues): Promise<SaveResult> {
  const name = trimmed(values.name);
  if (!name) return { ok: false, message: "Give it a name." };
  try {
    if (kind === "company" || kind === "project") {
      const table = kind === "company" ? "companies" : "projects";
      const row: Record<string, string | null> = {
        name,
        description: trimmed(values.description),
        emoji: trimmed(values.emoji) || (kind === "company" ? "🏢" : "📁"),
      };
      if (kind === "project") row.company_id = trimmed(values.company_id) || null;
      if (id) {
        const current = found(get<{ name: string; slug: string }>(`select name, slug from ${table} where id = ?`, id), `load ${kind}`);
        // Keep URLs stable unless the name actually changed.
        row.slug = current.name === name ? current.slug : await uniqueSlug(table, name, id);
        update(table, row, "id = ?", id);
        return { ok: true, message: "Saved.", id, slug: row.slug };
      }
      row.slug = await uniqueSlug(table, name);
      if (kind === "project") row.theme = themeForSlug(row.slug);
      const [saved] = insert<{ id: string; slug: string }>(table, row);
      return { ok: true, message: "Created.", id: saved.id, slug: saved.slug };
    }

    if (kind === "team") {
      const row = { name, description: trimmed(values.description) };
      if (id) {
        update("teams", row, "id = ?", id);
        return { ok: true, message: "Saved.", id };
      }
      const projectId = trimmed(values.project_id);
      if (!projectId) return { ok: false, message: "Pick a project for the team." };
      const colors = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe", "#fed7aa", "#a5f3fc", "#e9d5ff"];
      const [saved] = insert<{ id: string }>("teams", { ...row, project_id: projectId, color: colors[Math.floor(Math.random() * colors.length)] });
      return { ok: true, message: "Team created.", id: saved.id };
    }

    // teammate
    const role = trimmed(values.role);
    if (!role) return { ok: false, message: "Give them a role." };
    const teamId = trimmed(values.team_id);
    const row: Record<string, unknown> = { name, role, persona: trimmed(values.persona) };
    if (teamId) row.team_id = teamId;
    if (id) {
      const current = found(get<{ avatar: Record<string, unknown>; team_id: string }>("select avatar, team_id from agents where id = ?", id), "load teammate");
      row.avatar = { ...current.avatar, ...(values.prop ? { prop: values.prop } : {}) };
      tx(() => {
        update("agents", row, "id = ?", id);
        // Moving to another team moves their sessions along.
        if (teamId && teamId !== current.team_id) {
          const team = found(get<{ project_id: string }>("select project_id from teams where id = ?", teamId), "load team");
          update("sessions", { team_id: teamId, project_id: team.project_id }, "agent_id = ?", id);
        }
      });
      return { ok: true, message: "Saved.", id };
    }
    if (!teamId) return { ok: false, message: "Pick a team." };
    row.avatar = { seed: `${name}:${role}`, prop: values.prop || "mug" };
    const [saved] = insert<{ id: string }>("agents", row);
    return { ok: true, message: "Hired!", id: saved.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg.includes("UNIQUE constraint failed") ? "That name is already taken here." : msg };
  }
}

export async function deleteCompany(companyId: string): Promise<ActionResult> {
  // Projects stay; they just no longer belong to a company.
  run("delete from companies where id = ?", companyId);
  return { ok: true, message: "Company deleted." };
}

/** Remove a teammate; their sessions go to another teammate or become unfiled. */
export async function deleteAgent(agentId: string, moveToAgentId: string | null): Promise<ActionResult> {
  const to = moveToAgentId
    ? found(get<{ id: string; team_id: string; project_id: string }>(AGENT_WITH_PROJECT, moveToAgentId), "load teammate")
    : null;
  tx(() => {
    if (to) {
      update("sessions", { agent_id: to.id, team_id: to.team_id, project_id: to.project_id }, "agent_id = ?", agentId);
      update("tasks", { agent_id: to.id }, "agent_id = ? and origin = 'manual'", agentId);
    } else {
      update("sessions", { agent_id: null, team_id: null }, "agent_id = ?", agentId);
    }
    run("delete from agents where id = ?", agentId);
  });
  return { ok: true, message: "Teammate removed." };
}

// ---------- sessions: rename, unlink, archive ----------

export async function renameSession(sessionId: string, title: string): Promise<void> {
  if (!title.trim()) return;
  update("sessions", { title: title.trim(), title_locked: true }, "id = ?", sessionId);
}

export async function unlinkSession(sessionId: string, from: "owner" | "goal" | "project"): Promise<void> {
  const values =
    from === "goal"
      ? { goal_id: null }
      : from === "owner"
        ? { agent_id: null, team_id: null }
        : { agent_id: null, team_id: null, project_id: null, goal_id: null };
  update("sessions", values, "id = ?", sessionId);
}

/** Archive hides a session everywhere and stops it being re-filed or raising asks; unarchive brings it back. */
export async function archiveSession(sessionId: string, archived: boolean): Promise<void> {
  tx(() => {
    update("sessions", archived ? { archived, agent_id: null, team_id: null, goal_id: null } : { archived, classified_at: null }, "id = ?", sessionId);
    if (archived) update("tasks", { status: "done", resolved_at: now() }, "session_id = ? and status <> 'done'", sessionId);
  });
}
