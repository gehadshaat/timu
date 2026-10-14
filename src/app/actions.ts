"use server";

import { revalidatePath } from "next/cache";
import {
  importClaudeAiExport,
  importCloudFromApi,
  importCloudFromJson,
  importLocal,
} from "@/lib/importers";
import { applyDraft, startOrganize, type OrganizeJob } from "@/lib/organize";
import { ProposalSchema } from "@/lib/classify/schema";
import * as ops from "@/lib/ops";
import { syncNow } from "@/lib/auto-sync";
import { describeArtifacts, importArtifacts, moveArtifact } from "@/lib/artifacts";
import { describeRoutines, importRoutinesFromApi, importRoutinesFromJson } from "@/lib/routines";
import type { ActionResult, EntityKind, EntityValues, GoalInput, SessionFate, TodoInput } from "@/lib/ops";
import type { IngestResult } from "@/lib/ingest";

// The logic lives in src/lib/ops.ts (shared with the MCP server); these wrappers refresh the UI.
export type { ActionResult, EntityKind, EntityValues, GoalInput, SessionFate, TodoInput } from "@/lib/ops";

/** Run an op, then refresh every page (or just `path`). */
async function refreshing<T>(op: Promise<T>, path?: string): Promise<T> {
  const result = await op;
  if (path) revalidatePath(path);
  else revalidatePath("/", "layout");
  return result;
}

async function attempt(label: string, fn: () => Promise<IngestResult>): Promise<ActionResult> {
  try {
    const r = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message: ops.describe(r, label) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function importLocalAction(): Promise<ActionResult> {
  return attempt("Local transcripts", importLocal);
}

export async function importCloudAction(): Promise<ActionResult> {
  return attempt("Cloud sessions", importCloudFromApi);
}

export async function importCloudJsonAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const file = form.get("file");
  const text = file instanceof File && file.size > 0 ? await file.text() : String(form.get("json") ?? "");
  if (!text.trim()) return { ok: false, message: "Paste the JSON or choose a file first." };
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, message: "That isn't valid JSON." };
  }
  return attempt("Cloud sessions", () => importCloudFromJson(payload));
}

/** Artifacts pasted as Claude prints them (or JSON). */
export async function importArtifactsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const text = String(form.get("text") ?? "");
  if (!text.trim()) return { ok: false, message: "Paste your artifacts list first." };
  try {
    const r = importArtifacts(text);
    revalidatePath("/", "layout");
    return { ok: true, message: describeArtifacts(r) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** File an artifact under a project yourself (null takes it out). */
export async function moveArtifactAction(id: string, projectId: string | null): Promise<ActionResult> {
  try {
    moveArtifact(id, projectId);
    revalidatePath("/", "layout");
    return { ok: true, message: projectId ? "Artifact filed" : "Artifact taken out of its project" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Routines pasted as JSON (the RemoteTrigger tool's list output, or an API page). */
export async function importRoutinesJsonAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const text = String(form.get("json") ?? "");
  if (!text.trim()) return { ok: false, message: "Paste the routines JSON first." };
  try {
    const r = importRoutinesFromJson(text);
    revalidatePath("/", "layout");
    return { ok: true, message: describeRoutines(r) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Pull routines from Claude now (uses the cloud sessions token). */
export async function syncRoutinesAction(): Promise<ActionResult> {
  try {
    const r = await importRoutinesFromApi();
    revalidatePath("/", "layout");
    return { ok: true, message: describeRoutines(r) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function importClaudeAiExportAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose your claude.ai export (.zip or conversations.json)." };
  return attempt("claude.ai chats", () => importClaudeAiExport(file));
}

export async function startOrganizeAction(mode: OrganizeJob["mode"], forceHeuristic = false): Promise<OrganizeJob> {
  return startOrganize(mode, { forceHeuristic });
}

export async function applyProposalAction(id: string, bodyJson: string): Promise<ActionResult> {
  const parsed = ProposalSchema.safeParse(JSON.parse(bodyJson));
  if (!parsed.success) return { ok: false, message: "The edited org isn't valid; reload and try again." };
  try {
    await applyDraft(id, parsed.data);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Your team is set up." };
}

/** Pull from every source that's configured, then file new sessions into the org. */
export async function syncAllAction(): Promise<ActionResult> {
  return refreshing(syncNow());
}

/** Wipe the org (keeps imported sessions) so setup can run again. */
export async function resetOrgAction(): Promise<void> {
  return refreshing(ops.resetOrg());
}

// ---------- goals ----------

export async function createGoalAction(input: GoalInput): Promise<ActionResult> {
  return refreshing(ops.createGoal(input));
}

export async function updateGoalAction(goalId: string, input: Omit<GoalInput, "projectId">): Promise<ActionResult> {
  return refreshing(ops.updateGoal(goalId, input));
}

export async function setGoalStatusAction(goalId: string, status: "active" | "achieved" | "dropped"): Promise<void> {
  return refreshing(ops.setGoalStatus(goalId, status));
}

export async function deleteGoalAction(goalId: string): Promise<void> {
  return refreshing(ops.deleteGoal(goalId));
}

export async function addMilestoneAction(goalId: string, title: string): Promise<void> {
  await refreshing(ops.addMilestone(goalId, title));
}

export async function toggleMilestoneAction(milestoneId: string, done: boolean): Promise<void> {
  return refreshing(ops.toggleMilestone(milestoneId, done));
}

export async function deleteMilestoneAction(milestoneId: string): Promise<void> {
  return refreshing(ops.deleteMilestone(milestoneId));
}

/** Attach a session to a goal (or detach with null). Also moves it into the goal's project. */
export async function linkSessionToGoalAction(sessionId: string, goalId: string | null): Promise<void> {
  return refreshing(ops.linkSessionToGoal(sessionId, goalId));
}

// ---------- to-dos ----------

export async function createTodoAction(input: TodoInput): Promise<ActionResult> {
  return refreshing(ops.createTodo(input));
}

export async function updateTodoAction(taskId: string, input: TodoInput): Promise<ActionResult> {
  return refreshing(ops.updateTodo(taskId, input));
}

export async function toggleTodoAction(taskId: string, done: boolean): Promise<void> {
  return refreshing(ops.toggleTodo(taskId, done));
}

export async function deleteTodoAction(taskId: string): Promise<void> {
  return refreshing(ops.deleteTodo(taskId));
}

// ---------- office ----------

export async function setProjectThemeAction(projectId: string, theme: string): Promise<void> {
  return refreshing(ops.setProjectTheme(projectId, theme));
}

// ---------- digest ----------

export async function markDigestSeenAction(): Promise<void> {
  return refreshing(ops.markDigestSeen(), "/digest");
}

// ---------- deleting teams and projects ----------

export async function deleteTeamAction(teamId: string, fate: SessionFate): Promise<ActionResult> {
  return refreshing(ops.deleteTeam(teamId, fate));
}

export async function deleteProjectAction(projectId: string, fate: SessionFate): Promise<ActionResult> {
  return refreshing(ops.deleteProject(projectId, fate));
}

// ---------- triage ----------

/**
 * "Not needed": close the ask, remember the session doesn't need you (so the organiser
 * won't re-raise it), and optionally save a rule to triage memory.
 */
export async function notNeededAction(taskId: string, remember?: string): Promise<ActionResult> {
  return refreshing(ops.notNeeded(taskId, remember));
}

/** Run every open ask past the triage judge again (e.g. after editing memory) and close the ones that aren't needed. */
export async function recheckOpenAsksAction(): Promise<ActionResult> {
  return refreshing(ops.recheckOpenAsks());
}

export async function addMemoryAction(text: string): Promise<void> {
  await refreshing(ops.addMemory(text), "/settings");
}

export async function updateMemoryAction(id: string, text: string): Promise<void> {
  return refreshing(ops.updateMemory(id, text), "/settings");
}

export async function deleteMemoryAction(id: string): Promise<void> {
  return refreshing(ops.deleteMemory(id), "/settings");
}

export async function resetMemoryAction(): Promise<void> {
  return refreshing(ops.resetMemory(), "/settings");
}

// ---------- create / edit: companies, projects, teams, teammates ----------

/**
 * Create (id = null) or update one entity. Returns the saved id and, for companies and
 * projects, the slug (pages are addressed by slug).
 */
export async function saveEntityAction(
  kind: EntityKind,
  id: string | null,
  values: EntityValues,
): Promise<ActionResult & { id?: string; slug?: string }> {
  return refreshing(ops.saveEntity(kind, id, values));
}

export async function deleteCompanyAction(companyId: string): Promise<ActionResult> {
  return refreshing(ops.deleteCompany(companyId));
}

/** Remove a teammate; their sessions go to another teammate or become unfiled. */
export async function deleteAgentAction(agentId: string, moveToAgentId: string | null): Promise<ActionResult> {
  return refreshing(ops.deleteAgent(agentId, moveToAgentId));
}

// ---------- milestones and settings ----------

export async function renameMilestoneAction(milestoneId: string, title: string): Promise<void> {
  return refreshing(ops.renameMilestone(milestoneId, title));
}

export async function setStaleDaysAction(days: number): Promise<void> {
  await refreshing(ops.setStaleDays(days), "/settings");
}

