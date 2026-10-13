import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getOrg } from "../../queries";
import { describeRoutines, getRoutines, importRoutinesFromJson } from "../../routines";
import { resolveProject, resolveTeammate } from "../resolve";
import { defineTool, PROJECT_REF, ref, TEAMMATE_REF } from "../tool";

export function registerRoutineTools(server: McpServer): void {
  defineTool(
    server,
    "list_routines",
    {
      title: "Routines and scheduled check-ins",
      kind: "read",
      description:
        "Claude Code routines (recurring scheduled agents) and the one-off check-ins sessions schedule for themselves, soonest first, each with its schedule in words, next run, last run status, and the teammate / project / session it belongs to. Filter by project or teammate; include_done shows ones that already ran or were switched off.",
      input: z.object({
        project: ref(PROJECT_REF).optional(),
        teammate: ref(TEAMMATE_REF).optional(),
        include_done: z.boolean().default(false),
      }),
    },
    async ({ project, teammate, include_done }) => {
      const org = await getOrg();
      const views = getRoutines(org, {
        projectId: project ? resolveProject(org, project).id : undefined,
        agentId: teammate ? resolveTeammate(org, teammate).id : undefined,
      }).filter((v) => include_done || v.state === "scheduled");
      views.sort((a, b) => (a.routine.next_run_at ?? "9999").localeCompare(b.routine.next_run_at ?? "9999"));
      return {
        count: views.length,
        routines: views.map((v) => ({
          id: v.routine.id,
          name: v.routine.name,
          kind: v.routine.kind === "reminder" ? "session check-in" : v.routine.kind,
          state: v.state,
          schedule: v.schedule,
          next_run_at: v.state === "scheduled" ? v.routine.next_run_at : null,
          last_run: v.routine.last_fired_at ? { at: v.routine.last_fired_at, status: v.routine.last_run_status } : null,
          prompt: v.routine.prompt,
          teammate: v.agent ? { id: v.agent.id, name: v.agent.name } : null,
          project: v.project ? { id: v.project.id, name: v.project.name } : null,
          session: v.session ? { id: v.session.id, title: v.session.title, url: v.session.url } : null,
        })),
      };
    },
  );

  defineTool(
    server,
    "import_routines",
    {
      title: "Import routines",
      kind: "write",
      description:
        "Import Claude Code routines from JSON: the raw output of the RemoteTrigger tool's list action (an API page with `data`, a bare array, or the 'HTTP 200' text it prints). Updates ones Timu already has. Sync does this automatically when a cloud token is set.",
      input: z.object({ json: z.string().trim().min(2).describe("The JSON text, as returned") }),
    },
    async ({ json }) => ({ message: describeRoutines(importRoutinesFromJson(json)) }),
  );
}
