import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { syncStatus } from "../../auto-sync";
import { hasClaude } from "../../claude-cli";
import { clickupLink, mirrorStatus } from "../../clickup/mirror";
import { PROP_KINDS } from "../../classify/schema";
import { get, getSetting } from "../../db";
import { digestSince, getDigest } from "../../digest";
import { getOrganizeJob, isSetupComplete } from "../../organize";
import { getGoals, getInbox, getOrg, getSessions, getSnoozedCount, getSourceStats, getTodos, placeOf, type Org } from "../../queries";
import { cloudConfigFromEnv } from "../../sources/cloud";
import { clip } from "../../text";
import { THEMES } from "../../themes";
import { getMemory, getStaleDays, triageEngine } from "../../triage";
import type { SessionRow, TaskRow } from "../../types";
import { findSessions } from "../lookup";
import { getArtifacts, type ArtifactView } from "../../artifacts";
import { resolveCompany, resolveProject, resolveTeam, resolveTeammate } from "../resolve";
import { COMPANY_REF, defineTool, PROJECT_REF, ref, SESSION_REF, TEAM_REF, TEAMMATE_REF } from "../tool";
import { askBrief, getWorkload, placeOfSession, projectNode, sessionBrief, teammateNode, todoBrief } from "../views";

const SESSION_STATUSES = ["working", "needs_you", "review", "idle", "done", "failed"] as const;
const SOURCES = ["cloud", "local", "claude_ai"] as const;

/** One line per session, for digests. */
const mini = (org: Org, s: SessionRow) => {
  const { agent, project } = placeOfSession(org, s);
  return { id: s.id, title: s.title, teammate: agent?.name ?? null, project: project?.name ?? null };
};

/** An artifact in a tool result: enough to open it and see where it's filed. */
export function artifactBrief(a: ArtifactView) {
  return { id: a.id, title: a.title, url: a.url, project: a.project?.name ?? null, company: a.company?.name ?? null, session: a.session ? { id: a.session.id, title: a.session.title } : null };
}

export function registerReadTools(server: McpServer): void {
  defineTool(
    server,
    "get_org",
    {
      title: "Org chart",
      kind: "read",
      description:
        "The org chart: companies → projects → teams → teammates, plus each project's goals, with ids. Each teammate shows how many live sessions they own, how many are working, and how many asks wait on the user. Companies and projects count their artifacts (see list_artifacts). Also counts unfiled sessions (no owner) and open asks. Start here; narrow with company or project.",
      input: z.object({
        company: ref(COMPANY_REF).optional(),
        project: ref(PROJECT_REF).optional(),
      }),
    },
    async ({ company, project }) => {
      const [org, load] = await Promise.all([getOrg(), getWorkload()]);
      const arts = getArtifacts(org);
      const projectNodeWithArtifacts = (p: (typeof org.projects)[number]) => ({ ...projectNode(org, p, load), artifacts: arts.filter((a) => a.project?.id === p.id).length });
      const onlyCompany = company ? resolveCompany(org, company) : null;
      const onlyProject = project ? resolveProject(org, project) : null;
      const projects = org.projects.filter(
        (p) => (!onlyProject || p.id === onlyProject.id) && (!onlyCompany || p.company_id === onlyCompany.id),
      );
      const companies = (onlyCompany ? [onlyCompany] : org.companies)
        .map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          emoji: c.emoji,
          description: c.description,
          artifacts: arts.filter((a) => a.company?.id === c.id).length,
          projects: projects.filter((p) => p.company_id === c.id).map(projectNodeWithArtifacts),
        }))
        .filter((c) => !onlyProject || c.projects.length);
      return {
        companies,
        projects_without_company: onlyCompany ? [] : projects.filter((p) => !p.company_id).map(projectNodeWithArtifacts),
        unfiled_sessions: load.unfiled,
        open_asks: load.openAsks,
      };
    },
  );

  defineTool(
    server,
    "get_project",
    {
      title: "Project details",
      kind: "read",
      description:
        "Everything in one project: its company, teams and teammates (with workload), goals with progress, milestones, linked sessions, to-dos and the artifacts those sessions made, the project's open to-dos, and all of its artifacts.",
      input: z.object({ project: ref(PROJECT_REF) }),
    },
    async ({ project }) => {
      const org = await getOrg();
      const p = resolveProject(org, project);
      const [load, goals, todos] = await Promise.all([getWorkload(), getGoals(p.id), getTodos({ projectId: p.id })]);
      const company = org.companies.find((c) => c.id === p.company_id);
      const arts = getArtifacts(org, { projectId: p.id });
      const allArts = getArtifacts(org);
      return {
        ...projectNode(org, p, load),
        company: company ? { id: company.id, name: company.name } : null,
        goals: goals.map((g) => ({
          id: g.goal.id,
          title: g.goal.title,
          description: g.goal.description,
          status: g.goal.status,
          priority: g.goal.priority,
          due_date: g.goal.due_date,
          team: g.team?.name ?? null,
          progress_percent: Math.round(g.progress * 100),
          milestones: g.milestones.map((m) => ({ id: m.id, title: m.title, done: m.done })),
          sessions: g.sessions.map((s) => ({ id: s.id, title: s.title, status: s.status })),
          todos: g.todos.map((t) => ({ id: t.id, title: t.title, done: t.status === "done" })),
          artifacts: allArts.filter((a) => a.session && g.sessions.some((s) => s.id === a.session!.id)).map(artifactBrief),
        })),
        todos: todos.map(todoBrief),
        artifacts: arts.map(artifactBrief),
      };
    },
  );

  defineTool(
    server,
    "get_teammate",
    {
      title: "Teammate details",
      kind: "read",
      description: "One teammate: where they sit (team, project, company), their sessions (newest first, up to 50), their to-dos, the asks they're waiting on, and the artifacts their sessions made.",
      input: z.object({ teammate: ref(TEAMMATE_REF) }),
    },
    async ({ teammate }) => {
      const org = await getOrg();
      const a = resolveTeammate(org, teammate);
      const { team, project, company } = placeOf(org, a.id);
      const [sessions, todos, inbox] = await Promise.all([getSessions({ agentId: a.id }), getTodos(), getInbox()]);
      return {
        ...teammateNode(a),
        team: team ? { id: team.id, name: team.name } : null,
        project: project ? { id: project.id, name: project.name } : null,
        company: company ? { id: company.id, name: company.name } : null,
        total_sessions: sessions.length,
        sessions: sessions.slice(0, 50).map((s) => sessionBrief(org, s)),
        todos: todos.filter((t) => t.agent?.id === a.id).map(todoBrief),
        asks: inbox.filter((i) => i.agent?.id === a.id).map((i) => askBrief(org, i.task, i.session)),
        artifacts: getArtifacts(org, { agentId: a.id }).map(artifactBrief),
      };
    },
  );

  defineTool(
    server,
    "list_sessions",
    {
      title: "List sessions",
      kind: "read",
      description:
        "Imported Claude sessions, most recent activity first. Filter by project, team, teammate, status, source or title text; unfiled=true lists sessions nobody owns yet (the ones to organise); archived=true lists archived ones instead of live ones.",
      input: z.object({
        project: ref(PROJECT_REF).optional(),
        team: ref(TEAM_REF).optional(),
        teammate: ref(TEAMMATE_REF).optional(),
        status: z.enum(SESSION_STATUSES).optional(),
        source: z.enum(SOURCES).optional().describe(
            "cloud = Claude Code on the web (a terminal session connected to claude.ai with Remote Control is one cloud session, with a resume command), local = Claude Code on this machine, claude_ai = claude.ai chats",
          ),
        query: z.string().trim().min(1).optional().describe("Text to look for in the title"),
        unfiled: z.boolean().optional(),
        archived: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).default(50),
      }),
    },
    async (f) => {
      const org = await getOrg();
      const rows = await getSessions({
        projectId: f.project ? resolveProject(org, f.project).id : undefined,
        teamId: f.team ? resolveTeam(org, f.team).id : undefined,
        agentId: f.teammate ? resolveTeammate(org, f.teammate).id : undefined,
        status: f.status,
        source: f.source,
        q: f.query,
        unfiled: f.unfiled,
        archived: f.archived,
      });
      return {
        count: rows.length,
        ...(rows.length > f.limit ? { showing: f.limit } : {}),
        sessions: rows.slice(0, f.limit).map((s) => sessionBrief(org, s)),
      };
    },
  );

  defineTool(
    server,
    "get_session",
    {
      title: "Session details",
      kind: "read",
      description:
        "One session in full: owner, goal, status, first and last message, triage verdict, its open ask if it has one, the artifacts it made, and its ClickUp task (clickup_url) when ClickUp is mirrored.",
      input: z.object({ session: ref(SESSION_REF) }),
    },
    async ({ session }) => {
      const [[s], org] = await Promise.all([findSessions([session]), getOrg()]);
      const task = get<TaskRow>("select * from tasks where session_id = ? and status <> 'done'", s.id);
      return {
        ...sessionBrief(org, s),
        external_id: s.external_id,
        branch: s.branch,
        status_detail: s.status_detail,
        needs_action: (s.raw?.needs_action as string | null) ?? null,
        first_user_message: clip(s.first_user_message, 1500),
        last_message: clip(s.last_message, 1500),
        last_message_role: s.last_message_role,
        message_count: s.message_count,
        started_at: s.started_at,
        title_locked: s.title_locked,
        triage: s.triage,
        open_ask: task ? askBrief(org, task, s) : null,
        artifacts: getArtifacts(org, { sessionId: s.id }).map(artifactBrief),
        clickup_url: clickupLink("session", s.id)?.url ?? null,
      };
    },
  );

  defineTool(
    server,
    "get_inbox",
    {
      title: "Inbox",
      kind: "read",
      description:
        "What needs the user right now: open asks raised by sessions (respond, review, decide, unblock, run), newest first, with who is asking and why triage kept it. Handle them with handle_ask.",
      input: z.object({}),
    },
    async () => {
      const [org, items, snoozed] = await Promise.all([getOrg(), getInbox(), getSnoozedCount()]);
      return { count: items.length, snoozed, asks: items.map((i) => askBrief(org, i.task, i.session)) };
    },
  );

  defineTool(
    server,
    "list_todos",
    {
      title: "List to-dos",
      kind: "read",
      description: "Hand-written to-dos, soonest due first. assignee 'me' lists the user's own; a teammate lists theirs. Done ones are hidden unless include_done is true.",
      input: z.object({
        assignee: z.string().trim().min(1).optional().describe(`'me' for the user's own to-dos, or a teammate (${TEAMMATE_REF})`),
        project: ref(PROJECT_REF).optional(),
        include_done: z.boolean().default(false),
      }),
    },
    async ({ assignee, project, include_done }) => {
      const org = await getOrg();
      const mine = assignee?.toLowerCase() === "me";
      const agentId = assignee && !mine ? resolveTeammate(org, assignee).id : null;
      const items = await getTodos({ mine, projectId: project ? resolveProject(org, project).id : undefined, includeDone: include_done });
      const todos = (agentId ? items.filter((t) => t.agent?.id === agentId) : items).map(todoBrief);
      return { count: todos.length, todos };
    },
  );

  defineTool(
    server,
    "get_digest",
    {
      title: "Daily digest",
      kind: "read",
      description:
        "What changed since the user's last visit (or the last 24h / 7d): new asks, shipped and stuck sessions, goals achieved or moving, to-dos due soon, new sessions and teammates. mark_digest_read resets 'last visit'.",
      input: z.object({ since: z.enum(["last_visit", "24h", "7d"]).default("last_visit") }),
    },
    async ({ since }) => {
      const d = await getDigest(await digestSince(since === "last_visit" ? undefined : since));
      const projectName = (id: string) => d.org.projects.find((p) => p.id === id)?.name ?? null;
      return {
        since: d.since,
        new_asks: d.newAsks.map(({ task, session }) => askBrief(d.org, task, session)),
        shipped: d.shipped.map((s) => mini(d.org, s)),
        stuck: d.stuck.map((s) => mini(d.org, s)),
        working: d.working.map((s) => mini(d.org, s)),
        asks_handled: d.handled.length,
        goals_achieved: d.goalsAchieved.map((g) => ({ id: g.id, title: g.title, project: projectName(g.project_id) })),
        goals_moving: d.goalsMoving.map((g) => ({
          id: g.goal.id,
          title: g.goal.title,
          project: projectName(g.goal.project_id),
          progress_percent: Math.round(g.progress * 100),
        })),
        due_soon: d.dueSoon.map(todoBrief),
        new_sessions: d.newSessions.map((s) => mini(d.org, s)),
        new_teammates: d.newTeammates.map((a) => teammateNode(a)),
      };
    },
  );

  /** The timed sync, as get_settings reports it. `active` is false in `npm run mcp`, which doesn't run the loop. */
  const autoSync = () => {
    const s = syncStatus();
    return {
      every_seconds: s.every,
      cloud_every_seconds: s.cloudEvery,
      active: s.active,
      running: s.running,
      last_at: s.lastAt,
      last_ok: s.lastOk,
      last_message: s.lastMessage,
      next_at: s.nextAt,
    };
  };

  /** The ClickUp mirror, as get_settings reports it. */
  const clickupBrief = () => {
    const c = mirrorStatus();
    return {
      configured: c.configured,
      workspace_id: c.workspaceId,
      space_id: c.spaceId,
      mirrored: c.mirrored,
      running: c.running,
      last_at: c.lastAt,
      last_ok: c.lastOk,
      last_message: c.lastMessage,
    };
  };

  defineTool(
    server,
    "get_settings",
    {
      title: "Settings and status",
      kind: "read",
      description:
        "Timu's configuration and health: sources and their last import, auto-sync (how often, last and next run), the ClickUp mirror (on or off, what's mirrored, last push), the organiser and its current job, the triage engine, idle cut-off and triage memory rules (with ids for editing), plus the allowed project themes and teammate props.",
      input: z.object({}),
    },
    async () => {
      const [setup, job, sources, memory, staleDays, seen] = await Promise.all([
        isSetupComplete(),
        getOrganizeJob(),
        getSourceStats(),
        getMemory(),
        getStaleDays(),
        getSetting<string>("digest_seen_at"),
      ]);
      return {
        setup_complete: setup,
        organiser: hasClaude() ? "claude" : "rules",
        organize_job: job,
        cloud_pull_configured: !!cloudConfigFromEnv(),
        auto_sync: autoSync(),
        clickup: clickupBrief(),
        sources,
        triage: {
          engine: triageEngine(),
          stale_days: staleDays,
          memory: memory.map((m) => ({ id: m.id, text: m.text, source: m.source })),
        },
        digest_last_read: seen,
        themes: THEMES.map((t) => ({ id: t.id, label: t.label })),
        props: PROP_KINDS,
      };
    },
  );
}
