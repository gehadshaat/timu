import type { Verdict } from "../types";

/** What the judge sees about one session. Text fields are already clipped. */
export interface TriageInput {
  id: string;
  title: string;
  source: string;
  status: string;
  status_detail: string | null;
  needs_action: string | null;
  last_message: string | null;
  last_message_role: string | null;
  repo: string | null;
  last_activity_at?: string | null;
}

export const DEFAULT_STALE_DAYS = 30;

const SHIPPED = /\b(merged|closed|shipped|deployed|released|landed|done)\b/i;
const FOLLOW_UP =
  /\b(run|migrat\w*|untested|todo|follow[- ]?up|needs?|please|manual(ly)?|verify|check|before|approve|review|decide|confirm|credential|access|token|waiting|blocked|\?)/i;

/**
 * Deterministic cases that never need a model. Returns null when the judge should decide.
 * Kept conservative: only clear "nothing to do" outcomes are short-circuited.
 */
export function ruleVerdict(s: TriageInput, now = new Date(), staleDays = DEFAULT_STALE_DAYS): Verdict | null {
  const at = now.toISOString();
  const none = (reason: string): Verdict => ({ needed: false, kind: "none", confidence: 0.95, engine: "rules", reason, at });

  // Old sessions are still imported and searchable, but never raise an ask.
  if (staleDays > 0 && s.last_activity_at) {
    const idleDays = (now.getTime() - Date.parse(s.last_activity_at)) / 86_400_000;
    if (idleDays >= staleDays) return none(`Idle for ${Math.floor(idleDays)} days`);
  }

  if (s.status === "working" && !s.needs_action) return none("Still working on it");
  const detail = [s.status_detail, s.needs_action].filter(Boolean).join(" ");
  if ((s.status === "done" || s.status === "idle") && !s.needs_action && SHIPPED.test(detail) && !FOLLOW_UP.test(detail)) {
    return none("Shipped with no follow-ups");
  }
  if (!s.status_detail && !s.needs_action && !s.last_message) return none("Nothing to act on");
  return null;
}

/** Fallback when no model is available: trust the session's own status. */
export function statusVerdict(s: TriageInput, now = new Date()): Verdict {
  const at = now.toISOString();
  const map: Record<string, Verdict["kind"]> = { needs_you: "respond", review: "review", failed: "unblock" };
  const kind = map[s.status] ?? "none";
  return {
    needed: kind !== "none",
    kind,
    confidence: 0.6,
    engine: "status",
    reason: kind === "none" ? "Status says nothing is pending" : `Status is ${s.status.replace("_", " ")}`,
    ask: s.needs_action ?? s.status_detail,
    at,
  };
}
