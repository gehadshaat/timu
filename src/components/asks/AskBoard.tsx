"use client";

import Link from "next/link";
import clsx from "clsx";
import { timeAgo } from "@/lib/format";
import { projectHref } from "@/lib/links";
import type { AskView } from "@/lib/ask-view";
import { ASK_KIND } from "../board/palette";
import { Character } from "../Character";
import { SelectBox } from "../ui/BulkBar";
import { LeaveStamp, markedClasses } from "../ui/Leaving";
import { MenuItem, Popover, SNOOZE_CHOICES } from "../ui/Popover";
import type { LeaveEffect, LeavePhase } from "../ui/useLeaving";
import { OpenSession, type AskHandlers } from "./AskActions";

/**
 * The inbox as a board: each group is a coloured table and each ask a row — select · ask ·
 * owner · kind (click to clear it) · project · age · open. Same columns as every other board.
 */

/** ☐ · Ask · Owner · Kind · Project (from md) · Age (from md) · Open (from sm). */
export const ASK_COLS =
  "grid grid-cols-[2rem_minmax(0,1fr)_2.75rem_6rem] sm:grid-cols-[2rem_minmax(0,1fr)_3.5rem_6.5rem_4.5rem] md:grid-cols-[2rem_minmax(0,1fr)_3.5rem_6.5rem_9rem_5rem_4.5rem]";

function Cell({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={clsx("flex min-h-11 items-center justify-center border-l border-white", className)}>{children}</div>;
}

export function AskBoardHead({ color, label, all, onSelectAll, count }: { color: string; label: string; all: boolean; onSelectAll: () => void; count: number }) {
  return (
    <div className={clsx(ASK_COLS, "text-[11px] font-semibold text-zinc-500")}>
      <div className="flex items-center justify-center border-l-[6px]" style={{ borderColor: color }}>
        <input type="checkbox" aria-label={`Select all in ${label}`} checked={all} onChange={onSelectAll} disabled={!count} className="h-3.5 w-3.5 cursor-pointer accent-amber-500" />
      </div>
      <div className="flex items-center py-1.5 pl-2">Ask</div>
      <Cell>Owner</Cell>
      <Cell>Kind</Cell>
      <Cell className="hidden md:flex">Project</Cell>
      <Cell className="hidden md:flex">Waiting</Cell>
      <Cell className="hidden sm:flex" />
    </div>
  );
}

export function AskBoardRow({
  ask,
  color,
  phase,
  effect,
  handlers,
  selected,
  onSelect,
  focused,
  now,
}: {
  ask: AskView;
  color: string;
  phase: LeavePhase;
  effect: LeaveEffect;
  handlers: AskHandlers;
  selected: boolean;
  onSelect: (shift: boolean) => void;
  focused: boolean;
  now: number;
}) {
  const marked = phase !== "idle";
  const kind = ASK_KIND[ask.kind] ?? ASK_KIND.respond;
  return (
    <div
      data-ask={ask.id}
      className={clsx(
        ASK_COLS,
        "group relative border-t border-zinc-100 bg-white transition hover:bg-zinc-50",
        selected && !marked && "bg-amber-50 hover:bg-amber-50",
        focused && !marked && !selected && "outline outline-2 -outline-offset-2 outline-ink/30",
        markedClasses(phase, effect),
      )}
    >
      <div className="flex items-center justify-center border-l-[6px]" style={{ borderColor: color }}>
        <SelectBox checked={selected} onToggle={onSelect} label={`Select “${ask.title}”`} className="h-3.5 w-3.5 cursor-pointer accent-amber-500" />
      </div>
      <div className="min-w-0 py-1.5 pl-2 pr-2">
        <Link href={`/sessions/${ask.session.id}`} className="block truncate text-sm font-semibold hover:underline" title={ask.title}>
          <span className={clsx("strike", marked && (effect === "done" || effect === "dismiss") && "strike-on")}>{ask.title}</span>
        </Link>
        <span className="block truncate text-xs text-zinc-500" title={ask.session.title}>
          {ask.session.title}
        </span>
      </div>
      <Cell>
        <span title={ask.agent ? `${ask.agent.name}, ${ask.agent.role}` : "Unfiled"}>
          <Character spec={ask.agent?.avatar ?? { seed: ask.session.title }} pose={marked && effect === "done" ? "done" : "needs_you"} desk={false} size={30} />
        </span>
      </Cell>
      <Cell className="[&>div]:flex [&>div]:h-full [&>div]:w-full">
        {marked ? (
          <span className="flex w-full items-center justify-center">
            <LeaveStamp phase={phase} effect={effect} size="sm" />
          </span>
        ) : (
          // Click the kind to clear the ask, like any status cell on a board.
          <Popover
            label={kind.label}
            floating
            align="right"
            panelClassName="w-60"
            title="Clear it: done, not needed or snooze"
            className={clsx("flex h-full w-full items-center justify-center px-1 text-xs font-bold text-white transition hover:brightness-110", kind.cls)}
          >
            {(close) => (
              <div className="py-1">
                <MenuItem
                  onClick={() => {
                    close();
                    handlers.onHandled();
                  }}
                >
                  <span aria-hidden>✓</span> Done — I handled it <kbd className="ml-auto text-[10px] text-zinc-400">e</kbd>
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    handlers.onNotNeeded();
                  }}
                >
                  <span aria-hidden>🙅</span> Not needed — make it go away <kbd className="ml-auto text-[10px] text-zinc-400">n</kbd>
                </MenuItem>
                <div className="my-1 border-t border-zinc-100" />
                {SNOOZE_CHOICES.map(([label, hours]) => (
                  <MenuItem
                    key={label}
                    onClick={() => {
                      close();
                      handlers.onSnooze(hours, label);
                    }}
                  >
                    <span aria-hidden>⏰</span> {label}
                  </MenuItem>
                ))}
              </div>
            )}
          </Popover>
        )}
      </Cell>
      <Cell className="hidden px-2 md:flex">
        {ask.project ? (
          <Link href={projectHref(ask.project.slug)} className="truncate text-xs text-zinc-600 hover:underline">
            {ask.project.emoji} {ask.project.name}
          </Link>
        ) : (
          <span className="text-xs text-zinc-300">Unfiled</span>
        )}
      </Cell>
      <Cell className="hidden text-xs text-zinc-500 md:flex">{timeAgo(ask.raisedAt, now)}</Cell>
      <Cell className="hidden sm:flex">
        <OpenSession url={ask.session.url} resume={ask.session.resume} small />
      </Cell>
    </div>
  );
}
