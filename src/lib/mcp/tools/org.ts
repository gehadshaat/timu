import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { PROP_KINDS } from "../../classify/schema";
import * as ops from "../../ops";
import { getOrg, type Org } from "../../queries";
import { THEMES } from "../../themes";
import { resolveCompany, resolveProject, resolveTeam, resolveTeammate } from "../resolve";
import { COMPANY_REF, defineTool, expectOk, PROJECT_REF, ref, TEAM_REF, TEAMMATE_REF } from "../tool";

const THEME_IDS = THEMES.map((t) => t.id) as [string, ...string[]];
const theme = z.enum(THEME_IDS).describe(`Office look for the project's floor: ${THEMES.map((t) => `${t.id} (${t.label})`).join(", ")}`);
const prop = z.enum(PROP_KINDS).describe("What the teammate's cartoon holds, matching their role");
const emoji = z.string().trim().min(1).max(16).describe("A single emoji");

const fate = {
  sessions: z
    .enum(["unfile", "refile", "move"])
    .default("unfile")
    .describe("What happens to its sessions: unfile = keep them with no owner; refile = the next sync lets the organiser place them again; move = hand them to move_to_team"),
  move_to_team: ref(`Where sessions go when sessions is 'move'. ${TEAM_REF}`).optional(),
};

function fateOf(org: Org, sessions: "unfile" | "refile" | "move", moveTo: string | undefined): ops.SessionFate {
  if (sessions !== "move") return { kind: sessions };
  if (!moveTo) throw new Error("Say which team gets the sessions (move_to_team), or pick sessions 'unfile' or 'refile'.");
  return { kind: "move", teamId: resolveTeam(org, moveTo).id };
}

export function registerOrgTools(server: McpServer): void {
  // ---------- companies ----------

  defineTool(
    server,
    "create_company",
    {
      title: "Create company",
      kind: "write",
      description: "Add a company: the top level above projects (a client, a business, or 'Personal').",
      input: z.object({ name: ref("Company name"), description: z.string().optional(), emoji: emoji.optional() }),
    },
    async ({ name, description, emoji }) => {
      const r = expectOk(await ops.saveEntity("company", null, { name, description, emoji }));
      return { message: r.message, company: { id: r.id, slug: r.slug, name } };
    },
  );

  defineTool(
    server,
    "update_company",
    {
      title: "Update company",
      kind: "write",
      description: "Rename a company or change its description or emoji. Fields you leave out stay as they are.",
      input: z.object({ company: ref(COMPANY_REF), name: z.string().trim().min(1).optional(), description: z.string().optional(), emoji: emoji.optional() }),
    },
    async (args) => {
      const c = resolveCompany(await getOrg(), args.company);
      const r = expectOk(
        await ops.saveEntity("company", c.id, {
          name: args.name ?? c.name,
          description: args.description ?? c.description,
          emoji: args.emoji ?? c.emoji,
        }),
      );
      return { message: r.message, company: { id: c.id, slug: r.slug, name: args.name ?? c.name } };
    },
  );

  defineTool(
    server,
    "delete_company",
    {
      title: "Delete company",
      kind: "destructive",
      description: "Delete a company. Its projects are kept; they just no longer belong to a company.",
      input: z.object({ company: ref(COMPANY_REF) }),
    },
    async ({ company }) => {
      const c = resolveCompany(await getOrg(), company);
      return { message: expectOk(await ops.deleteCompany(c.id)).message, deleted: { id: c.id, name: c.name } };
    },
  );

  // ---------- projects ----------

  defineTool(
    server,
    "create_project",
    {
      title: "Create project",
      kind: "write",
      description: "Add a project, optionally under a company. Add teams to it with create_team.",
      input: z.object({
        name: ref("Project name"),
        company: ref(COMPANY_REF).optional(),
        description: z.string().optional(),
        emoji: emoji.optional(),
        theme: theme.optional(),
      }),
    },
    async ({ name, company, description, emoji, theme }) => {
      const org = await getOrg();
      const companyId = company ? resolveCompany(org, company).id : null;
      const r = expectOk(await ops.saveEntity("project", null, { name, description, emoji, company_id: companyId }));
      if (theme) await ops.setProjectTheme(r.id, theme);
      return { message: r.message, project: { id: r.id, slug: r.slug, name } };
    },
  );

  defineTool(
    server,
    "update_project",
    {
      title: "Update project",
      kind: "write",
      description:
        "Rename a project, change its description, emoji or office theme, or move it to another company (company: null detaches it). Fields you leave out stay as they are.",
      input: z.object({
        project: ref(PROJECT_REF),
        name: z.string().trim().min(1).optional(),
        company: z.string().trim().min(1).nullable().optional().describe(`${COMPANY_REF}; null = no company`),
        description: z.string().optional(),
        emoji: emoji.optional(),
        theme: theme.optional(),
      }),
    },
    async (args) => {
      const org = await getOrg();
      const p = resolveProject(org, args.project);
      const companyId = args.company === undefined ? p.company_id : args.company === null ? null : resolveCompany(org, args.company).id;
      const r = expectOk(
        await ops.saveEntity("project", p.id, {
          name: args.name ?? p.name,
          description: args.description ?? p.description,
          emoji: args.emoji ?? p.emoji,
          company_id: companyId,
        }),
      );
      if (args.theme) await ops.setProjectTheme(p.id, args.theme);
      return { message: r.message, project: { id: p.id, slug: r.slug, name: args.name ?? p.name } };
    },
  );

  defineTool(
    server,
    "delete_project",
    {
      title: "Delete project",
      kind: "destructive",
      description:
        "Delete a project with its teams, teammates, goals and milestones. Hand-written to-dos are kept (without a project). Choose what happens to its sessions.",
      input: z.object({ project: ref(PROJECT_REF), ...fate }),
    },
    async ({ project, sessions, move_to_team }) => {
      const org = await getOrg();
      const p = resolveProject(org, project);
      const r = expectOk(await ops.deleteProject(p.id, fateOf(org, sessions, move_to_team)));
      return { message: r.message, deleted: { id: p.id, name: p.name }, sessions };
    },
  );

  // ---------- teams ----------

  defineTool(
    server,
    "create_team",
    {
      title: "Create team",
      kind: "write",
      description: "Add a team (a department such as 'Marketing' or 'Web Engineering') to a project. Staff it with hire_teammate.",
      input: z.object({ project: ref(PROJECT_REF), name: ref("Team name, unique within the project"), description: z.string().optional() }),
    },
    async ({ project, name, description }) => {
      const p = resolveProject(await getOrg(), project);
      const r = expectOk(await ops.saveEntity("team", null, { name, description, project_id: p.id }));
      return { message: r.message, team: { id: r.id, name, project: p.name } };
    },
  );

  defineTool(
    server,
    "update_team",
    {
      title: "Update team",
      kind: "write",
      description: "Rename a team or change its description. Fields you leave out stay as they are.",
      input: z.object({ team: ref(TEAM_REF), name: z.string().trim().min(1).optional(), description: z.string().optional() }),
    },
    async (args) => {
      const t = resolveTeam(await getOrg(), args.team);
      const r = expectOk(await ops.saveEntity("team", t.id, { name: args.name ?? t.name, description: args.description ?? t.description }));
      return { message: r.message, team: { id: t.id, name: args.name ?? t.name } };
    },
  );

  defineTool(
    server,
    "delete_team",
    {
      title: "Delete team",
      kind: "destructive",
      description: "Delete a team and its teammates. Their to-dos fall back to the user. Choose what happens to the team's sessions.",
      input: z.object({ team: ref(TEAM_REF), ...fate }),
    },
    async ({ team, sessions, move_to_team }) => {
      const org = await getOrg();
      const t = resolveTeam(org, team);
      const r = expectOk(await ops.deleteTeam(t.id, fateOf(org, sessions, move_to_team)));
      return { message: r.message, deleted: { id: t.id, name: t.name }, sessions };
    },
  );

  // ---------- teammates ----------

  defineTool(
    server,
    "hire_teammate",
    {
      title: "Hire teammate",
      kind: "write",
      description: "Add a teammate to a team: a persona that owns a stream of Claude sessions (e.g. Maya, SEO Manager). Give them sessions with assign_sessions.",
      input: z.object({
        team: ref(TEAM_REF),
        name: ref("A friendly first name, unique within the team"),
        role: ref("Job title, e.g. 'SEO Manager'"),
        persona: z.string().optional().describe("One sentence: what they own"),
        prop: prop.optional(),
      }),
    },
    async ({ team, name, role, persona, prop }) => {
      const t = resolveTeam(await getOrg(), team);
      const r = expectOk(await ops.saveEntity("agent", null, { name, role, persona, prop, team_id: t.id }));
      return { message: r.message, teammate: { id: r.id, name, role, team: t.name } };
    },
  );

  defineTool(
    server,
    "update_teammate",
    {
      title: "Update teammate",
      kind: "write",
      description:
        "Change a teammate's name, role, persona or prop, or move them to another team (their sessions move with them). Fields you leave out stay as they are.",
      input: z.object({
        teammate: ref(TEAMMATE_REF),
        name: z.string().trim().min(1).optional(),
        role: z.string().trim().min(1).optional(),
        persona: z.string().optional(),
        prop: prop.optional(),
        team: ref(`Move them to this team. ${TEAM_REF}`).optional(),
      }),
    },
    async (args) => {
      const org = await getOrg();
      const a = resolveTeammate(org, args.teammate);
      const team = args.team ? resolveTeam(org, args.team) : null;
      const r = expectOk(
        await ops.saveEntity("agent", a.id, {
          name: args.name ?? a.name,
          role: args.role ?? a.role,
          persona: args.persona ?? a.persona,
          prop: args.prop,
          team_id: team?.id,
        }),
      );
      return { message: r.message, teammate: { id: a.id, name: args.name ?? a.name, team: (team ?? org.teams.find((t) => t.id === a.team_id))?.name } };
    },
  );

  defineTool(
    server,
    "remove_teammate",
    {
      title: "Remove teammate",
      kind: "destructive",
      description: "Remove a teammate. Their sessions and to-dos go to hand_sessions_to if given; otherwise sessions become unfiled and to-dos fall back to the user.",
      input: z.object({ teammate: ref(TEAMMATE_REF), hand_sessions_to: ref(`Another teammate. ${TEAMMATE_REF}`).optional() }),
    },
    async ({ teammate, hand_sessions_to }) => {
      const org = await getOrg();
      const a = resolveTeammate(org, teammate);
      const to = hand_sessions_to ? resolveTeammate(org, hand_sessions_to) : null;
      if (to?.id === a.id) throw new Error("hand_sessions_to must be a different teammate.");
      const r = expectOk(await ops.deleteAgent(a.id, to?.id ?? null));
      return { message: r.message, removed: { id: a.id, name: a.name }, sessions_went_to: to ? { id: to.id, name: to.name } : "unfiled" };
    },
  );
}
