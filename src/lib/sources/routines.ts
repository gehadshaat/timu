import { listAccounts } from "../claude-accounts";
import { ClaudeAuthError, claudeOrgUuid, claudeTokens } from "../claude-auth";
import { clip } from "../text";

/**
 * Claude Code routines: scheduled cloud agents ("every weekday at 9, check the ads"), and the
 * one-off check-ins a session schedules for itself ("re-check PR #40 in an hour"). Both come from
 * the routines API (GET /v1/code/triggers, the one /schedule and the RemoteTrigger tool use), or
 * from a pasted copy of its JSON. Like cloud sessions this API is unofficial and may change.
 */

export interface RoutineRecord {
  id: string;
  name?: string;
  created_kind?: string;
  enabled?: boolean;
  cron_expression?: string;
  run_once_at?: string | null;
  next_run_at?: string | null;
  last_fired_at?: string | null;
  ended_reason?: string | null;
  persistent_session_id?: string | null;
  created_at?: string;
  updated_at?: string;
  derived_state?: { prompt?: string };
  last_run?: { status?: string; session_id?: string; fired_at?: string; finished_at?: string; failure_reason?: string } | null;
  [key: string]: unknown;
}

export type RoutineKind = "routine" | "reminder" | "cowork_task" | "other";

export interface RoutineRowIn {
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
  raw: Record<string, unknown>;
}

/** Run sessions come back as cse_…; Timu stores cloud sessions by their session_… id (same suffix). */
export function sessionExternalId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.startsWith("cse_") ? `session_${id.slice(4)}` : id;
}

const KINDS: RoutineKind[] = ["routine", "reminder", "cowork_task"];

function runStatus(s: string | undefined): RoutineRowIn["last_run_status"] {
  if (!s) return null;
  if (s.includes("SUCCEEDED")) return "succeeded";
  if (s.includes("FAILED") || s.includes("ERROR")) return "failed";
  if (s.includes("RUNNING") || s.includes("PENDING") || s.includes("STARTED")) return "running";
  return null;
}

export function mapRoutine(rec: RoutineRecord): RoutineRowIn {
  const kind = KINDS.includes(rec.created_kind as RoutineKind) ? (rec.created_kind as RoutineKind) : "other";
  return {
    id: rec.id,
    name: clip(rec.name?.trim() || null, 200) ?? "Untitled routine",
    kind,
    enabled: rec.enabled !== false,
    cron_expression: rec.cron_expression?.trim() || null,
    run_once_at: rec.run_once_at || null,
    // A run-once routine that already fired reports a meaningless "next" a day later.
    next_run_at: rec.enabled === false ? null : rec.next_run_at || null,
    last_fired_at: rec.last_fired_at || rec.last_run?.fired_at || null,
    last_run_status: runStatus(rec.last_run?.status),
    last_run_session: sessionExternalId(rec.last_run?.session_id),
    home_session: sessionExternalId(rec.persistent_session_id),
    ended_reason: rec.ended_reason || null,
    prompt: clip(rec.derived_state?.prompt ?? null, 2000),
    created_at: rec.created_at ?? null,
    updated_at: rec.updated_at ?? null,
    raw: { created_via: rec.created_via ?? null, suspension_reason: rec.suspension_reason ?? null, failure_reason: rec.last_run?.failure_reason ?? null },
  };
}

function isRoutine(v: unknown): v is RoutineRecord {
  return !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" && (v as { id: string }).id.startsWith("trig_");
}

/** Accepts an API page ({data: […]}), a bare array, one record, or the tool's "HTTP 200\n{…}" text. */
export function extractRoutineRecords(payload: unknown): RoutineRecord[] {
  if (typeof payload === "string") {
    const start = payload.search(/[[{]/);
    if (start < 0) return [];
    try {
      return extractRoutineRecords(JSON.parse(payload.slice(start)));
    } catch {
      return [];
    }
  }
  if (Array.isArray(payload)) return payload.filter(isRoutine);
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data.filter(isRoutine);
    if (Array.isArray(obj.triggers)) return obj.triggers.filter(isRoutine);
    if (isRoutine(obj)) return [obj];
  }
  return [];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * A cron expression in words for the common shapes ("Daily 8:54 · New York", "Weekdays 9:00",
 * "Mondays 10:30", "Every 15 min", "Hourly at :05"); anything else comes back as the raw cron.
 */
export function cronToText(expr: string | null | undefined): string | null {
  if (!expr) return null;
  let tz: string | null = null;
  let body = expr.trim();
  const m = body.match(/^CRON_TZ=(\S+)\s+(.*)$/);
  if (m) {
    tz = m[1];
    body = m[2];
  }
  const where = tz ? ` · ${tz.split("/").pop()!.replace(/_/g, " ")}` : "";
  const parts = body.split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const time = /^\d+$/.test(min) && /^\d+$/.test(hour) ? `${hour}:${min.padStart(2, "0")}` : null;
  const every = min.match(/^\*\/(\d+)$/);
  if (every && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Every ${every[1]} min${where}`;
  if (/^\d+$/.test(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*") return `Hourly at :${min.padStart(2, "0")}${where}`;
  if (!time || mon !== "*") return expr;
  if (dom === "*" && dow === "*") return `Daily ${time}${where}`;
  if (dom === "*" && (dow === "1-5" || dow === "MON-FRI")) return `Weekdays ${time}${where}`;
  const range = dow.match(/^([0-6])-([0-6])$/);
  if (dom === "*" && range) return `${DAYS[Number(range[1])]}–${DAYS[Number(range[2])]} ${time}${where}`;
  if (dom === "*" && /^[0-6](,[0-6])*$/.test(dow)) return `${dow.split(",").map((d) => `${DAY_NAMES[Number(d)]}s`).join(", ")} ${time}${where}`;
  if (/^\d+$/.test(dom) && dow === "*") return `Monthly on the ${dom}${ordinal(Number(dom))} ${time}${where}`;
  return expr;
}

function ordinal(n: number) {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

export interface RoutinesFetchConfig {
  token: string;
  apiUrl: string;
  orgUuid?: string;
  maxPages?: number;
}

/** Uses the same Claude login as cloud sessions (see claude-auth). */
export function routinesConfigFromEnv(): RoutinesFetchConfig | null {
  // Any signed-in account; importRoutinesFromApi tries each account with its own login and org.
  const token = listAccounts().map((a) => claudeTokens(a)[0]?.token).find(Boolean);
  if (!token) return null;
  return {
    token,
    apiUrl: process.env.CLAUDE_ROUTINES_API_URL || "https://api.anthropic.com/v1/code/triggers",
    // The routines API is scoped to your organisation, like Claude Code's own calls.
    orgUuid: claudeOrgUuid() ?? undefined,
  };
}

export async function fetchRoutines(cfg: RoutinesFetchConfig): Promise<RoutineRecord[]> {
  const out: RoutineRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < (cfg.maxPages ?? 10); page++) {
    const url = new URL(cfg.apiUrl);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${cfg.token}`,
      "anthropic-version": "2023-06-01",
      // The beta Claude Code's routines tool sends (not the sessions one).
      "anthropic-beta": process.env.CLAUDE_ROUTINES_BETA || "ccr-triggers-2026-01-30",
    };
    if (cfg.orgUuid) headers["x-organization-uuid"] = cfg.orgUuid;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) throw new ClaudeAuthError(`Routines API ${res.status}: ${clip(body, 200) ?? res.statusText}`, res.status);
      if (res.status === 404)
        throw new Error(
          cfg.orgUuid
            ? "Claude didn't find a routines list for this organisation. Paste them on the Scheduled page (Update routines) instead, or set CLAUDE_ROUTINES_API_URL."
            : "Timu doesn't know your Claude organisation, which the routines list needs. Sign in to Claude Code (run `claude`) or set CLAUDE_ORG_UUID.",
        );
      throw new Error(`Routines API ${res.status}: ${clip(body, 200) ?? res.statusText}`);
    }
    const json = (await res.json()) as { data?: unknown[]; next_cursor?: string | null };
    out.push(...extractRoutineRecords(json));
    if (!json.next_cursor) break;
    cursor = json.next_cursor;
  }
  return out;
}
