"use server";

import { revalidatePath } from "next/cache";
import * as bulk from "@/lib/bulk";
import type { AgentOp, BulkResult, GoalOp, ProjectOp, QuickTodo, SessionOp, TaskOp, TodoOp, UndoSnapshot } from "@/lib/bulk";

export type { AgentOp, BulkResult, GoalOp, ProjectOp, QuickTodo, SessionOp, SessionPrev, TaskOp, TodoOp, UndoSnapshot } from "@/lib/bulk";

/** The UI's side of lib/bulk: run the operation, then refresh every page when it changed something. */
async function refreshing(work: Promise<BulkResult>): Promise<BulkResult> {
  const r = await work;
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function bulkTasksAction(ids: string[], op: TaskOp): Promise<BulkResult> {
  return refreshing(bulk.bulkTasks(ids, op));
}

export async function bulkSessionsAction(ids: string[], op: SessionOp): Promise<BulkResult> {
  return refreshing(bulk.bulkSessions(ids, op));
}

export async function bulkTodosAction(ids: string[], op: TodoOp): Promise<BulkResult> {
  return refreshing(bulk.bulkTodos(ids, op));
}

export async function bulkAddTodosAction(items: QuickTodo[]): Promise<BulkResult> {
  return refreshing(bulk.bulkAddTodos(items));
}

export async function bulkGoalsAction(ids: string[], op: GoalOp): Promise<BulkResult> {
  return refreshing(bulk.bulkGoals(ids, op));
}

export async function bulkAddGoalsAction(projectId: string, text: string, teamId?: string | null): Promise<BulkResult> {
  return refreshing(bulk.bulkAddGoals(projectId, text, teamId));
}

export async function bulkAddMilestonesAction(goalId: string, text: string): Promise<BulkResult> {
  return refreshing(bulk.bulkAddMilestones(goalId, text));
}

export async function bulkAgentsAction(ids: string[], op: AgentOp): Promise<BulkResult> {
  return refreshing(bulk.bulkAgents(ids, op));
}

export async function bulkHireAction(teamId: string, text: string): Promise<BulkResult> {
  return refreshing(bulk.bulkHire(teamId, text));
}

export async function bulkProjectsAction(ids: string[], op: ProjectOp): Promise<BulkResult> {
  return refreshing(bulk.bulkProjects(ids, op));
}

export async function undoAction(snapshot: UndoSnapshot): Promise<BulkResult> {
  return refreshing(bulk.applyUndo(snapshot));
}
