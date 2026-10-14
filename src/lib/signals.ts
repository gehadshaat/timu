/**
 * Vital signs for projects, departments and companies: how many asks are waiting,
 * what's running, what shipped, and a 14-day activity sparkline. Pure functions so the
 * home page and tests share them.
 */

export type Health = "stuck" | "needs_you" | "active" | "quiet" | "dormant" | "empty";

export interface SignalSession {
  status: string;
  last_activity_at: string | null;
  started_at: string | null;
}

export interface Signals {
  sessions: number;
  asks: number;
  stuck: number;
  working: number;
  shipped7d: number;
  lastActive: string | null;
  /** Average progress (0..1) of active goals, or null when there are none. */
  goalProgress: number | null;
  goals: number;
  people: number;
  /** Activity per day, oldest first, `SPARK_DAYS` long. */
  spark: number[];
  health: Health;
}

export const SPARK_DAYS = 14;
const DAY = 86_400_000;
/** Failed sessions older than this don't make a project look stuck. */
const STUCK_WINDOW_DAYS = 30;

export const HEALTH_RANK: Record<Health, number> = { stuck: 0, needs_you: 1, active: 2, quiet: 3, dormant: 4, empty: 5 };

export const HEALTH_LABEL: Record<Health, string> = {
  stuck: "Stuck",
  needs_you: "Needs you",
  active: "Active",
  quiet: "Quiet",
  dormant: "Dormant",
  empty: "No sessions yet",
};

/** Local midnight at the start of `now`'s day. */
function startOfDay(now: number): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

/**
 * Which sparkline bucket (0 = oldest, SPARK_DAYS-1 = today) a time falls in, or null if older.
 * `today` is startOfDay(now), worked out once per computeSignals.
 */
function dayIndex(t: number, today: number): number | null {
  if (Number.isNaN(t)) return null;
  // Older than the sparkline by more than a day (DST can't make up a day): skip the date maths.
  if (t < today - (SPARK_DAYS + 1) * DAY) return null;
  const day = new Date(t);
  day.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((today - day.getTime()) / DAY);
  if (daysAgo < 0) return SPARK_DAYS - 1; // clock skew: count as today
  if (daysAgo >= SPARK_DAYS) return null;
  return SPARK_DAYS - 1 - daysAgo;
}

export function healthOf(s: Pick<Signals, "sessions" | "asks" | "stuck" | "working" | "lastActive">, now = Date.now()): Health {
  if (s.stuck > 0) return "stuck";
  if (s.asks > 0) return "needs_you";
  if (!s.sessions) return "empty";
  const idle = s.lastActive ? (now - Date.parse(s.lastActive)) / DAY : Infinity;
  if (s.working > 0 || idle <= 2) return "active";
  if (idle <= 14) return "quiet";
  return "dormant";
}

export function computeSignals(
  input: { sessions: SignalSession[]; asks: number; goals?: { status: string; progress: number }[]; people?: number },
  now = Date.now(),
): Signals {
  const spark = new Array<number>(SPARK_DAYS).fill(0);
  let stuck = 0;
  let working = 0;
  let shipped7d = 0;
  let lastActive: string | null = null;
  const today = startOfDay(now);

  for (const s of input.sessions) {
    const last = s.last_activity_at ? Date.parse(s.last_activity_at) : NaN;
    if (s.status === "working") working++;
    if (s.status === "failed" && !Number.isNaN(last) && now - last <= STUCK_WINDOW_DAYS * DAY) stuck++;
    if (s.status === "done" && !Number.isNaN(last) && now - last <= 7 * DAY) shipped7d++;
    if (s.last_activity_at && (!lastActive || s.last_activity_at > lastActive)) lastActive = s.last_activity_at;
    // Each session counts once per day it was started or active.
    const active = dayIndex(last, today);
    const started = dayIndex(s.started_at ? Date.parse(s.started_at) : NaN, today);
    if (active !== null) spark[active]++;
    if (started !== null && started !== active) spark[started]++;
  }

  const active = (input.goals ?? []).filter((g) => g.status === "active");
  const goalProgress = active.length ? active.reduce((n, g) => n + g.progress, 0) / active.length : null;
  const base = { sessions: input.sessions.length, asks: input.asks, stuck, working, lastActive };
  return {
    ...base,
    shipped7d,
    goalProgress,
    goals: active.length,
    people: input.people ?? 0,
    spark,
    health: healthOf(base, now),
  };
}

/** Roll several signals up (a department or a company). */
export function sumSignals(list: Signals[], now = Date.now()): Signals {
  const spark = new Array<number>(SPARK_DAYS).fill(0);
  let lastActive: string | null = null;
  let goalSum = 0;
  let goalCount = 0;
  const totals = { sessions: 0, asks: 0, stuck: 0, working: 0, shipped7d: 0, goals: 0, people: 0 };
  for (const s of list) {
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += s[k];
    s.spark.forEach((v, i) => (spark[i] += v));
    if (s.lastActive && (!lastActive || s.lastActive > lastActive)) lastActive = s.lastActive;
    if (s.goalProgress !== null) {
      goalSum += s.goalProgress * s.goals;
      goalCount += s.goals;
    }
  }
  const base = { sessions: totals.sessions, asks: totals.asks, stuck: totals.stuck, working: totals.working, lastActive };
  return { ...totals, lastActive, spark, goalProgress: goalCount ? goalSum / goalCount : null, health: healthOf(base, now) };
}

// ---------- departments ----------

/**
 * A department is the same kind of team across a company's projects: "Marketing" in
 * Sunbeam Web and "Marketing" in Sunbeam Device are one Marketing department.
 */
export function departmentKey(teamName: string): string {
  return (
    teamName
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w && !["team", "teams", "dept", "department", "the", "squad", "group"].includes(w))
      .join(" ") || teamName.toLowerCase().trim()
  );
}

export interface Department<T extends { id: string; name: string; project_id: string }> {
  key: string;
  name: string;
  teams: T[];
  projectIds: string[];
}

export function groupDepartments<T extends { id: string; name: string; project_id: string }>(teams: T[]): Department<T>[] {
  const map = new Map<string, Department<T>>();
  for (const t of teams) {
    const key = departmentKey(t.name);
    const d = map.get(key) ?? { key, name: t.name, teams: [], projectIds: [] };
    d.teams.push(t);
    if (!d.projectIds.includes(t.project_id)) d.projectIds.push(t.project_id);
    // Prefer the shortest spelling as the department's display name ("Marketing" over "Marketing Team").
    if (t.name.length < d.name.length) d.name = t.name;
    map.set(key, d);
  }
  return [...map.values()].sort((a, b) => b.teams.length - a.teams.length || a.name.localeCompare(b.name));
}

/** Big companies get a departments view on the home page; small ones just list projects. */
export function isBigCompany(projectCount: number, teamCount: number): boolean {
  return projectCount >= 3 || teamCount >= 5;
}
