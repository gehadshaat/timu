import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as ops from "../../ops";
import { getOrg, type Org } from "../../queries";
import type { GoalRow, MilestoneRow, TaskRow } from "../../types";
import { rowById } from "../lookup";
import { resolveGoal, resolveProject, resolveTeam, resolveTeammate } from "../resolve";
import { date, defineTool, expectOk, GOAL_REF, priority, PROJECT_REF, ref, TEAM_REF, TEAMMATE_REF } from "../tool";

const GOAL_STATUS = z.enum(["active", "achieved", "dropped"]);

/** A goal's team has to be one of its project's teams. */
function teamIn(org: Org, projectId: string, teamRef: string): string {
  const t = resolveTeam(org, teamRef);
  if (t.project_id !== projectId) throw new Error(`Team "${t.name}" isn't in this goal's project.`);
  return t.id;
}

/** "me" (or null) = the user; anything else is a teammate. */
function assigneeId(org: Org, assignee: string | null | undefined): string | null | undefined {
  if (assignee === undefined) return undefined;
  if (assignee === null || assignee.trim().toLowerCase() === "me") return null;
  return resolveTeammate(org, assignee).id;
}

export function registerWorkTools(server: McpServer): void {
  // ---------- goals ----------

  defineTool(
    server,
    "create_goal",
    {
      title: "Create goal",
      kind: "write",
      description:
        "Add a goal to a project, optionally owned by one of its teams, with a due date, priority and starting milestones. Progress counts done milestones, shipped linked sessions and done to-dos.",
      input: z.object({
        project: ref(PROJECT_REF),
        title: ref("What success looks like"),
        description: z.string().optional(),
        team: ref(TEAM_REF).optional(),
        due_date: date.optional(),
        priority: priority.optional(),
        milestones: z.array(z.string().trim().min(1)).optional().describe("Milestone titles, in order"),
      }),
    },
    async (args) => {
      const org = await getOrg();
      const p = resolveProject(org, args.project);
      const r = expectOk(
        await ops.createGoal({
          projectId: p.id,
          title: args.title,
          description: args.description,
          teamId: args.team ? teamIn(org, p.id, args.team) : null,
          dueDate: args.due_date,
          priority: args.priority,
        }),
      );
      const milestones = [];
      for (const title of args.milestones ?? []) milestones.push({ id: await ops.addMilestone(r.id, title), title });
      return { message: r.message, goal: { id: r.id, title: args.title, project: p.name }, milestones };
    },
  );

  defineTool(
    server,
    "update_goal",
    {
      title: "Update goal",
      kind: "write",
      description:
        "Edit a goal or change its status (active, achieved, dropped). team, due_date: null clears them. Fields you leave out stay as they are.",
      input: z.object({
        goal: ref(GOAL_REF),
        title: z.string().trim().min(1).optional(),
        description: z.string().optional(),
        team: z.string().trim().min(1).nullable().optional().describe(`${TEAM_REF}; null = the whole project`),
        due_date: date.nullable().optional(),
        priority: priority.optional(),
        status: GOAL_STATUS.optional(),
      }),
    },
    async (args) => {
      const org = await getOrg();
      const g: GoalRow = resolveGoal(org, args.goal);
      const teamId = args.team === undefined ? g.team_id : args.team === null ? null : teamIn(org, g.project_id, args.team);
      expectOk(
        await ops.updateGoal(g.id, {
          title: args.title ?? g.title,
          description: args.description ?? g.description,
          teamId,
          dueDate: args.due_date === undefined ? g.due_date : args.due_date,
          priority: args.priority ?? g.priority,
        }),
      );
      if (args.status && args.status !== g.status) await ops.setGoalStatus(g.id, args.status);
      return { message: "Saved.", goal: { id: g.id, title: args.title ?? g.title, status: args.status ?? g.status } };
    },
  );

  defineTool(
    server,
    "delete_goal",
    {
      title: "Delete goal",
      kind: "destructive",
      description: "Delete a goal and its milestones. Linked sessions and to-dos stay; they just lose the goal.",
      input: z.object({ goal: ref(GOAL_REF) }),
    },
    async ({ goal }) => {
      const g = resolveGoal(await getOrg(), goal);
      await ops.deleteGoal(g.id);
      return { message: "Goal deleted.", deleted: { id: g.id, title: g.title } };
    },
  );

  // ---------- milestones ----------

  defineTool(
    server,
    "add_milestone",
    {
      title: "Add milestone",
      kind: "write",
      description: "Add a milestone to the end of a goal's list.",
      input: z.object({ goal: ref(GOAL_REF), title: ref("Milestone title") }),
    },
    async ({ goal, title }) => {
      const g = resolveGoal(await getOrg(), goal);
      return { message: "Milestone added.", milestone: { id: await ops.addMilestone(g.id, title), title, goal: g.title } };
    },
  );

  defineTool(
    server,
    "update_milestone",
    {
      title: "Update milestone",
      kind: "write",
      description: "Rename a milestone and/or tick it off (done: true) or reopen it (done: false). Milestone ids come from get_project.",
      input: z.object({
        milestone_id: ref("Milestone id"),
        title: z.string().trim().min(1).optional(),
        done: z.boolean().optional(),
      }),
    },
    async ({ milestone_id, title, done }) => {
      const m = await rowById<MilestoneRow>("goal_milestones", milestone_id, "milestone");
      if (title) await ops.renameMilestone(m.id, title);
      if (done !== undefined && done !== m.done) await ops.toggleMilestone(m.id, done);
      return { message: "Saved.", milestone: { id: m.id, title: title ?? m.title, done: done ?? m.done } };
    },
  );

  defineTool(
    server,
    "delete_milestone",
    {
      title: "Delete milestone",
      kind: "destructive",
      description: "Delete a milestone from its goal.",
      input: z.object({ milestone_id: ref("Milestone id") }),
    },
    async ({ milestone_id }) => {
      const m = await rowById<MilestoneRow>("goal_milestones", milestone_id, "milestone");
      await ops.deleteMilestone(m.id);
      return { message: "Milestone deleted.", deleted: { id: m.id, title: m.title } };
    },
  );

  // ---------- to-dos ----------

  defineTool(
    server,
    "create_todo",
    {
      title: "Create to-do",
      kind: "write",
      description:
        "Write a to-do for the user (assignee 'me', the default) or assign it to a teammate, whose speech bubble then shows it. The project is inferred from the goal or teammate when not given.",
      input: z.object({
        title: ref("What needs doing"),
        detail: z.string().optional(),
        assignee: z.string().trim().min(1).optional().describe(`'me' (default) or a teammate. ${TEAMMATE_REF}`),
        project: ref(PROJECT_REF).optional(),
        goal: ref(GOAL_REF).optional(),
        due_date: date.optional(),
        priority: priority.optional(),
      }),
    },
    async (args) => {
      const org = await getOrg();
      const r = expectOk(
        await ops.createTodo({
          title: args.title,
          detail: args.detail,
          agentId: assigneeId(org, args.assignee) ?? null,
          projectId: args.project ? resolveProject(org, args.project).id : null,
          goalId: args.goal ? resolveGoal(org, args.goal).id : null,
          dueDate: args.due_date,
          priority: args.priority,
        }),
      );
      return { message: r.message, todo: { id: r.id, title: args.title } };
    },
  );

  defineTool(
    server,
    "update_todo",
    {
      title: "Update to-do",
      kind: "write",
      description:
        "Edit a to-do, reassign it, or tick it off (done: true) / reopen it (done: false). assignee: 'me' or null gives it back to the user; project, goal, due_date: null clears them. Fields you leave out stay as they are.",
      input: z.object({
        todo_id: ref("To-do id (from list_todos)"),
        title: z.string().trim().min(1).optional(),
        detail: z.string().optional(),
        assignee: z.string().trim().min(1).nullable().optional().describe(`'me'/null or a teammate. ${TEAMMATE_REF}`),
        project: z.string().trim().min(1).nullable().optional().describe(PROJECT_REF),
        goal: z.string().trim().min(1).nullable().optional().describe(GOAL_REF),
        due_date: date.nullable().optional(),
        priority: priority.optional(),
        done: z.boolean().optional(),
      }),
    },
    async (args) => {
      const t = await rowById<TaskRow>("tasks", args.todo_id, "to-do");
      if (t.origin !== "manual") throw new Error("That's an inbox ask, not a to-do. Use handle_ask for asks.");
      const org = await getOrg();
      const keep = <T>(v: T | undefined, current: T) => (v === undefined ? current : v);
      expectOk(
        await ops.updateTodo(t.id, {
          title: args.title ?? t.title,
          detail: args.detail ?? t.detail,
          agentId: keep(assigneeId(org, args.assignee), t.agent_id),
          projectId: keep(args.project === null ? null : args.project && resolveProject(org, args.project).id, t.project_id),
          goalId: keep(args.goal === null ? null : args.goal && resolveGoal(org, args.goal).id, t.goal_id),
          dueDate: keep(args.due_date, t.due_date),
          priority: args.priority ?? t.priority,
        }),
      );
      if (args.done !== undefined && args.done !== (t.status === "done")) await ops.toggleTodo(t.id, args.done);
      return { message: "Saved.", todo: { id: t.id, title: args.title ?? t.title, done: args.done ?? t.status === "done" } };
    },
  );

  defineTool(
    server,
    "delete_todo",
    {
      title: "Delete to-do",
      kind: "destructive",
      description: "Delete a hand-written to-do.",
      input: z.object({ todo_id: ref("To-do id (from list_todos)") }),
    },
    async ({ todo_id }) => {
      const t = await rowById<TaskRow>("tasks", todo_id, "to-do");
      if (t.origin !== "manual") throw new Error("That's an inbox ask, not a to-do. Use handle_ask for asks.");
      await ops.deleteTodo(t.id);
      return { message: "To-do deleted.", deleted: { id: t.id, title: t.title } };
    },
  );

  // ---------- inbox asks ----------

  defineTool(
    server,
    "handle_ask",
    {
      title: "Handle inbox ask",
      kind: "write",
      description:
        "Act on an ask from get_inbox. done = the user handled it (it reopens if the session has new activity); snooze = hide it for snooze_hours; not_needed = it never needed the user (optionally save `remember` as a triage rule so similar asks are skipped).",
      input: z.object({
        ask_id: ref("Ask id (from get_inbox)"),
        action: z.enum(["done", "snooze", "not_needed"]),
        snooze_hours: z.number().positive().max(24 * 90).default(24),
        remember: z.string().trim().min(1).optional().describe("With not_needed: a plain-language rule for the triage judge"),
      }),
    },
    async ({ ask_id, action, snooze_hours, remember }) => {
      const t = await rowById<TaskRow>("tasks", ask_id, "ask");
      if (t.origin === "manual") throw new Error("That's a to-do, not an ask. Use update_todo with done: true.");
      if (action === "done") await ops.completeTask(t.id);
      else if (action === "snooze") await ops.snoozeTask(t.id, snooze_hours);
      else return { message: expectOk(await ops.notNeeded(t.id, remember)).message, ask: { id: t.id, title: t.title } };
      return {
        message: action === "done" ? "Marked handled." : `Snoozed for ${snooze_hours}h.`,
        ask: { id: t.id, title: t.title },
      };
    },
  );

  defineTool(
    server,
    "recheck_open_asks",
    {
      title: "Re-check open asks",
      kind: "write",
      description: "Run every open ask past the triage judge again (e.g. after changing triage rules) and close the ones that don't need the user.",
      input: z.object({}),
    },
    async () => expectOk(await ops.recheckOpenAsks()).message,
  );
}
