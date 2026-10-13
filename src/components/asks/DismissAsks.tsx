"use client";

import Link from "next/link";
import { bulkTasksAction, type TaskOp } from "@/app/_actions/bulk";
import { MenuItem, Popover } from "../ui/Popover";
import { useBulkRunner } from "../ui/useBulk";

/**
 * Clear every ask in one place — a company, a project or a single session — from wherever
 * "Needs you" shows. Handled closes them; Not needed also tells triage the sessions don't need
 * you, so they stay quiet until there's new activity. The toast offers Undo.
 */
export function DismissAsks({
  ids,
  scope,
  label,
  className,
  title = "Clear what's waiting on you",
  inboxHref,
  align = "left",
}: {
  ids: string[];
  /** What these asks belong to, e.g. "Ella Camera" — shown in the menu. */
  scope: string;
  label: React.ReactNode;
  className?: string;
  title?: string;
  /** Where "See them in the inbox" goes; omitted for a single ask. */
  inboxHref?: string;
  align?: "left" | "right";
}) {
  const { run, pending } = useBulkRunner();
  if (!ids.length) return null;
  const n = ids.length;
  const them = n === 1 ? "it" : "them";
  const apply = (op: TaskOp) => run(() => bulkTasksAction(ids, op));

  return (
    <Popover label={label} className={className} title={title} align={align} panelClassName="w-64" disabled={pending} floating>
      {(close) => {
        const pick = (op: TaskOp) => () => {
          close();
          apply(op);
        };
        return (
          <div className="py-1">
            <p className="truncate px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
              {n === 1 ? "1 ask" : `${n} asks`} · {scope}
            </p>
            <MenuItem onClick={pick({ type: "handled" })}>
              <span aria-hidden>✓</span> Done — I handled {them}
            </MenuItem>
            <MenuItem onClick={pick({ type: "not_needed" })}>
              <span aria-hidden>🙅</span> Not needed — make {them} go away
            </MenuItem>
            <MenuItem onClick={pick({ type: "snooze", hours: 24 })}>
              <span aria-hidden>⏰</span> Snooze until tomorrow
            </MenuItem>
            <MenuItem onClick={pick({ type: "snooze", hours: 24 * 7 })}>
              <span aria-hidden>📅</span> Snooze for a week
            </MenuItem>
            {inboxHref ? (
              <Link href={inboxHref} onClick={close} className="block border-t border-zinc-100 px-3 py-2 text-orange-700 hover:bg-zinc-50">
                See {them} in the inbox →
              </Link>
            ) : null}
          </div>
        );
      }}
    </Popover>
  );
}
