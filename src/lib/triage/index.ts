import "server-only";
import { getSetting, setSetting } from "../db";
import { hasClaude } from "../claude-cli";
import type { Verdict } from "../types";
import { claudeJudge } from "./claude";
import { DEFAULT_MEMORY, MEMORY_KEY, type MemoryItem } from "./memory";
import { DEFAULT_STALE_DAYS, ruleVerdict, statusVerdict, type TriageInput } from "./rules";
import { typesafeConfigured, typesafeJudge } from "./typesafe";

export type { TriageInput } from "./rules";

export async function getMemory(): Promise<MemoryItem[]> {
  return (await getSetting<MemoryItem[]>(MEMORY_KEY)) ?? DEFAULT_MEMORY;
}

export async function saveMemory(items: MemoryItem[]): Promise<void> {
  await setSetting(MEMORY_KEY, items);
}

export const STALE_KEY = "triage_stale_days";

/** Sessions idle at least this many days never raise an ask (0 = off). */
export async function getStaleDays(): Promise<number> {
  const v = await getSetting<number>(STALE_KEY);
  return typeof v === "number" && v >= 0 ? v : DEFAULT_STALE_DAYS;
}

export type Engine = "typesafe" | "claude" | "status";

/** Which model decides: TIMU_TRIAGE_ENGINE if set, else TypeSafe, then Claude Haiku, then the session's own status. */
export function triageEngine(): Engine {
  const forced = process.env.TIMU_TRIAGE_ENGINE as Engine | undefined;
  if (forced === "typesafe" && typesafeConfigured()) return "typesafe";
  if (forced === "claude" && hasClaude()) return "claude";
  if (forced === "status") return "status";
  if (typesafeConfigured()) return "typesafe";
  if (hasClaude()) return "claude";
  return "status";
}

const clip = (t: string | null, n = 600) => (t && t.length > n ? `${t.slice(0, n)}…` : t);

/** A session active within this long is judged by a model only once it has been quiet this long. */
export const TRIAGE_SETTLE_MS = 2 * 60_000;

/**
 * When a session's judgement should wait, or null to judge it now. It waits only when a model would
 * decide (the rules can't, and the engine isn't the free status one) and it was active moments ago,
 * say in the middle of a conversation you're having with it. Then the judge runs once, when it
 * pauses, instead of on every sync.
 */
export function judgeAfter(s: TriageInput, engine: Engine, now = new Date(), staleDays = DEFAULT_STALE_DAYS): string | null {
  if (engine === "status" || !s.last_activity_at) return null;
  const last = Date.parse(s.last_activity_at);
  if (!(now.getTime() - last < TRIAGE_SETTLE_MS)) return null;
  if (ruleVerdict(s, now, staleDays)) return null;
  return new Date(Math.min(last, now.getTime()) + TRIAGE_SETTLE_MS).toISOString();
}

/**
 * judgeSessions for sessions with new activity, except the ones that should wait (see judgeAfter):
 * those come back in `deferred` with the time they're due, for judgeDueSessions in src/lib/ingest.ts.
 */
export async function judgeOrDefer(raw: TriageInput[], now = new Date()): Promise<{ verdicts: Map<string, Verdict>; deferred: Map<string, string> }> {
  const deferred = new Map<string, string>();
  if (!raw.length) return { verdicts: new Map(), deferred };
  const engine = triageEngine();
  const staleDays = await getStaleDays();
  for (const s of raw) {
    const at = judgeAfter(s, engine, now, staleDays);
    if (at) deferred.set(s.id, at);
  }
  return { verdicts: await judgeSessions(raw.filter((s) => !deferred.has(s.id))), deferred };
}

/**
 * Decide, per session, whether it genuinely needs the user. Rules settle the obvious cases;
 * the model decides the rest; if the model fails, fall back to the session's status.
 */
export async function judgeSessions(raw: TriageInput[]): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  if (!raw.length) return out;
  const inputs = raw.map((s) => ({ ...s, status_detail: clip(s.status_detail), last_message: clip(s.last_message), needs_action: clip(s.needs_action) }));
  const [memoryItems, staleDays] = await Promise.all([getMemory(), getStaleDays()]);
  const memory = memoryItems.map((m) => m.text);

  const pending: TriageInput[] = [];
  for (const s of inputs) {
    const rule = ruleVerdict(s, new Date(), staleDays);
    if (rule) out.set(s.id, rule);
    else pending.push(s);
  }
  if (!pending.length) return out;

  const engine = triageEngine();
  try {
    if (engine === "typesafe") {
      // One small call per session, a few at a time.
      for (let i = 0; i < pending.length; i += 5) {
        const chunk = pending.slice(i, i + 5);
        const verdicts = await Promise.all(chunk.map((s) => typesafeJudge(s, memory).catch(() => statusVerdict(s))));
        chunk.forEach((s, j) => out.set(s.id, verdicts[j]));
      }
    } else if (engine === "claude") {
      const verdicts = await claudeJudge(pending, memory);
      for (const s of pending) out.set(s.id, verdicts.get(s.id) ?? statusVerdict(s));
    } else {
      for (const s of pending) out.set(s.id, statusVerdict(s));
    }
  } catch (err) {
    console.warn("[triage] judge failed, falling back to status:", err);
    for (const s of pending) if (!out.has(s.id)) out.set(s.id, statusVerdict(s));
  }
  return out;
}
