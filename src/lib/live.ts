import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { connect, db, dbPath } from "./db";

/**
 * Live updates for open pages (sent by /api/events, refreshed by components/LiveRefresh):
 *
 * - `change`: something committed to the database. A watcher connection polls SQLite's
 *   `PRAGMA data_version`, which moves whenever any *other* connection commits: this server's own
 *   or another process's, like `npm run mcp`. So every writer is covered without announcing itself.
 *   It only runs while someone is listening.
 * - `sync`: the sync status changed (a sync started or finished; see auto-sync).
 *
 * State lives on globalThis: Next can load this module more than once (instrumentation and the app
 * are bundled separately), and they must share one set of listeners.
 */
export type LiveEvent = { type: "change" } | { type: "sync"; status: unknown };
type Listener = (e: LiveEvent) => void;

/** How often the watcher asks SQLite whether anything changed. Each ask costs microseconds. */
const POLL_MS = 1000;

/** Tells when other connections have committed to a database file since the last look. */
export class DataVersionWatcher {
  private readonly conn: DatabaseSync;
  private last: number;

  constructor(file: string) {
    this.conn = connect(file);
    this.last = this.read();
  }

  private read(): number {
    return (this.conn.prepare("pragma data_version").get() as { data_version: number }).data_version;
  }

  /** True when something was committed since the previous call (or since it was made). */
  changed(): boolean {
    const v = this.read();
    if (v === this.last) return false;
    this.last = v;
    return true;
  }

  close(): void {
    this.conn.close();
  }
}

interface LiveState {
  listeners: Set<Listener>;
  watcher: DataVersionWatcher | null;
  timer: ReturnType<typeof setInterval> | null;
}

const state = (): LiveState =>
  ((globalThis as { __timuLive?: LiveState }).__timuLive ??= { listeners: new Set(), watcher: null, timer: null });

/** Tell every listener. A listener that throws (say, a closed stream) doesn't stop the others. */
export function publish(e: LiveEvent): void {
  for (const fn of state().listeners) {
    try {
      fn(e);
    } catch {
      // the stream is gone; its own cleanup unsubscribes it
    }
  }
}

/** Listen for live events; returns the unsubscribe. The first listener starts the watcher, the last stops it. */
export function subscribe(fn: Listener): () => void {
  const s = state();
  s.listeners.add(fn);
  if (!s.timer) {
    db(); // make sure the file exists and is migrated before watching it
    s.watcher = new DataVersionWatcher(dbPath());
    s.timer = setInterval(() => {
      try {
        if (s.watcher?.changed()) publish({ type: "change" });
      } catch (err) {
        console.warn("[timu] live updates: couldn't read the database:", err);
      }
    }, POLL_MS);
    s.timer.unref?.();
  }
  return () => {
    s.listeners.delete(fn);
    if (s.listeners.size || !s.timer) return;
    clearInterval(s.timer);
    s.timer = null;
    s.watcher?.close();
    s.watcher = null;
  };
}
