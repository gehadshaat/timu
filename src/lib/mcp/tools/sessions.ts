import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { importCloudFromJson } from "../../importers";
import * as ops from "../../ops";
import { syncNow } from "../../auto-sync";
import { startOrganize } from "../../organize";
import { getOrg } from "../../queries";
import { getMemory } from "../../triage";
import { findSessions } from "../lookup";
import { resolveGoal, resolveTeammate } from "../resolve";
import { defineTool, expectOk, GOAL_REF, ref, SESSION_REF, TEAMMATE_REF } from "../tool";

const sessionList = z.array(ref(SESSION_REF)).min(1).max(500);

export function registerSessionTools(server: McpServer): void {
  // ---------- filing sessions ----------

  defineTool(
    server,
    "assign_sessions",
    {
      title: "Assign sessions",
      kind: "write",
      description:
        "Give one or more sessions to a teammate; each moves into that teammate's team and project. This is how you file unfiled sessions or move work between people.",
      input: z.object({ sessions: sessionList, teammate: ref(TEAMMATE_REF) }),
    },
    async ({ sessions, teammate }) => {
      const org = await getOrg();
      const a = resolveTeammate(org, teammate);
      const rows = await findSessions(sessions);
      for (const s of rows) await ops.reassignSession(s.id, a.id);
      return {
        message: `Gave ${rows.length} session${rows.length === 1 ? "" : "s"} to ${a.name}.`,
        sessions: rows.map((s) => ({ id: s.id, title: s.title })),
      };
    },
  );

  defineTool(
    server,
    "update_session",
    {
      title: "Update session",
      kind: "write",
      description:
        "Rename a session (the new title survives re-imports), link it to a goal (goal: null unlinks; linking also moves it into the goal's project), or archive it (hides it everywhere, closes its asks, stops re-filing) / unarchive it.",
      input: z.object({
        session: ref(SESSION_REF),
        title: z.string().trim().min(1).optional(),
        goal: z.string().trim().min(1).nullable().optional().describe(`${GOAL_REF}; null = unlink`),
        archived: z.boolean().optional(),
      }),
    },
    async ({ session, title, goal, archived }) => {
      const [s] = await findSessions([session]);
      const changed: string[] = [];
      if (title) {
        await ops.renameSession(s.id, title);
        changed.push("renamed");
      }
      if (goal !== undefined) {
        const g = goal === null ? null : resolveGoal(await getOrg(), goal);
        await ops.linkSessionToGoal(s.id, g?.id ?? null);
        changed.push(g ? `linked to goal "${g.title}"` : "unlinked from its goal");
      }
      if (archived !== undefined && archived !== s.archived) {
        await ops.archiveSession(s.id, archived);
        changed.push(archived ? "archived" : "unarchived");
      }
      return { message: changed.length ? `Session ${changed.join(", ")}.` : "Nothing to change.", session: { id: s.id, title: title ?? s.title } };
    },
  );

  defineTool(
    server,
    "unfile_sessions",
    {
      title: "Unfile sessions",
      kind: "write",
      description:
        "Take sessions away from their owner. from 'owner' removes the teammate and team but keeps the project; 'project' clears project, team, teammate and goal.",
      input: z.object({ sessions: sessionList, from: z.enum(["owner", "project"]).default("owner") }),
    },
    async ({ sessions, from }) => {
      const rows = await findSessions(sessions);
      for (const s of rows) await ops.unlinkSession(s.id, from);
      return { message: `Unfiled ${rows.length} session${rows.length === 1 ? "" : "s"}.`, sessions: rows.map((s) => ({ id: s.id, title: s.title })) };
    },
  );

  // ---------- importing and organising ----------

  defineTool(
    server,
    "sync_sessions",
    {
      title: "Sync sessions",
      kind: "write",
      description:
        "Pull new activity from every configured source (local Claude Code transcripts, and cloud sessions when a token is set), then start the organiser to file new sessions. Returns what was imported. Timu already does this by itself (by default every minute, cloud every 5; see get_settings → auto_sync), so call it only when you need the latest right now.",
      input: z.object({}),
    },
    async () => expectOk(await syncNow()).message,
  );

  defineTool(
    server,
    "import_cloud_sessions",
    {
      title: "Import cloud sessions",
      kind: "write",
      description:
        "Import Claude Code cloud sessions from JSON: the raw output of the list_sessions tool in a Claude Code cloud session (an API page with `data`, a bare array, or the `{ccr: …}` wrapper). Run organize_sessions afterwards to file them.",
      input: z.object({ json: z.string().trim().min(2).describe("The JSON text, as returned") }),
    },
    async ({ json }) => {
      let payload: unknown;
      try {
        payload = JSON.parse(json);
      } catch {
        throw new Error("That isn't valid JSON.");
      }
      return { message: ops.describe(await importCloudFromJson(payload), "Cloud sessions") };
    },
  );

  defineTool(
    server,
    "organize_sessions",
    {
      title: "Run the organiser",
      kind: "write",
      description:
        "Start Timu's organiser in the background: it files every unclassified session into the existing org (hiring teammates only when nothing fits) and raises asks. A filed session with new activity is filed again once it has been quiet for 10 minutes. Poll get_settings → organize_job for progress. To place sessions yourself, use assign_sessions instead.",
      input: z.object({}),
    },
    async () => {
      const job = await startOrganize("incremental");
      return { message: job.state === "running" ? "Organiser started." : "Nothing is waiting to be filed.", job };
    },
  );

  // ---------- triage ----------

  defineTool(
    server,
    "add_triage_rule",
    {
      title: "Add triage rule",
      kind: "write",
      description:
        "Teach the triage judge a plain-language rule about when a session does or doesn't need the user, e.g. 'Dependabot PRs never need me'. Run recheck_open_asks to apply it to open asks.",
      input: z.object({ text: ref("The rule, in plain language") }),
    },
    async ({ text }) => ({ message: "Rule saved.", rule: await ops.addMemory(text) }),
  );

  defineTool(
    server,
    "update_triage_rule",
    {
      title: "Update triage rule",
      kind: "write",
      description: "Reword a triage rule. Rule ids come from get_settings → triage.memory.",
      input: z.object({ rule_id: ref("Rule id"), text: ref("The new wording") }),
    },
    async ({ rule_id, text }) => {
      if (!(await getMemory()).some((m) => m.id === rule_id)) throw new Error(`No triage rule with id ${rule_id}. See get_settings.`);
      await ops.updateMemory(rule_id, text);
      return { message: "Rule saved.", rule: { id: rule_id, text } };
    },
  );

  defineTool(
    server,
    "delete_triage_rule",
    {
      title: "Delete triage rule",
      kind: "destructive",
      description: "Forget a triage rule. Rule ids come from get_settings → triage.memory.",
      input: z.object({ rule_id: ref("Rule id") }),
    },
    async ({ rule_id }) => {
      const rule = (await getMemory()).find((m) => m.id === rule_id);
      if (!rule) throw new Error(`No triage rule with id ${rule_id}. See get_settings.`);
      await ops.deleteMemory(rule_id);
      return { message: "Rule deleted.", deleted: { id: rule.id, text: rule.text } };
    },
  );

  defineTool(
    server,
    "set_stale_days",
    {
      title: "Set idle cut-off",
      kind: "write",
      description: "Sessions idle at least this many days never raise an ask (0 turns the cut-off off). They are still imported.",
      input: z.object({ days: z.number().int().min(0).max(3650) }),
    },
    async ({ days }) => ({ message: "Saved.", stale_days: await ops.setStaleDays(days) }),
  );

  defineTool(
    server,
    "mark_digest_read",
    {
      title: "Mark digest read",
      kind: "write",
      description: "Mark the daily digest as read, so the next get_digest starts from now.",
      input: z.object({}),
    },
    async () => {
      await ops.markDigestSeen();
      return "Digest marked as read.";
    },
  );
}
