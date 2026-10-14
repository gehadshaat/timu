import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syncIntervals } from "./auto-sync";
import { loadDigests, REFILE_QUIET_MS } from "./classify/apply";
import { all, get, getSetting, insert, openDatabase, run, scalar, useDatabase } from "./db";
import { ingestSessions, judgeDueSessions } from "./ingest";
import { DataVersionWatcher } from "./live";
import { startOrganize } from "./organize";
import { transcriptsToRead } from "./sources/local-scan";
import { judgeAfter, TRIAGE_SETTLE_MS } from "./triage";
import type { NormalizedSession } from "./types";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
/** Fixed times, so a re-import carries exactly the same activity. */
const AN_HOUR_AGO = ago(60 * 60_000);
const TWO_HOURS_AGO = ago(2 * 3600_000);
const THREE_HOURS_AGO = ago(3 * 3600_000);
/** Rows inserted, updated or deleted on this connection so far. */
const writes = () => scalar<number>("select total_changes()");

const session = (externalId: string, over: Partial<NormalizedSession> = {}): NormalizedSession => ({
  source: "cloud",
  externalId,
  title: "Sunbeam Web: fix the pricing page",
  url: null,
  repo: "sunbeam-web",
  branch: "main",
  status: "idle",
  statusDetail: null,
  firstUserMessage: "Fix the pricing page layout",
  lastMessage: "Done: the pricing page is fixed and deployed.",
  lastMessageRole: "assistant",
  messageCount: 4,
  startedAt: THREE_HOURS_AGO,
  lastActivityAt: TWO_HOURS_AGO,
  raw: { needs_action: null },
  ...over,
});

describe("reading only the transcripts that changed", () => {
  const old = Date.now() - 3600_000;
  const files = [
    { path: "/p/a.jsonl", mtimeMs: old, size: 100 },
    { path: "/p/b.jsonl", mtimeMs: old, size: 200 },
    { path: "/p/c.jsonl", mtimeMs: Date.now() - 30_000, size: 300 },
  ];

  it("reads new and changed files, and recent ones whose 'working' status depends on the clock", () => {
    const seen = new Map([
      ["/p/a.jsonl", `${old}:100`],
      ["/p/b.jsonl", `${old}:150`], // grew since
      ["/p/c.jsonl", `${files[2].mtimeMs}:300`],
    ]);
    expect(transcriptsToRead(files, seen).map((f) => f.path)).toEqual(["/p/b.jsonl", "/p/c.jsonl"]);
    expect(transcriptsToRead(files, new Map()).map((f) => f.path)).toEqual(["/p/a.jsonl", "/p/b.jsonl", "/p/c.jsonl"]);
  });
});

describe("when to judge a session", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    title: "Duckworks: supplier list",
    source: "local",
    status: "needs_you",
    status_detail: "Should I email the suppliers now?",
    needs_action: null,
    last_message: "Should I email the suppliers now?",
    last_message_role: "assistant",
    repo: "procurement-app",
    last_activity_at: ago(20_000),
    ...over,
  });

  it("waits for a pause when a model would decide about a session active moments ago", () => {
    const now = new Date();
    const due = judgeAfter(input(), "claude", now);
    expect(due).not.toBeNull();
    expect(Date.parse(due!)).toBeGreaterThan(now.getTime());
    expect(Date.parse(due!)).toBeLessThanOrEqual(now.getTime() + TRIAGE_SETTLE_MS);
  });

  it("judges now when it's free or settled: the status engine, a rule that decides, or a quiet session", () => {
    expect(judgeAfter(input(), "status")).toBeNull();
    expect(judgeAfter(input({ status: "working" }), "claude")).toBeNull(); // the rules say "still working"
    expect(judgeAfter(input({ last_activity_at: ago(TRIAGE_SETTLE_MS + 1000) }), "typesafe")).toBeNull();
    expect(judgeAfter(input({ last_activity_at: null }), "claude")).toBeNull();
  });
});

describe("a sync that finds nothing new changes nothing", () => {
  beforeAll(() => {
    process.env.TIMU_TRIAGE_ENGINE = "status";
    useDatabase(openDatabase(":memory:"));
  });
  afterAll(() => {
    delete process.env.TIMU_TRIAGE_ENGINE;
    useDatabase(null);
  });

  it("skips unchanged sessions and doesn't record the run", async () => {
    const batch = [session("session_01SUN"), session("session_02SUN", { title: "Sunbeam Device: battery test", status: "needs_you", statusDetail: "Which battery should I test first?" })];
    expect(await ingestSessions("cloud", batch, "claude")).toMatchObject({ imported: 2, updated: 0, tasksOpened: 1 });
    expect(scalar("select count(*) from import_runs")).toBe(1);

    const before = writes();
    expect(await ingestSessions("cloud", batch, "claude")).toMatchObject({ imported: 0, updated: 0, tasksOpened: 0 });
    expect(writes()).toBe(before);
    expect(scalar("select count(*) from import_runs")).toBe(1);
  });

  it("writes only the session that changed, and records that run", async () => {
    const r = await ingestSessions("cloud", [session("session_01SUN", { messageCount: 6, lastActivityAt: AN_HOUR_AGO }), session("session_02SUN", { title: "Sunbeam Device: battery test", status: "needs_you", statusDetail: "Which battery should I test first?" })], "claude");
    expect(r).toMatchObject({ imported: 0, updated: 1 });
    expect(get<{ imported: number; updated: number }>("select imported, updated from import_runs order by started_at desc limit 1")).toEqual({ imported: 0, updated: 1 });
  });

  it("keeps a title you renamed without rewriting the row", async () => {
    run("update sessions set title = 'Pricing page', title_locked = 1 where external_id = 'session_01SUN'");
    const before = writes();
    await ingestSessions("cloud", [session("session_01SUN", { messageCount: 6, lastActivityAt: AN_HOUR_AGO })], "claude");
    expect(writes()).toBe(before);
    expect(scalar("select title from sessions where external_id = 'session_01SUN'")).toBe("Pricing page");
  });

  it("an incremental organiser run with nothing to file leaves its job alone", async () => {
    run("update sessions set classified_at = '2026-01-01T00:00:00Z'");
    const job = getSetting("organize_job");
    const before = writes();
    await startOrganize("incremental");
    expect(writes()).toBe(before);
    expect(getSetting("organize_job")).toEqual(job);
  });
});

describe("judging sessions once they've paused", () => {
  beforeAll(() => {
    process.env.TIMU_TRIAGE_ENGINE = "status";
    useDatabase(openDatabase(":memory:"));
  });
  afterAll(() => {
    delete process.env.TIMU_TRIAGE_ENGINE;
    useDatabase(null);
  });

  it("judges the due ones, opens their asks and clears the due time; later ones wait", async () => {
    insert("sessions", [
      { source: "local", external_id: "kai-due", title: "Kai: release notes", status: "needs_you", status_detail: "Ship the notes today?", last_activity_at: ago(5 * 60_000), triage_due_at: ago(60_000) },
      { source: "local", external_id: "kai-later", title: "Kai: changelog", status: "needs_you", status_detail: "Which version?", last_activity_at: ago(30_000), triage_due_at: new Date(Date.now() + 90_000).toISOString() },
    ]);
    expect(await judgeDueSessions()).toBe(1);
    const rows = all<{ external_id: string; triage_due_at: string | null; triage: unknown }>("select external_id, triage_due_at, triage from sessions order by external_id");
    expect(rows.map((r) => [r.external_id, !!r.triage_due_at, !!r.triage])).toEqual([
      ["kai-due", false, true],
      ["kai-later", true, false],
    ]);
    expect(scalar("select count(*) from tasks where status = 'open'")).toBe(1);
    expect(await judgeDueSessions()).toBe(0);
  });
});

describe("the organiser re-files a session you're working in once it's quiet", () => {
  beforeAll(() => useDatabase(openDatabase(":memory:")));
  afterAll(() => useDatabase(null));

  it("files unfiled sessions at once, and waits REFILE_QUIET_MS for filed ones with new activity", async () => {
    const [company] = insert<{ id: string }>("companies", { slug: "sunbeam", name: "Sunbeam Co" });
    const [project] = insert<{ id: string }>("projects", { slug: "sunbeam-web", name: "Sunbeam Web", company_id: company.id });
    const [team] = insert<{ id: string }>("teams", { project_id: project.id, name: "Growth" });
    const [maya] = insert<{ id: string }>("agents", { team_id: team.id, name: "Maya", role: "SEO" });
    insert("sessions", [
      { source: "local", external_id: "new", title: "New", last_activity_at: ago(10_000) },
      { source: "local", external_id: "busy", title: "Busy", agent_id: maya.id, last_activity_at: ago(60_000) },
      { source: "local", external_id: "quiet", title: "Quiet", agent_id: maya.id, last_activity_at: ago(REFILE_QUIET_MS + 60_000) },
      { source: "local", external_id: "filed", title: "Filed", agent_id: maya.id, classified_at: ago(0), last_activity_at: ago(REFILE_QUIET_MS + 60_000) },
    ]);
    expect((await loadDigests(true)).map((d) => d.title).sort()).toEqual(["New", "Quiet"]);
    expect(await loadDigests(false)).toHaveLength(4);
  });
});

describe("noticing database changes from any connection", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "timu-live-"));
  const file = path.join(dir, "live.db");
  let writer: DatabaseSync;
  let watcher: DataVersionWatcher;

  beforeEach(() => {
    writer ??= openDatabase(file);
    watcher ??= new DataVersionWatcher(file);
  });
  afterAll(() => {
    watcher.close();
    writer.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports a commit once, and nothing when nothing was committed", () => {
    expect(watcher.changed()).toBe(false);
    writer.prepare("insert into settings (key, value, updated_at) values ('k', '1', 'now')").run();
    expect(watcher.changed()).toBe(true);
    expect(watcher.changed()).toBe(false);
    // A write transaction that changes no rows commits nothing.
    writer.exec("begin immediate; delete from settings where key = 'missing'; commit;");
    expect(watcher.changed()).toBe(false);
  });
});

describe("sync intervals", () => {
  it("defaults to every minute, cloud every five; 0 turns it off; too-short values are raised", () => {
    expect(syncIntervals({})).toEqual({ every: 60, cloudEvery: 300 });
    expect(syncIntervals({ TIMU_SYNC_INTERVAL: "0" })).toEqual({ every: 0, cloudEvery: 0 });
    expect(syncIntervals({ TIMU_SYNC_INTERVAL: "2" })).toEqual({ every: 10, cloudEvery: 300 });
    expect(syncIntervals({ TIMU_SYNC_INTERVAL: "600", TIMU_CLOUD_SYNC_INTERVAL: "120" })).toEqual({ every: 600, cloudEvery: 600 });
    expect(syncIntervals({ TIMU_CLOUD_SYNC_INTERVAL: "0" })).toEqual({ every: 60, cloudEvery: 0 });
    expect(syncIntervals({ TIMU_SYNC_INTERVAL: "soon" })).toEqual({ every: 60, cloudEvery: 300 });
  });
});
