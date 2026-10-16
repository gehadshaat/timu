import type { ClickUpStatus } from "./client";

/**
 * What a mirrored task's status means in Timu. ClickUp's API can't create statuses, so each list's own
 * statuses are matched by name (add statuses called "idle", "working", "needs you", "review", "done" and
 * "failed" to the Timu Space for an exact fit), and otherwise by type: open, in progress, closed.
 */
export type StatusIntent = "idle" | "working" | "needs_you" | "review" | "done" | "failed" | "snoozed" | "dropped";

/** Names that fit each intent, best first. Compared case-insensitively, `_`/`-` read as spaces. */
const NAMES: Record<StatusIntent, string[]> = {
  idle: ["idle", "to do", "todo", "open", "backlog", "not started"],
  working: ["working", "in progress", "doing", "active", "running"],
  needs_you: ["needs you", "needs me", "needs input", "waiting on me", "waiting on you", "waiting", "blocked"],
  review: ["review", "in review", "needs review", "ready for review", "to review"],
  done: ["done", "complete", "completed", "closed", "finished"],
  failed: ["failed", "error", "blocked"],
  snoozed: ["snoozed", "on hold", "later", "waiting"],
  dropped: ["dropped", "cancelled", "canceled", "won't do", "wont do"],
};

/** When no name fits: the first status of these types, in order. "custom" is ClickUp's in-between type. */
const BY_TYPE: Record<StatusIntent, string[]> = {
  idle: ["open"],
  working: ["custom", "open"],
  needs_you: ["open"],
  review: ["open"],
  done: ["done", "closed"],
  failed: ["open"],
  snoozed: ["open"],
  dropped: ["closed", "done"],
};

/** The statuses to add to the Timu Space for an exact fit, with the type each should be. */
export const SUGGESTED_STATUSES: { name: string; type: "open" | "custom" | "closed" }[] = [
  { name: "idle", type: "open" },
  { name: "working", type: "custom" },
  { name: "needs you", type: "custom" },
  { name: "review", type: "custom" },
  { name: "failed", type: "custom" },
  { name: "done", type: "closed" },
];

const norm = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/** The ClickUp status (its exact name) for an intent among a list's statuses, or null if the list has none. */
export function pickStatus(intent: StatusIntent, statuses: ClickUpStatus[]): string | null {
  if (!statuses.length) return null;
  const byName = new Map(statuses.map((s) => [norm(s.status), s.status]));
  for (const name of NAMES[intent]) {
    const hit = byName.get(name);
    if (hit) return hit;
  }
  const ordered = [...statuses].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0));
  for (const type of BY_TYPE[intent]) {
    const hit = ordered.find((s) => s.type === type);
    if (hit) return hit.status;
  }
  return null;
}
