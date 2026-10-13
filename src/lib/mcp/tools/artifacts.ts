import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { describeArtifacts, getArtifacts, importArtifacts, moveArtifact } from "../../artifacts";
import { getOrg } from "../../queries";
import { artifactIdFromUrl } from "../../sources/artifacts";
import { findSessions } from "../lookup";
import { resolveCompany, resolveGoal, resolveProject, resolveTeammate } from "../resolve";
import { COMPANY_REF, defineTool, PROJECT_REF, ref, SESSION_REF, TEAMMATE_REF } from "../tool";

export function registerArtifactTools(server: McpServer): void {
  defineTool(
    server,
    "import_artifacts",
    {
      title: "Import artifacts",
      kind: "write",
      description:
        "Import your Claude artifacts (pages published to claude.ai) into Timu: paste the list exactly as your artifact tool prints it (lines like '- (mine) Title — https://claude.ai/artifact/… — updated 2026-10-13'), or JSON with url and title. Updates ones Timu already has, then files each under the session that links to it, else by its title.",
      input: z.object({ text: z.string().trim().min(10).describe("The artifacts list, as printed (or JSON)") }),
    },
    async ({ text }) => ({ message: describeArtifacts(importArtifacts(text)) }),
  );

  defineTool(
    server,
    "list_artifacts",
    {
      title: "Artifacts",
      kind: "read",
      description:
        "Your Claude artifacts in Timu, newest first, each with its link, the project and company it's filed under (and how: session, title or you), and the session that made it. Filter by company, project, goal (made by its sessions), teammate (made by their sessions) or session.",
      input: z.object({
        company: ref(COMPANY_REF).optional(),
        project: ref(PROJECT_REF).optional(),
        goal: ref("Goal id or exact title; write 'Project / Goal' when the title repeats").optional(),
        teammate: ref(TEAMMATE_REF).optional(),
        session: ref(SESSION_REF).optional(),
      }),
    },
    async ({ company, project, goal, teammate, session }) => {
      const org = await getOrg();
      const views = getArtifacts(org, {
        companyId: company ? resolveCompany(org, company).id : undefined,
        projectId: project ? resolveProject(org, project).id : undefined,
        goalId: goal ? resolveGoal(org, goal).id : undefined,
        agentId: teammate ? resolveTeammate(org, teammate).id : undefined,
        sessionId: session ? (await findSessions([session]))[0].id : undefined,
      });
      return {
        count: views.length,
        artifacts: views.map((a) => ({
          id: a.id,
          title: a.title,
          url: a.url,
          owner: a.owner,
          updated_at: a.updatedAt,
          project: a.project?.name ?? null,
          company: a.company?.name ?? null,
          filed_by: a.filedBy,
          session: a.session ? { id: a.session.id, title: a.session.title } : null,
        })),
      };
    },
  );

  defineTool(
    server,
    "move_artifact",
    {
      title: "File an artifact",
      kind: "write",
      description: "Put an artifact in a project (project: null takes it out). Artifacts you file stay where you put them.",
      input: z.object({
        artifact: z.string().trim().min(6).describe("The artifact's id or claude.ai link"),
        project: z.union([ref(PROJECT_REF), z.null()]),
      }),
    },
    async ({ artifact, project }) => {
      const org = await getOrg();
      const id = artifactIdFromUrl(artifact) ?? artifact;
      const p = project ? resolveProject(org, project) : null;
      moveArtifact(id, p?.id ?? null);
      return { message: p ? `Filed under ${p.name}` : "Taken out of its project" };
    },
  );
}
