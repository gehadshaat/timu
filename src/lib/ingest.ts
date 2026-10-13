import "server-only";
import { all, get, insert, now, update } from "./db";
import { deriveTask, verdictToDraft } from "./tasks";
import { judgeSessions } from "./triage";
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

/**
 * Upsert sessions from any source and keep the task inbox in sync with their state.
 * Classification (project / team / agent) is left untouched on update.
 */
/** `account` is the Claude account they came from (see claude-accounts); kept as is when omitted. */
export async function ingestSessions(source: SessionSource, sessions: NormalizedSession[], account?: string): Promise<IngestResult> {
  const [run] = insert<{ id: string }>("import_runs", { source });

  try {
    const result: IngestResult = { imported: 0, updated: 0, tasksOpened: 0 };
    // Dedupe on external id (the extension can send the same chat twice in one batch).
    const unique = [...new Map(sessions.map((s) => [s.externalId, s])).values()];

    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const ids = chunk.map((s) => s.externalId);
      const existing = all<{ id: string; external_id: string; last_activity_at: string | null; title: string; title_locked: boolean; archived: boolean }>(
        "select id, external_id, last_activity_at, title, title_locked, archived from sessions where source = ? and external_id in (select value from json_each(?))",
        source,
        ids,
      );
      const known = new Map(existing.map((e) => [e.external_id, e]));

      const rows = chunk.map((s) => ({
        source,
        external_id: s.externalId,
        // A title you renamed in Timu survives re-imports.
        title: known.get(s.externalId)?.title_locked ? known.get(s.externalId)!.title : s.title,
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
        ...(account ? { account } : {}),
        updated_at: now(),
      }));
      const saved = insert<{ id: string; external_id: string }>("sessions", rows, { on: "source, external_id", do: "update" });

      const changes = saved.map((row) => {
        const s = chunk.find((c) => c.externalId === row.external_id)!;
        const prev = known.get(row.external_id);
        return { id: row.id, s, prev, archived: !!prev?.archived, activityChanged: !prev || prev.last_activity_at !== s.lastActivityAt };
      });

      // Triage: does each changed session genuinely need you? (rules, then a cheap model)
      const verdicts = await judgeSessions(
        changes
          .filter((c) => c.activityChanged && !c.archived)
          .map(({ id, s }) => ({
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
          })),
      );

      for (const c of changes) {
        if (c.prev) result.updated++;
        else result.imported++;
        const verdict = verdicts.get(c.id) ?? null;
        if (c.activityChanged) {
          // New activity: store the verdict and let the organiser look at the session again.
          // and drop any status you set by hand: the session has moved on.
          update("sessions", { triage: verdict, status_override: null, ...(c.prev && !c.archived ? { classified_at: null } : {}) }, "id = ?", c.id);
        }
        if (await syncTask(c.id, c.s, c.activityChanged, verdict, c.archived)) result.tasksOpened++;
      }
    }

    update("import_runs", { finished_at: now(), imported: result.imported, updated: result.updated }, "id = ?", run.id);
    return result;
  } catch (err) {
    update("import_runs", { finished_at: now(), error: err instanceof Error ? err.message : String(err) }, "id = ?", run.id);
    throw err;
  }
}

/**
 * Open a task when the session genuinely needs the user; close it once it no longer does.
 * Only sessions with new activity are re-decided; a task you handled stays handled until then.
 * Returns true when a new task was opened.
 */
async function syncTask(
  sessionId: string,
  s: NormalizedSession,
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
