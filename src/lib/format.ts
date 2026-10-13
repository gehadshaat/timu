export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const SOURCE_LABEL: Record<string, string> = {
  cloud: "Claude Code · cloud",
  local: "Claude Code · local",
  claude_ai: "claude.ai chat",
};

export const KIND_LABEL: Record<string, string> = {
  respond: "Reply",
  review: "Review",
  decide: "Decide",
  unblock: "Unblock",
  run: "Run",
};

/** Friendly due-date chip text and colour. `due` is a YYYY-MM-DD date. */
export function dueLabel(due: string | null, now = new Date()): { text: string; tone: string } | null {
  if (!due) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(`${due}T00:00:00`);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { text: `${-days}d overdue`, tone: "bg-rose-100 text-rose-700" };
  if (days === 0) return { text: "today", tone: "bg-amber-100 text-amber-800" };
  if (days === 1) return { text: "tomorrow", tone: "bg-amber-50 text-amber-700" };
  return { text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), tone: "bg-zinc-100 text-zinc-600" };
}


/** One friendly line for the top of the digest. */
export function headline(d: { newAsks: unknown[]; shipped: unknown[]; stuck: unknown[]; goalsAchieved: unknown[] }): string {
  const parts: string[] = [];
  if (d.goalsAchieved.length) parts.push(`${d.goalsAchieved.length} goal${d.goalsAchieved.length === 1 ? "" : "s"} achieved 🏆`);
  if (d.shipped.length) parts.push(`${d.shipped.length} session${d.shipped.length === 1 ? "" : "s"} shipped`);
  if (d.newAsks.length) parts.push(`${d.newAsks.length} new ask${d.newAsks.length === 1 ? "" : "s"} for you`);
  if (d.stuck.length) parts.push(`${d.stuck.length} stuck`);
  return parts.length ? parts.join(" · ") : "A quiet stretch — nothing new.";
}
