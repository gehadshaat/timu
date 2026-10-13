import type { NormalizedSession, SessionStatus } from "../types";
import { listAccounts } from "../claude-accounts";
import { ClaudeAuthError, claudeTokens } from "../claude-auth";
import { clip, repoFromUrl } from "../text";
import { extractArtifactLinks } from "./artifacts";

/**
 * Claude Code cloud sessions (claude.ai/code).
 *
 * There is no documented public API for listing these. Timu calls the sessions
 * endpoint the Claude Code CLI uses (configurable via CLAUDE_SESSIONS_API_URL),
 * and also accepts a pasted JSON dump of the same records, so the importer keeps
 * working if that endpoint changes.
 */

export interface CloudSessionRecord {
  id: string;
  title?: string;
  session_status?: string;
  status_bucket?: string;
  created_at?: string;
  updated_at?: string;
  task_summary?: string;
  unread?: boolean;
  session_context?: {
    sources?: { git_repository?: { url?: string; revision?: string } }[];
    outcomes?: { git_repository?: { git_info?: { repo?: string; branches?: string[] } } }[];
    model?: string;
  };
  post_turn_summary?: { status_category?: string; status_detail?: string; recent_action?: string; needs_action?: string };
  external_metadata?: {
    post_turn_summary?: { status_category?: string; status_detail?: string; recent_action?: string; needs_action?: string };
    task_summary?: string;
    current_branches?: Record<string, string>;
  };
  [key: string]: unknown;
}

const BUCKET_TO_STATUS: Record<string, SessionStatus> = {
  SESSION_STATUS_BUCKET_WORKING: "working",
  SESSION_STATUS_BUCKET_BLOCKED: "needs_you",
  SESSION_STATUS_BUCKET_REVIEW_READY: "review",
  SESSION_STATUS_BUCKET_COMPLETED: "done",
  SESSION_STATUS_BUCKET_FAILED: "failed",
};

export function mapCloudSession(rec: CloudSessionRecord): NormalizedSession {
  const pts = rec.post_turn_summary ?? rec.external_metadata?.post_turn_summary;
  const needsAction = pts?.needs_action?.trim() || null;

  let status: SessionStatus =
    (rec.status_bucket && BUCKET_TO_STATUS[rec.status_bucket]) ||
    (rec.session_status === "SESSION_STATUS_RUNNING" ? "working" : "idle");
  const canAsk = status !== "working" && status !== "failed";
  if (needsAction && canAsk) status = "needs_you";
  if (pts?.status_category === "blocked" && canAsk) status = "needs_you";

  const source = rec.session_context?.sources?.[0]?.git_repository;
  const outcome = rec.session_context?.outcomes?.[0]?.git_repository?.git_info;
  const branch =
    outcome?.branches?.[0] ?? Object.values(rec.external_metadata?.current_branches ?? {})[0] ?? null;

  const detailParts = [needsAction, pts?.status_detail, pts?.recent_action, rec.task_summary ?? rec.external_metadata?.task_summary];
  const statusDetail = clip(detailParts.find((p) => p && p.trim()) ?? null, 400);

  return {
    source: "cloud",
    externalId: rec.id,
    title: clip(rec.title, 200) ?? "Untitled cloud session",
    url: `https://claude.ai/code/${rec.id}`,
    repo: outcome?.repo ?? repoFromUrl(source?.url),
    branch,
    status,
    statusDetail,
    firstUserMessage: null,
    lastMessage: clip(pts?.recent_action ?? null, 2000),
    lastMessageRole: pts?.recent_action ? "assistant" : null,
    messageCount: 0,
    startedAt: rec.created_at ?? null,
    lastActivityAt: rec.updated_at ?? rec.created_at ?? null,
    raw: {
      session_status: rec.session_status,
      status_bucket: rec.status_bucket,
      post_turn_summary: pts ?? null,
      needs_action: needsAction,
      model: rec.session_context?.model,
      unread: rec.unread ?? false,
      artifacts: extractArtifactLinks([pts?.recent_action, pts?.status_detail, rec.task_summary, rec.external_metadata?.task_summary].filter(Boolean).join("\n")),
    },
  };
}

/** Accepts the API page shape, a bare array, or the `{ccr: {...}}` wrapper the MCP tool returns. */
export function extractCloudRecords(payload: unknown): CloudSessionRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (obj.ccr) return extractCloudRecords(obj.ccr);
    if (Array.isArray(obj.data)) return obj.data.filter(isRecord);
    if (Array.isArray(obj.sessions)) return obj.sessions.filter(isRecord);
    if (isRecord(obj)) return [obj];
  }
  return [];
}

function isRecord(v: unknown): v is CloudSessionRecord {
  return !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" &&
    (v as { id: string }).id.startsWith("session_");
}

export interface CloudFetchConfig {
  token: string;
  apiUrl: string;
  orgUuid?: string;
  maxPages?: number;
}

/** The pull's settings; `token` is the first login to try (see claude-auth for the fallbacks). */
export function cloudConfigFromEnv(): CloudFetchConfig | null {
  // Any signed-in account will do here; importers try each account with its own login.
  const token = listAccounts().map((a) => claudeTokens(a)[0]?.token).find(Boolean);
  if (!token) return null;
  return {
    token,
    apiUrl: process.env.CLAUDE_SESSIONS_API_URL || "https://api.anthropic.com/v1/sessions",
    orgUuid: process.env.CLAUDE_ORG_UUID || undefined,
  };
}

export async function fetchCloudSessions(cfg: CloudFetchConfig): Promise<CloudSessionRecord[]> {
  const out: CloudSessionRecord[] = [];
  let afterId: string | undefined;
  for (let page = 0; page < (cfg.maxPages ?? 20); page++) {
    const url = new URL(cfg.apiUrl);
    url.searchParams.set("limit", "100");
    if (afterId) url.searchParams.set("after_id", afterId);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${cfg.token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "ccr-byoc-2025-07-29",
      "Content-Type": "application/json",
    };
    if (cfg.orgUuid) headers["x-organization-uuid"] = cfg.orgUuid;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) throw new ClaudeAuthError(`Cloud sessions API returned ${res.status}: ${body.slice(0, 300)}`, res.status);
      throw new Error(`Cloud sessions API returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: unknown[]; has_more?: boolean; last_id?: string };
    out.push(...extractCloudRecords(json));
    if (!json.has_more || !json.last_id) break;
    afterId = json.last_id;
  }
  return out;
}
