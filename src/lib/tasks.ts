import type { SessionStatus, TaskKind, Verdict } from "./types";
import { clip } from "./text";

export interface TaskDraft {
  kind: TaskKind;
  title: string;
  detail: string;
}

/**
 * Turn a session's state into the thing the user has to do, if anything.
 * The classifier can override this with a sharper ask (see classify/apply.ts).
 */
export function deriveTask(s: {
  status: SessionStatus;
  title: string;
  statusDetail: string | null;
  lastMessage: string | null;
}): TaskDraft | null {
  const detail = s.statusDetail ?? clip(s.lastMessage, 400) ?? "";
  switch (s.status) {
    case "needs_you":
      return { kind: "respond", title: clip(`Reply: ${s.title}`, 140)!, detail };
    case "review":
      return { kind: "review", title: clip(`Review: ${s.title}`, 140)!, detail };
    case "failed":
      return { kind: "unblock", title: clip(`Unblock: ${s.title}`, 140)!, detail };
    default:
      return null;
  }
}

const KIND_PREFIX: Record<TaskKind, string> = {
  respond: "Reply",
  review: "Review",
  decide: "Decide",
  unblock: "Unblock",
  run: "Run",
  todo: "To-do",
};

/** Turn a triage verdict into the inbox task, or null when nothing is needed. */
export function verdictToDraft(
  v: Verdict,
  s: { title: string; statusDetail: string | null; lastMessage: string | null },
): TaskDraft | null {
  if (!v.needed || v.kind === "none") return null;
  const kind = v.kind;
  const detail = s.statusDetail ?? clip(s.lastMessage, 400) ?? "";
  // A crisp ask makes the best title; a whole message (long) does not.
  const ask = v.ask?.trim();
  const title = clip(ask && ask.length <= 140 ? ask : `${KIND_PREFIX[kind]}: ${s.title}`, 140)!;
  return { kind, title, detail };
}
