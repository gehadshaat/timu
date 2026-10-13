"use client";

import clsx from "clsx";
import { bulkSessionsAction, bulkTasksAction, type SessionOp, type TaskOp } from "@/app/_actions/bulk";
import { MenuItem, Popover } from "../ui/Popover";
import { useBulkRunner } from "../ui/useBulk";
import { SESSION_STATUS, sessionTone } from "./palette";

/**
 * A session's status cell, clickable on every board. Set it yourself — "Needs me" raises an ask,
 * Done / Idle close one — or, while it's waiting on you, clear the ask (done, not needed, snooze).
 * A status you set lasts until the session has new activity. Every change has Undo in the toast.
 */
export function SessionStatusCell({
  session,
  askId,
  className,
}: {
  session: { id: string; title: string; status: string; status_override?: string | null; status_detail?: string | null };
  /** The open ask on this session, if any. */
  askId?: string | null;
  className?: string;
}) {
  const { run, pending } = useBulkRunner();
  const tone = sessionTone(session, !!askId);
  const setStatus = (status: Extract<SessionOp, { type: "status" }>["status"]) => run(() => bulkSessionsAction([session.id], { type: "status", status }));
  const onAsk = (op: TaskOp) => run(() => bulkTasksAction([askId!], op));
  const current = session.status_override ?? null;

  return (
    <Popover
      label={pending ? "…" : tone.label}
      floating
      align="right"
      panelClassName="w-60"
      title={session.status_detail ?? "Change status"}
      disabled={pending}
      className={clsx("flex h-full w-full items-center justify-center px-1 text-center text-xs font-bold text-white transition hover:brightness-110", tone.cls, className)}
    >
      {(close) => {
        const pick = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <div className="py-1">
            {askId ? (
              <>
                <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">Waiting on you</p>
                <MenuItem onClick={pick(() => onAsk({ type: "handled" }))}>
                  <span aria-hidden>✓</span> Done — I handled it
                </MenuItem>
                <MenuItem onClick={pick(() => onAsk({ type: "not_needed" }))}>
                  <span aria-hidden>🙅</span> Not needed — make it go away
                </MenuItem>
                <MenuItem onClick={pick(() => onAsk({ type: "snooze", hours: 24 }))}>
                  <span aria-hidden>⏰</span> Snooze until tomorrow
                </MenuItem>
                <div className="my-1 border-t border-zinc-100" />
              </>
            ) : null}
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">Set status</p>
            {askId ? null : (
              <MenuItem onClick={pick(() => setStatus("needs_you"))}>
                <span className={clsx("h-3 w-3 rounded-full", SESSION_STATUS.needs_you.cls)} /> Needs me
              </MenuItem>
            )}
            <MenuItem disabled={current === "done"} onClick={pick(() => setStatus("done"))}>
              <span className={clsx("h-3 w-3 rounded-full", SESSION_STATUS.done.cls)} /> Done
            </MenuItem>
            <MenuItem disabled={current === "idle"} onClick={pick(() => setStatus("idle"))}>
              <span className={clsx("h-3 w-3 rounded-full", SESSION_STATUS.idle.cls)} /> Idle
            </MenuItem>
            {current ? (
              <MenuItem onClick={pick(() => setStatus(null))}>
                <span aria-hidden>↺</span> Use Claude&apos;s status ({SESSION_STATUS[session.status]?.label ?? session.status})
              </MenuItem>
            ) : null}
          </div>
        );
      }}
    </Popover>
  );
}
