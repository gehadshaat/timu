import type { GoalRow, Priority } from "@/lib/types";

/**
 * Every board's colours in one place: a status or priority is a solid cell.
 * `bg` is the hex for inline styles; `cls` the same colour as a Tailwind class for buttons.
 */

export const GROUP_COLORS = ["#579bfc", "#00c875", "#a25ddc", "#fdab3d", "#ff642e", "#66ccff", "#9cd326", "#ff5ac4"];
export const groupColor = (i: number) => GROUP_COLORS[i % GROUP_COLORS.length];

export interface Tone {
  label: string;
  bg: string;
  cls: string;
}

export const SESSION_STATUS: Record<string, Tone> = {
  working: { label: "Working on it", bg: "#fdab3d", cls: "bg-[#fdab3d]" },
  needs_you: { label: "Needs you", bg: "#e2445c", cls: "bg-[#e2445c]" },
  review: { label: "Review", bg: "#a25ddc", cls: "bg-[#a25ddc]" },
  failed: { label: "Stuck", bg: "#bb3354", cls: "bg-[#bb3354]" },
  idle: { label: "Idle", bg: "#c4c4c4", cls: "bg-[#c4c4c4]" },
  done: { label: "Done", bg: "#00c875", cls: "bg-[#00c875]" },
};

/**
 * What a session's status cell says. It follows the inbox: an open ask reads "Needs you" (or
 * Review / Stuck); once cleared, a "needs you" from Claude reads Idle. A status you set wins.
 */
export function sessionTone(s: { status: string; status_override?: string | null }, hasAsk: boolean): Tone {
  return SESSION_STATUS[boardStatus(s, hasAsk)] ?? SESSION_STATUS.idle;
}

/** The status key behind `sessionTone` (the ClickUp mirror shows the same one). */
export function boardStatus(s: { status: string; status_override?: string | null }, hasAsk: boolean): string {
  const status = s.status_override ?? s.status;
  if (hasAsk) return status === "review" || status === "failed" ? status : "needs_you";
  if (status === "needs_you" || status === "review") return "idle";
  return SESSION_STATUS[status] ? status : "idle";
}

export const TODO_STATUS = {
  open: { label: "To do", bg: "#c4c4c4", cls: "bg-[#c4c4c4]" },
  done: { label: "Done", bg: "#00c875", cls: "bg-[#00c875]" },
} satisfies Record<string, Tone>;

export const PRIORITY: Record<Priority, Tone> = {
  high: { label: "High", bg: "#401694", cls: "bg-[#401694]" },
  normal: { label: "Medium", bg: "#5559df", cls: "bg-[#5559df]" },
  low: { label: "Low", bg: "#579bfc", cls: "bg-[#579bfc]" },
};

export const GOAL_STATUS: Record<GoalRow["status"], Tone> = {
  active: { label: "Active", bg: "#fdab3d", cls: "bg-[#fdab3d]" },
  achieved: { label: "Achieved", bg: "#00c875", cls: "bg-[#00c875]" },
  dropped: { label: "Dropped", bg: "#c4c4c4", cls: "bg-[#c4c4c4]" },
};

/** Ask kinds (inbox rows). */
export const ASK_KIND: Record<string, Tone> = {
  unblock: { label: "Unblock", bg: "#bb3354", cls: "bg-[#bb3354]" },
  decide: { label: "Decide", bg: "#a25ddc", cls: "bg-[#a25ddc]" },
  respond: { label: "Reply", bg: "#e2445c", cls: "bg-[#e2445c]" },
  review: { label: "Review", bg: "#579bfc", cls: "bg-[#579bfc]" },
  run: { label: "Run", bg: "#fdab3d", cls: "bg-[#fdab3d]" },
};

/** A teammate's current state (their office pose) as a status cell. */
export const POSE_TONE: Record<string, string> = {
  needs_you: SESSION_STATUS.needs_you.cls,
  review: SESSION_STATUS.review.cls,
  failed: SESSION_STATUS.failed.cls,
  done: SESSION_STATUS.done.cls,
  idle: SESSION_STATUS.idle.cls,
  walking: SESSION_STATUS.idle.cls,
  working: SESSION_STATUS.working.cls,
  thinking: SESSION_STATUS.working.cls,
  reading: SESSION_STATUS.working.cls,
  call: SESSION_STATUS.working.cls,
};
