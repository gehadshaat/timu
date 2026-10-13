import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as bulk from "../../bulk";
import type { BulkResult, QuickTodo, UndoSnapshot } from "../../bulk";
import { getOrg, type Org } from "../../queries";
import { parseQuickAdd } from "../../quickadd";
import { dropUndo, getUndo, listUndo, rememberUndo } from "../../undo-log";
import { findSessions } from "../lookup";
import { resolveCompany, resolveGoal, resolveProject, resolveTeam, resolveTeammate } from "../resolve";
import { COMPANY_REF, date, defineTool, GOAL_REF, priority, PROJECT_REF, ref, SESSION_REF, TEAM_REF, TEAMMATE_REF } from "../tool";

/**
 * Bulk tools: the same operations as the UI's bulk bars and quick-add boxes. Each change
 * that can be undone returns an `undo_id`; pass it to `undo` to put things back.
 */

const many = (what: string, max = 500) => z.array(ref(what)).min(1).max(max);
const GOAL_STATUS = z.enum(["active", "achieved", "dropped"]);

/** Turn a bulk result into a tool result, remembering its undo snapshot. Failures throw. */
async function report(label: string, r: BulkResult, extra: Record<string, unknown> = {}) {
  if (!r.ok) throw new Error(r.message);
  const undo_id = await rememberUndo(label, r.undo);
  return { message: r.message, count: r.count, ...extra, ...(undo_id ? { undo_id } : {}) };
}

/** "me" (or null) = the user; anything else is a teammate. */
function assigneeId(org: Org, assignee: string | null | undefined): string | null | undefined {
  if (assignee === undefined) return undefined;
  if (assignee === null || assignee.trim().toLowerCase() === "me") return null;
  return resolveTeammate(org, assignee).id;
}

export function registerBulkTools(server: McpServer): void {
  // ---------- inbox asks ----------

  defineTool(
    server,
    "handle_asks",
    {
      title: "Handle many asks",
      kind: "write",
      description:
        "Act on many inbox asks at once (ids from get_inbox): done = handled; snooze = hide for snooze_hours; not_needed = they never needed the user (the sessions stop raising asks until new activity); reopen = put closed asks back in the inbox. Returns an undo_id.",
      input: z.object({
        asks: many("Ask id (from get_inbox)", 1000),
        action: z.enum(["done", "snooze", "not_needed", "reopen"]),
        snooze_hours: z.number().positive().max(24 * 90).default(24),
      }),
    },
    async ({ asks, action, snooze_hours }) => {
      const op =
        action === "done"
          ? ({ type: "handled" } as const)
          : action === "snooze"
            ? ({ type: "snooze", hours: snooze_hours } as const)
            : action === "not_needed"
              ? ({ type: "not_needed" } as const)
              : ({ type: "reopen" } as const);
      return report(`${action} ${asks.length} ask(s)`, await bulk.bulkTasks(asks, op));
    },
  );

  // ---------- sessions ----------

  defineTool(
    server,
    "move_sessions",
    {
      title: "Move sessions",
      kind: "write",
      description:
        "File many sessions at once. Give exactly one of: team (they go to its first teammate), project (they become unfiled inside that project; null takes them out of any project), or goal (links them and moves them into the goal's project; null unlinks). To give sessions to a specific teammate use assign_sessions. Returns an undo_id.",
      input: z.object({
        sessions: many(SESSION_REF),
        team: ref(TEAM_REF).optional(),
        project: z.string().trim().min(1).nullable().optional().describe(`${PROJECT_REF}; null = no project`),
        goal: z.string().trim().min(1).nullable().optional().describe(`${GOAL_REF}; null = unlink`),
      }),
    },
    async ({ sessions, team, project, goal }) => {
      const given = [team, project, goal].filter((v) => v !== undefined).length;
      if (given !== 1) throw new Error("Give exactly one of team, project or goal.");
      const org = await getOrg();
      const ids = (await findSessions(sessions)).map((s) => s.id);
      if (team) {
        const t = resolveTeam(org, team);
        return report(`moved ${ids.length} session(s) to ${t.name}`, await bulk.bulkSessions(ids, { type: "team", teamId: t.id }));
      }
      if (project !== undefined) {
        const p = project === null ? null : resolveProject(org, project);
        return report(`moved ${ids.length} session(s) to ${p?.name ?? "no project"}`, await bulk.bulkSessions(ids, { type: "project", projectId: p?.id ?? null }));
      }
      const g = goal === null || goal === undefined ? null : resolveGoal(org, goal);
      return report(`linked ${ids.length} session(s) to ${g?.title ?? "no goal"}`, await bulk.bulkSessions(ids, { type: "goal", goalId: g?.id ?? null }));
    },
  );

  defineTool(
    server,
    "archive_sessions",
    {
      title: "Archive sessions",
      kind: "write",
      description:
        "Archive many sessions (archived: true, the default): they're hidden everywhere, their open asks close, and the organiser stops filing them. archived: false brings them back. Returns an undo_id.",
      input: z.object({ sessions: many(SESSION_REF, 1000), archived: z.boolean().default(true) }),
    },
    async ({ sessions, archived }) => {
      const ids = (await findSessions(sessions)).map((s) => s.id);
      return report(`${archived ? "archived" : "unarchived"} ${ids.length} session(s)`, await bulk.bulkSessions(ids, { type: archived ? "archive" : "unarchive" }));
    },
  );

  defineTool(
    server,
    "refile_sessions",
    {
      title: "Re-file sessions",
      kind: "write",
      description:
        "Clear how these sessions are filed (teammate, team, project, goal) and start the organiser to place them again from scratch. Returns an undo_id that restores the old filing.",
      input: z.object({ sessions: many(SESSION_REF) }),
    },
    async ({ sessions }) => {
      const ids = (await findSessions(sessions)).map((s) => s.id);
      return report(`re-filed ${ids.length} session(s)`, await bulk.bulkSessions(ids, { type: "refile" }));
    },
  );

  // ---------- to-dos ----------

  defineTool(
    server,
    "add_todos",
    {
      title: "Add to-dos",
      kind: "write",
      description:
        "Add many to-dos at once. `lines` takes quick-add text, one to-do per line, where @Name assigns (@me = the user), #project files it, ! or !high / !low sets priority and due:fri / due:tomorrow / due:+3d / due:2026-11-01 sets the date; bullets and checkboxes are ignored. `todos` takes structured items instead. project, assignee and goal set defaults for lines that don't say. Returns the new ids and an undo_id.",
      input: z.object({
        lines: z.string().optional().describe("Quick-add text, one to-do per line"),
        todos: z
          .array(
            z.object({
              title: ref("What needs doing"),
              assignee: z.string().trim().min(1).optional().describe(`'me' or a teammate. ${TEAMMATE_REF}`),
              project: ref(PROJECT_REF).optional(),
              goal: ref(GOAL_REF).optional(),
              due_date: date.optional(),
              priority: priority.optional(),
            }),
          )
          .max(500)
          .optional(),
        project: ref(PROJECT_REF).optional().describe(`Default project. ${PROJECT_REF}`),
        assignee: z.string().trim().min(1).optional().describe(`Default assignee: 'me' (default) or a teammate. ${TEAMMATE_REF}`),
        goal: ref(GOAL_REF).optional().describe(`Default goal. ${GOAL_REF}`),
      }),
    },
    async (args) => {
      const org = await getOrg();
      const defaults = {
        projectId: args.project ? resolveProject(org, args.project).id : null,
        agentId: assigneeId(org, args.assignee) ?? null,
        goalId: args.goal ? resolveGoal(org, args.goal).id : null,
      };
      const items: QuickTodo[] = [];
      const unknown: string[] = [];
      if (args.lines?.trim()) {
        const ctx = {
          agents: org.agents.map((a) => ({ id: a.id, name: a.name })),
          projects: org.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
        };
        for (const it of parseQuickAdd(args.lines, ctx)) {
          unknown.push(...it.unknown);
          items.push({
            title: it.title,
            agentId: it.agentId === undefined ? defaults.agentId : it.agentId,
            projectId: it.projectId ?? defaults.projectId,
            goalId: defaults.goalId,
            dueDate: it.dueDate ?? null,
            priority: it.priority,
          });
        }
      }
      for (const t of args.todos ?? []) {
        items.push({
          title: t.title,
          agentId: t.assignee === undefined ? defaults.agentId : assigneeId(org, t.assignee),
          projectId: t.project ? resolveProject(org, t.project).id : defaults.projectId,
          goalId: t.goal ? resolveGoal(org, t.goal).id : defaults.goalId,
          dueDate: t.due_date ?? null,
          priority: t.priority,
        });
      }
      if (!items.length) throw new Error("Nothing to add: give `lines` or `todos`.");
      const r = await bulk.bulkAddTodos(items);
      return report(`added ${items.length} to-do(s)`, r, {
        ids: r.ids,
        ...(unknown.length ? { kept_in_titles: unknown, note: "These @/# tokens matched nobody, so they stayed in the titles." } : {}),
      });
    },
  );

  defineTool(
    server,
    "update_todos",
    {
      title: "Update many to-dos",
      kind: "write",
      description:
        "Change many to-dos at once (ids from list_todos): tick them off (done: true) or reopen them, reassign them (assignee 'me'/null = the user), set or clear the due date, set the priority, or link them to a goal (null unlinks). Fields you leave out stay as they are. Returns an undo_id.",
      input: z.object({
        todos: many("To-do id (from list_todos)"),
        done: z.boolean().optional(),
        assignee: z.string().trim().min(1).nullable().optional().describe(`'me'/null or a teammate. ${TEAMMATE_REF}`),
        due_date: date.nullable().optional(),
        priority: priority.optional(),
        goal: z.string().trim().min(1).nullable().optional().describe(`${GOAL_REF}; null = unlink`),
      }),
    },
    async (args) => {
      const org = await getOrg();
      const ops: bulk.TodoOp[] = [];
      if (args.assignee !== undefined) ops.push({ type: "assign", agentId: assigneeId(org, args.assignee) ?? null });
      if (args.due_date !== undefined) ops.push({ type: "due", date: args.due_date });
      if (args.priority) ops.push({ type: "priority", priority: args.priority });
      if (args.goal !== undefined) ops.push({ type: "goal", goalId: args.goal === null ? null : resolveGoal(org, args.goal).id });
      if (args.done !== undefined) ops.push({ type: args.done ? "done" : "open" });
      if (!ops.length) throw new Error("Nothing to change.");
      let first: UndoSnapshot | undefined;
      const messages: string[] = [];
      let count = 0;
      for (const op of ops) {
        const r = await bulk.bulkTodos(args.todos, op);
        if (!r.ok) throw new Error(r.message);
        // The first snapshot holds the full rows before any change, so it undoes all of them.
        first ??= r.undo;
        count = r.count;
        messages.push(r.message);
      }
      return report(`updated ${count} to-do(s)`, { ok: true, count, message: messages.join("; "), undo: first });
    },
  );

  defineTool(
    server,
    "delete_todos",
    {
      title: "Delete many to-dos",
      kind: "destructive",
      description: "Delete many hand-written to-dos at once (ids from list_todos). Returns an undo_id that restores them.",
      input: z.object({ todos: many("To-do id (from list_todos)") }),
    },
    async ({ todos }) => report(`deleted ${todos.length} to-do(s)`, await bulk.bulkTodos(todos, { type: "delete" })),
  );

  // ---------- goals and milestones ----------

  defineTool(
    server,
    "add_goals",
    {
      title: "Add goals",
      kind: "write",
      description: "Add several goals to a project at once, optionally all owned by one of its teams. Returns the new ids and an undo_id.",
      input: z.object({ project: ref(PROJECT_REF), titles: z.array(ref("Goal title")).min(1).max(100), team: ref(TEAM_REF).optional() }),
    },
    async ({ project, titles, team }) => {
      const org = await getOrg();
      const p = resolveProject(org, project);
      const t = team ? resolveTeam(org, team) : null;
      if (t && t.project_id !== p.id) throw new Error(`Team "${t.name}" isn't in ${p.name}.`);
      const r = await bulk.bulkAddGoals(p.id, titles.join("\n"), t?.id ?? null);
      return report(`added ${titles.length} goal(s) to ${p.name}`, r, { ids: r.ids });
    },
  );

  defineTool(
    server,
    "update_goals",
    {
      title: "Set goal status",
      kind: "write",
      description: "Mark many goals achieved, active again, or dropped at once. Returns an undo_id.",
      input: z.object({ goals: many(GOAL_REF, 200), status: GOAL_STATUS }),
    },
    async ({ goals, status }) => {
      const org = await getOrg();
      const ids = goals.map((g) => resolveGoal(org, g).id);
      return report(`set ${ids.length} goal(s) ${status}`, await bulk.bulkGoals(ids, { type: "status", status }));
    },
  );

  defineTool(
    server,
    "delete_goals",
    {
      title: "Delete goals",
      kind: "destructive",
      description: "Delete many goals and their milestones. Linked sessions and to-dos are kept, just unlinked. Can't be undone.",
      input: z.object({ goals: many(GOAL_REF, 200) }),
    },
    async ({ goals }) => {
      const org = await getOrg();
      const rows = goals.map((g) => resolveGoal(org, g));
      const r = await bulk.bulkGoals(
        rows.map((g) => g.id),
        { type: "delete" },
      );
      return report("deleted goals", r, { deleted: rows.map((g) => ({ id: g.id, title: g.title })) });
    },
  );

  defineTool(
    server,
    "add_milestones",
    {
      title: "Add milestones",
      kind: "write",
      description: "Append several milestones to a goal, in order. Returns the new ids and an undo_id.",
      input: z.object({ goal: ref(GOAL_REF), titles: z.array(ref("Milestone title")).min(1).max(100) }),
    },
    async ({ goal, titles }) => {
      const g = resolveGoal(await getOrg(), goal);
      const r = await bulk.bulkAddMilestones(g.id, titles.join("\n"));
      return report(`added ${titles.length} milestone(s) to ${g.title}`, r, { ids: r.ids });
    },
  );

  // ---------- people ----------

  defineTool(
    server,
    "hire_teammates",
    {
      title: "Hire several teammates",
      kind: "write",
      description:
        "Hire several people onto a team at once, each with a name and role; their cartoon and desk prop follow from the role. Names already on the team are skipped. Returns the new ids and an undo_id.",
      input: z.object({
        team: ref(TEAM_REF),
        people: z
          .array(z.object({ name: ref("A friendly first name, unique within the team"), role: ref("Their role, e.g. 'SEO Lead'") }))
          .min(1)
          .max(50),
      }),
    },
    async ({ team, people }) => {
      const t = resolveTeam(await getOrg(), team);
      const r = await bulk.hirePeople(t.id, people);
      return report(`hired ${people.length} onto ${t.name}`, r, { ids: r.ids });
    },
  );

  defineTool(
    server,
    "move_teammates",
    {
      title: "Move teammates",
      kind: "write",
      description: "Move several teammates to another team; their sessions follow them into the new team and project. Returns an undo_id.",
      input: z.object({ teammates: many(TEAMMATE_REF, 100), team: ref(TEAM_REF) }),
    },
    async ({ teammates, team }) => {
      const org = await getOrg();
      const t = resolveTeam(org, team);
      const ids = teammates.map((a) => resolveTeammate(org, a).id);
      return report(`moved ${ids.length} teammate(s) to ${t.name}`, await bulk.bulkAgents(ids, { type: "team", teamId: t.id }));
    },
  );

  defineTool(
    server,
    "remove_teammates",
    {
      title: "Remove teammates",
      kind: "destructive",
      description:
        "Remove several teammates at once; their sessions become unfiled. To hand one person's sessions to someone else instead, use remove_teammate. Can't be undone.",
      input: z.object({ teammates: many(TEAMMATE_REF, 100) }),
    },
    async ({ teammates }) => {
      const org = await getOrg();
      const rows = teammates.map((a) => resolveTeammate(org, a));
      const r = await bulk.bulkAgents(
        rows.map((a) => a.id),
        { type: "delete" },
      );
      return report("removed teammates", r, { removed: rows.map((a) => ({ id: a.id, name: a.name })) });
    },
  );

  // ---------- projects ----------

  defineTool(
    server,
    "move_projects",
    {
      title: "Move projects",
      kind: "write",
      description: "Move several projects into a company (company: null takes them out of any company). Returns an undo_id.",
      input: z.object({
        projects: many(PROJECT_REF, 200),
        company: z.string().trim().min(1).nullable().describe(`${COMPANY_REF}; null = no company`),
      }),
    },
    async ({ projects, company }) => {
      const org = await getOrg();
      const c = company === null ? null : resolveCompany(org, company);
      const ids = projects.map((p) => resolveProject(org, p).id);
      return report(`moved ${ids.length} project(s) to ${c?.name ?? "no company"}`, await bulk.bulkProjects(ids, { type: "company", companyId: c?.id ?? null }));
    },
  );

  defineTool(
    server,
    "delete_projects",
    {
      title: "Delete projects",
      kind: "destructive",
      description:
        "Delete several projects with their teams, teammates and goals. Their sessions stay imported but become unfiled; to-dos are kept without a project. To move one project's sessions elsewhere first, use delete_project. Can't be undone.",
      input: z.object({ projects: many(PROJECT_REF, 100) }),
    },
    async ({ projects }) => {
      const org = await getOrg();
      const rows = projects.map((p) => resolveProject(org, p));
      const r = await bulk.bulkProjects(
        rows.map((p) => p.id),
        { type: "delete" },
      );
      return report("deleted projects", r, { deleted: rows.map((p) => ({ id: p.id, name: p.name })) });
    },
  );

  // ---------- undo ----------

  defineTool(
    server,
    "undo",
    {
      title: "Undo a change",
      kind: "write",
      description:
        "Undo a change made through these tools, by the undo_id it returned: restores asks, to-dos, deleted comments, sessions' filing, teammates' teams, projects' companies and goal statuses, or removes what a bulk add created. The last 10 changes can be undone, each once.",
      input: z.object({ undo_id: ref("The undo_id a tool returned") }),
    },
    async ({ undo_id }) => {
      const entry = await getUndo(undo_id);
      if (!entry) {
        const recent = await listUndo();
        throw new Error(`Nothing to undo with that id.${recent.length ? ` Undoable now: ${recent.map((e) => `${e.change} (${e.undo_id})`).join("; ")}` : ""}`);
      }
      const r = await bulk.applyUndo(entry.snapshot);
      if (!r.ok) throw new Error(r.message);
      await dropUndo(undo_id);
      return { message: `Undid: ${entry.label}.`, restored: r.count };
    },
  );
}
