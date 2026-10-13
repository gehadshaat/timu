import "server-only";
import { listAccounts } from "./claude-accounts";
import { claudeOrgUuid, claudeTokens } from "./claude-auth";
import { REAUTH_HINT, rememberLogin, withClaudeToken } from "./claude-auth-store";
import { all, insert } from "./db";
import { resumeFor } from "./links";
import type { Org } from "./queries";
import { cronToText, extractRoutineRecords, fetchRoutines, mapRoutine, routinesConfigFromEnv, type RoutineKind } from "./sources/routines";
import type { AgentRow, ProjectRow, SessionSource } from "./types";

export interface RoutineRow {
  id: string;
  name: string;
  kind: RoutineKind;
  enabled: boolean;
  cron_expression: string | null;
  run_once_at: string | null;
  next_run_at: string | null;
  last_fired_at: string | null;
  last_run_status: "succeeded" | "failed" | "running" | null;
  last_run_session: string | null;
  home_session: string | null;
  ended_reason: string | null;
  prompt: string | null;
  created_at: string | null;
  updated_at: string | null;
  account?: string | null;
}

export interface RoutinesResult {
  imported: number;
  updated: number;
}

/** Upsert routines by their trigger id; rows that disappear from Claude are kept as history. */
/** `account` tags them with the Claude account they came from (kept as is when omitted). */
export function saveRoutines(payload: unknown, account?: string): RoutinesResult {
  const rows = extractRoutineRecords(payload)
    .map(mapRoutine)
    .map((r) => (account ? { ...r, account } : r));
  if (!rows.length) return { imported: 0, updated: 0 };
  const known = new Set(all<{ id: string }>("select id from routines where id in (select value from json_each(?))", rows.map((r) => r.id)).map((r) => r.id));
  insert("routines", rows as unknown as Record<string, unknown>[], { on: "id", do: "update" });
  return { imported: rows.filter((r) => !known.has(r.id)).length, updated: rows.filter((r) => known.has(r.id)).length };
}

/** Routines from every signed-in Claude account, each with its own login and organisation. */
export async function importRoutinesFromApi(): Promise<RoutinesResult & { notes?: string[] }> {
  const cfg = routinesConfigFromEnv();
  if (!cfg) throw new Error(`Not signed in to Claude. ${REAUTH_HINT} Or paste the routines JSON instead.`);
  const accounts = listAccounts().filter((a) => claudeTokens(a).length);
  const total: RoutinesResult = { imported: 0, updated: 0 };
  const failures: string[] = [];
  for (const a of accounts) {
    try {
      const records = await withClaudeToken(
        (token) => fetchRoutines({ ...cfg, token, orgUuid: claudeOrgUuid(a) ?? undefined }),
        claudeTokens(a),
        (t) => rememberLogin(t, a),
      );
      const r = saveRoutines({ data: records }, a.id);
      total.imported += r.imported;
      total.updated += r.updated;
    } catch (err) {
      if (accounts.length === 1) throw err;
      failures.push(`${a.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length === accounts.length) throw new Error(failures.join(" · "));
  return failures.length ? { ...total, notes: failures } : total;
}

export function importRoutinesFromJson(payload: unknown): RoutinesResult {
  if (!extractRoutineRecords(payload).length) throw new Error("No routines found in that JSON (expected objects with ids like trig_…).");
  return saveRoutines(payload);
}

export function describeRoutines(r: RoutinesResult & { notes?: string[] }): string {
  return `Routines: ${r.imported} new, ${r.updated} updated${r.notes?.length ? ` (${r.notes.join("; ")})` : ""}`;
}

export interface RoutineView {
  routine: RoutineRow;
  /** Words for the schedule: "Daily 8:54 · New York", or "Once" for a check-in. */
  schedule: string;
  /** The session it belongs to: a check-in's own session, else its last run. */
  session: { id: string; title: string; url: string | null; resume: string | null; source: SessionSource } | null;
  agent: AgentRow | null;
  project: ProjectRow | null;
  /** Scheduled = will fire again; done = ran once or switched off. */
  state: "scheduled" | "done";
}

/** Every routine, filed under the teammate and project of the session it belongs to. */
export function getRoutines(org: Org, filter: { projectId?: string; agentId?: string } = {}): RoutineView[] {
  const routines = all<RoutineRow>("select * from routines order by coalesce(next_run_at, last_fired_at, created_at) desc");
  const ext = [...new Set(routines.flatMap((r) => [r.home_session, r.last_run_session]).filter((x): x is string => !!x))];
  const sessions = ext.length
    ? all<{ id: string; external_id: string; title: string; url: string | null; source: SessionSource; agent_id: string | null; project_id: string | null }>(
        "select id, external_id, title, url, source, agent_id, project_id from sessions where external_id in (select value from json_each(?))",
        ext,
      )
    : [];
  const byExt = new Map(sessions.map((s) => [s.external_id, s]));
  const now = Date.now();

  return routines
    .map((routine): RoutineView => {
      const s = byExt.get(routine.home_session ?? "") ?? byExt.get(routine.last_run_session ?? "") ?? null;
      const agent = org.agents.find((a) => a.id === s?.agent_id) ?? null;
      const project = org.projects.find((p) => p.id === s?.project_id) ?? null;
      const recurring = !!routine.cron_expression;
      const upcoming = !!routine.next_run_at && Date.parse(routine.next_run_at) > now;
      const scheduled = routine.enabled && (recurring || (upcoming && !routine.ended_reason));
      return {
        routine,
        schedule: recurring ? (cronToText(routine.cron_expression) ?? routine.cron_expression!) : "Once",
        session: s ? { id: s.id, title: s.title, url: s.url, resume: resumeFor(s), source: s.source } : null,
        agent,
        project,
        state: scheduled ? "scheduled" : "done",
      };
    })
    .filter((v) => (!filter.projectId || v.project?.id === filter.projectId) && (!filter.agentId || v.agent?.id === filter.agentId));
}

/** The lean shape the routines board renders (see components/routines/RoutinesBoard). */
export function toRoutineItem(v: RoutineView) {
  return {
    id: v.routine.id,
    name: v.routine.name,
    kind: v.routine.kind,
    prompt: v.routine.prompt,
    schedule: v.schedule,
    state: v.state,
    recurring: !!v.routine.cron_expression,
    nextRunAt: v.routine.next_run_at,
    lastRunAt: v.routine.last_fired_at,
    lastRunStatus: v.routine.last_run_status,
    session: v.session ? { id: v.session.id, title: v.session.title, url: v.session.url, resume: v.session.resume } : null,
    // Links that work even when Timu hasn't imported the session: the routine's page on claude.ai,
    // and its latest session there (a check-in's own session, else the last run).
    routineUrl: `https://claude.ai/code/routines/${v.routine.id}`,
    latestUrl: (() => {
      const id = v.routine.home_session ?? v.routine.last_run_session;
      return id ? `https://claude.ai/code/${id}` : null;
    })(),
    latestLabel: v.routine.home_session ? "Session" : "Latest run",
    account: v.routine.account ?? null,
    agent: v.agent ? { id: v.agent.id, name: v.agent.name, role: v.agent.role, avatar: v.agent.avatar } : null,
    project: v.project ? { name: v.project.name, emoji: v.project.emoji, slug: v.project.slug } : null,
  };
}
