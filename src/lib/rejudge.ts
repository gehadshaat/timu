import "server-only";
import { get, insert, isUuid, now, update } from "./db";
import { verdictToDraft } from "./tasks";
import { judgeSessions } from "./triage";

export interface RejudgeResult {
  ok: boolean;
  message: string;
  needed?: boolean;
}

/**
 * Ask the triage judge about one session again, right now, and open, update or close its
 * ask to match. Used by "Re-check" on a session's page.
 */
export async function rejudgeSession(sessionId: string): Promise<RejudgeResult> {
  if (!isUuid(sessionId)) return { ok: false, message: "Couldn't find that session." };
  try {
    const s = get<{
      id: string;
      title: string;
      source: string;
      status: string;
      status_detail: string | null;
      last_message: string | null;
      last_message_role: string | null;
      repo: string | null;
      raw: Record<string, unknown> | null;
      last_activity_at: string | null;
      archived: boolean;
    }>(
      "select id, title, source, status, status_detail, last_message, last_message_role, repo, raw, last_activity_at, archived from sessions where id = ?",
      sessionId,
    );
    if (!s) return { ok: false, message: "Couldn't find that session." };
    if (s.archived) return { ok: false, message: "This session is archived — unarchive it first." };

    const input = {
      id: s.id,
      title: s.title,
      source: s.source,
      status: s.status,
      status_detail: s.status_detail,
      last_message: s.last_message,
      last_message_role: s.last_message_role,
      repo: s.repo,
      last_activity_at: s.last_activity_at,
      needs_action: (s.raw?.needs_action as string | null | undefined) ?? null,
    };
    const verdict = (await judgeSessions([input])).get(s.id);
    if (!verdict) return { ok: false, message: "The judge didn't answer; try again." };
    // Judged now, so it's no longer waiting for the sync's settle pass (see judgeDueSessions).
    update("sessions", { triage: verdict, triage_due_at: null }, "id = ?", s.id);

    const active = get<{ id: string }>("select id from tasks where session_id = ? and status <> 'done'", s.id);
    const draft = verdictToDraft(verdict, { title: s.title, statusDetail: s.status_detail, lastMessage: s.last_message });

    if (!draft) {
      if (active) {
        update("tasks", { status: "done", resolved_at: now(), judge: verdict }, "id = ?", active.id);
      }
      return { ok: true, needed: false, message: `Doesn't need you: ${verdict.reason}${active ? " — ask closed." : "."}` };
    }

    if (active) {
      update("tasks", { kind: draft.kind, title: draft.title, detail: draft.detail, judge: verdict }, "id = ?", active.id);
    } else {
      insert("tasks", {
        session_id: s.id,
        kind: draft.kind,
        title: draft.title,
        detail: draft.detail,
        judge: verdict,
        raised_at: s.last_activity_at ?? now(),
      });
    }
    return { ok: true, needed: true, message: `Needs you (${draft.kind}): ${verdict.reason}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
