import "server-only";
import { fileArtifacts, linkSessionArtifacts } from "./artifacts";
import { all, insert, get, now, update } from "./db";
import { deriveTask, verdictToDraft } from "./tasks";
import { judgeOrDefer, judgeSessions, type TriageInput } from "./triage";
import type { NormalizedSession, SessionSource, Verdict } from "./types";

/** Sessions are saved and judged this many at a time. */
const CHUNK = 100;

export interface IngestResult {
  imported: number;
  updated: number;
  tasksOpened: number;
  /** Things worth saying alongside the counts, e.g. one Claude account that couldn't be reached. */
  notes?: string[];
}

/** The columns an import writes; a session whose values all match is left alone. */
const IMPORTED = [
  "title",
  "url",
  "repo",
  "branch",
  "status",
  "status_detail",
  "first_user_message",
  "last_message",
  "last_message_role",
  "message_count",
  "started_at",
  "last_activity_at",
  "raw",
  "account",
] as const;
type Imported = Record<(typeof IMPORTED)[number], unknown>;
type Existing = Imported & { id: string; external_id: string; title_locked: boolean; archived: boolean };

const same = (a: unknown, b: unknown) =>
  (a ?? null) === (b ?? null) || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));

const triageInput = (id: string, s: Pick<NormalizedSession, "title" | "status" | "statusDetail" | "lastMessage" | "lastMessageRole" | "repo" | "lastActivityAt" | "raw">, source: string): TriageInput => ({
  id,
  title: s.title,
  source,
  status: s.status,
  status_detail: s.statusDetail,
  needs_action: (s.raw.needs_action as string | null | undefined) ?? null,
  last_message: s.lastMessage,
  last_message_role: s.lastMessageRole,
  repo: s.repo,
  last_activity_at: s.lastActivityAt,
});

/**
 * Upsert sessions from any source and keep the task inbox in sync with their state.
 * Classification (project / team / agent) is left untouched on update.
 *
 * A session that hasn't changed isn't written at all, and the import is recorded (import_runs) only
 * when something changed or it failed. Syncs run every minute, and open pages refresh whenever the
 * database changes, so a sync that finds nothing new must change nothing.
 *
 * `account` is the Claude account they came from (see claude-accounts); kept as is when omitted.
 */
export async function ingestSessions(source: SessionSource, sessions: NormalizedSession[], account?: string): Promise<IngestResult> {
  const startedAt = now();
  try {
    const result: IngestResult = { imported: 0, updated: 0, tasksOpened: 0 };
    // Dedupe on external id (the extension can send the same chat twice in one batch).
    const unique = [...new Map(sessions.map((s) => [s.externalId, s])).values()];

    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const existing = all<Existing>(
        `select id, external_id, title_locked, archived, ${IMPORTED.join(", ")} from sessions where source = ? and external_id in (select value from json_each(?))`,
        source,
        chunk.map((s) => s.externalId),
      );
      const known = new Map(existing.map((e) => [e.external_id, e]));

      const rows = chunk
        .map((s) => {
          const prev = known.get(s.externalId);
          const values: Imported = {
            // A title you renamed in Timu survives re-imports.
            title: prev?.title_locked ? prev.title : s.title,
            url: s.url,
            repo: s.repo,
            branch: s.branch,
            status: s.status,
            status_detail: s.statusDetail,
            first_user_message: s.firstUserMessage,
            last_message: s.lastMessage,
            last_message_role: s.lastMessageRole,
            message_count: s.messageCount,
            started_at: s.startedAt,
            last_activity_at: s.lastActivityAt,
            raw: s.raw,
            account: account ?? prev?.account,
          };
          return { s, prev, values };
        })
        .filter(({ prev, values }) => !prev || IMPORTED.some((c) => !same(prev[c], values[c])));
      if (!rows.length) continue;

      const saved = insert<{ id: string; external_id: string }>(
        "sessions",
        rows.map(({ s, values }) => ({ source, external_id: s.externalId, ...values, updated_at: now() })),
        { on: "source, external_id", do: "update" },
      );

      const changes = saved.map((row) => {
        const { s, prev } = rows.find((r) => r.s.externalId === row.external_id)!;
        return { id: row.id, s, prev, archived: !!prev?.archived, activityChanged: !prev || prev.last_activity_at !== s.lastActivityAt };
      });

      // Triage: does each session with new activity genuinely need you? (rules, then a cheap model.)
      // One you were active in moments ago waits until it has been quiet (see judgeDueSessions).
      const { verdicts, deferred } = await judgeOrDefer(changes.filter((c) => c.activityChanged && !c.archived).map((c) => triageInput(c.id, c.s, source)));

      for (const c of changes) {
        if (c.prev) result.updated++;
        else result.imported++;
        const due = deferred.get(c.id);
        const verdict = verdicts.get(c.id) ?? null;
        if (c.activityChanged) {
          // New activity: store the verdict (or when it's due) and let the organiser look at the session
          // again, and drop any status you set by hand: the session has moved on.
          update(
            "sessions",
            { triage: verdict, triage_due_at: due ?? null, status_override: null, ...(c.prev && !c.archived ? { classified_at: null } : {}) },
            "id = ?",
            c.id,
          );
        }
        // A session waiting to be judged keeps its ask as it is until then.
        if (!due && (await syncTask(c.id, c.s, c.activityChanged, verdict, c.archived))) result.tasksOpened++;
      }
      // Artifacts these sessions link to (see sources/artifacts); filed after the organiser places the sessions.
      // An empty list counts too: it clears links a session no longer claims. Sources that don't
      // report artifacts (no list at all) leave their sessions' links alone.
      linkSessionArtifacts(
        changes
          .filter((c) => Array.isArray(c.s.raw.artifacts))
          .map((c) => ({ sessionId: c.id, artifacts: c.s.raw.artifacts as { id: string; url: string; title?: string | null }[] })),
      );
    }
    fileArtifacts();

    if (result.imported || result.updated) {
      insert("import_runs", { source, started_at: startedAt, finished_at: now(), imported: result.imported, updated: result.updated });
    }
    return result;
  } catch (err) {
    insert("import_runs", { source, started_at: startedAt, finished_at: now(), error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Judge the sessions whose triage was put off while they were active (see judgeOrDefer) and have
 * been quiet since, and open, update or close their asks to match. Every sync runs this.
 * Returns how many asks it opened.
 */
export async function judgeDueSessions(at = new Date()): Promise<number> {
  const due = all<{
    id: string;
    title: string;
    source: string;
    status: NormalizedSession["status"];
    status_detail: string | null;
    last_message: string | null;
    last_message_role: NormalizedSession["lastMessageRole"];
    repo: string | null;
    raw: Record<string, unknown> | null;
    last_activity_at: string | null;
    triage_due_at: string;
  }>(
    `select id, title, source, status, status_detail, last_message, last_message_role, repo, raw, last_activity_at, triage_due_at
     from sessions where triage_due_at <= ? and archived = 0`,
    at.toISOString(),
  );
  if (!due.length) return 0;

  const view = (r: (typeof due)[number]) => ({
    title: r.title,
    status: r.status,
    statusDetail: r.status_detail,
    lastMessage: r.last_message,
    lastMessageRole: r.last_message_role,
    repo: r.repo,
    lastActivityAt: r.last_activity_at,
    raw: r.raw ?? {},
  });
  const verdicts = await judgeSessions(due.map((r) => triageInput(r.id, view(r), r.source)));
  let opened = 0;
  for (const r of due) {
    const verdict = verdicts.get(r.id) ?? null;
    // Only if nothing new arrived while the judge was thinking; new activity set a later due time.
    if (!update("sessions", { triage: verdict, triage_due_at: null }, "id = ? and triage_due_at = ?", r.id, r.triage_due_at)) continue;
    if (await syncTask(r.id, view(r), true, verdict, false)) opened++;
  }
  return opened;
}

/**
 * Open a task when the session genuinely needs the user; close it once it no longer does.
 * Only sessions with new activity are re-decided; a task you handled stays handled until then.
 * Returns true when a new task was opened.
 */
async function syncTask(
  sessionId: string,
  s: Pick<NormalizedSession, "title" | "status" | "statusDetail" | "lastMessage" | "lastActivityAt">,
  activityChanged: boolean,
  verdict: Verdict | null,
  archived: boolean,
): Promise<boolean> {
  const active = get<{ id: string }>("select id from tasks where session_id = ? and status <> 'done'", sessionId);
  const close = async () => {
    if (active) {
      update("tasks", { status: "done", resolved_at: now(), judge: verdict }, "id = ?", active.id);
    }
  };

  if (archived) {
    await close();
    return false;
  }
  if (!activityChanged) return false;

  const draft = verdict ? verdictToDraft(verdict, s) : deriveTask(s);
  if (!draft) {
    await close();
    return false;
  }
  if (active) {
    update("tasks", { kind: draft.kind, title: draft.title, detail: draft.detail, judge: verdict }, "id = ?", active.id);
    return false;
  }
  insert("tasks", {
    session_id: sessionId,
    kind: draft.kind,
    title: draft.title,
    detail: draft.detail,
    judge: verdict,
    raised_at: s.lastActivityAt ?? now(),
  });
  return true;
}
