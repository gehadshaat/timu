import "server-only";
import { publish } from "./live";
import { syncAll, type ActionResult } from "./ops";
import { isSetupComplete } from "./organize";

/**
 * Timu syncs by itself: local transcripts every TIMU_SYNC_INTERVAL seconds (default 60), cloud
 * sessions and routines every TIMU_CLOUD_SYNC_INTERVAL (default 300). `0` turns it off, leaving the
 * Sync sessions button. The loop starts with the server (src/instrumentation.ts) and waits for setup.
 *
 * Every sync, timed or not (the button, MCP's sync_sessions), goes through `syncNow`, so two never
 * run at once. A sync that finds nothing new writes nothing, so open pages only refresh on real
 * changes (see live.ts).
 */
export interface SyncStatus {
  /** Seconds between syncs of local transcripts; 0 = auto-sync is off. */
  every: number;
  /** Seconds between pulls of cloud sessions and routines. */
  cloudEvery: number;
  /** Whether this server process runs the timed loop (`npm run mcp` doesn't). */
  active: boolean;
  running: boolean;
  lastAt: string | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  nextAt: string | null;
}

/** Shortest interval allowed: reading what changed is cheap, but not free. */
const MIN_SECONDS = 10;
/** The first sync runs this soon after the server starts. */
const FIRST_SYNC_MS = 3000;

/** The intervals from the environment, in seconds. */
export function syncIntervals(env: Record<string, string | undefined> = process.env): { every: number; cloudEvery: number } {
  const seconds = (v: string | undefined, fallback: number) => {
    const n = v?.trim() ? Number(v) : NaN;
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n === 0 ? 0 : Math.max(MIN_SECONDS, Math.round(n));
  };
  const every = seconds(env.TIMU_SYNC_INTERVAL, 60);
  const cloud = seconds(env.TIMU_CLOUD_SYNC_INTERVAL, 300);
  return { every, cloudEvery: every === 0 || cloud === 0 ? 0 : Math.max(every, cloud) };
}

interface LoopState {
  status: SyncStatus;
  started: boolean;
  /** The sync running now (or the last one), so the next waits for it. */
  chain: Promise<unknown>;
  lastCloudAt: number;
}

const state = (): LoopState =>
  ((globalThis as { __timuSync?: LoopState }).__timuSync ??= {
    status: { ...syncIntervals(), active: false, running: false, lastAt: null, lastOk: null, lastMessage: null, nextAt: null },
    started: false,
    chain: Promise.resolve(),
    lastCloudAt: 0,
  });

export function syncStatus(): SyncStatus {
  return { ...state().status };
}

function setStatus(patch: Partial<SyncStatus>): void {
  const s = state();
  s.status = { ...s.status, ...patch };
  publish({ type: "sync", status: s.status });
}

/** Sync now, once any sync already running has finished. `cloud: false` reads local transcripts only. */
export function syncNow(opts: { cloud?: boolean } = {}): Promise<ActionResult> {
  const s = state();
  const cloud = opts.cloud ?? true;
  const next = s.chain.then(async (): Promise<ActionResult> => {
    setStatus({ running: true });
    let result: ActionResult;
    try {
      result = await syncAll({ cloud });
    } catch (err) {
      result = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    if (cloud) s.lastCloudAt = Date.now();
    setStatus({ running: false, lastAt: new Date().toISOString(), lastOk: result.ok, lastMessage: result.message });
    return result;
  });
  s.chain = next.catch(() => undefined);
  return next;
}

/** Start the timed loop (once per process). Each run waits for setup to be finished. */
export function startAutoSync(): void {
  const s = state();
  if (s.started) return;
  s.started = true;
  const { every, cloudEvery } = syncIntervals();
  setStatus({ every, cloudEvery, active: every > 0 });
  if (!every) return;

  const schedule = (ms: number) => {
    setStatus({ nextAt: new Date(Date.now() + ms).toISOString() });
    setTimeout(tick, ms).unref?.();
  };
  const tick = async () => {
    try {
      if (await isSetupComplete()) {
        const cloud = cloudEvery > 0 && Date.now() - s.lastCloudAt >= cloudEvery * 1000;
        const r = await syncNow({ cloud });
        if (!r.ok) console.warn(`[timu] sync: ${r.message}`);
      }
    } catch (err) {
      console.warn("[timu] sync failed:", err);
    } finally {
      schedule(every * 1000);
    }
  };
  schedule(FIRST_SYNC_MS);
}
