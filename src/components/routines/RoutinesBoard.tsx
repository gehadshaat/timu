"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { timeAgo } from "@/lib/format";
import { personHref, projectHref } from "@/lib/links";
import type { AvatarSpec } from "@/lib/types";
import { SESSION_STATUS } from "../board/palette";
import { Character } from "../Character";

/**
 * Claude Code routines and scheduled check-ins as a board: recurring routines, one-off check-ins
 * sessions have scheduled, and (folded) the ones that already ran or were switched off.
 */

export interface RoutineItem {
  id: string;
  name: string;
  kind: string;
  prompt: string | null;
  schedule: string;
  state: "scheduled" | "done";
  recurring: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: "succeeded" | "failed" | "running" | null;
  session: { id: string; title: string; url: string | null; resume: string | null } | null;
  /** The routine's page on claude.ai. */
  routineUrl: string;
  /** Its latest session on claude.ai (a check-in's own session, else the last run), when there is one. */
  latestUrl: string | null;
  latestLabel: string;
  /** The Claude account it came from. */
  account: string | null;
  agent: { id: string; name: string; role: string; avatar: AvatarSpec } | null;
  project: { name: string; emoji: string; slug: string } | null;
}

const RUN_TONE: Record<string, { label: string; cls: string }> = {
  succeeded: { label: "Succeeded", cls: SESSION_STATUS.done.cls },
  failed: { label: "Failed", cls: SESSION_STATUS.failed.cls },
  running: { label: "Running", cls: SESSION_STATUS.working.cls },
};

/** Routine · Owner · Schedule · Next run · Last run · Open (owner, schedule and next from md). */
const COLS = "grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] md:grid-cols-[minmax(0,1fr)_9rem_11rem_7rem_7rem_7.5rem]";
const WIDE = "hidden md:flex";

function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** "in 3h" / "in 2d" for the future; the usual "5m ago" for the past. */
function when(iso: string | null, now: number | null) {
  if (!iso || now === null) return "";
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return timeAgo(iso, now);
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

function Cell({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={clsx("flex min-h-11 items-center justify-center border-l border-zinc-100", className)}>{children}</div>;
}

function Row({ r, color, now }: { r: RoutineItem; color: string; now: number | null }) {
  const run = r.lastRunStatus ? RUN_TONE[r.lastRunStatus] : null;
  return (
    <div className={clsx(COLS, "border-t border-zinc-100 bg-white hover:bg-zinc-50", r.state === "done" && "text-zinc-500")}>
      <div className="min-w-0 border-l-[6px] py-1.5 pl-2 pr-2" style={{ borderColor: color }}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="text-xs">{r.recurring ? "🔁" : "⏰"}</span>
          <a href={r.routineUrl} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold hover:underline" title={`Open “${r.name}” on claude.ai`}>
            {r.name}
          </a>
        </div>
        {r.prompt ? (
          <p className="truncate text-xs text-zinc-500" title={r.prompt}>
            {r.prompt}
          </p>
        ) : null}
        {r.project || (r.account && r.account !== "claude") ? (
          <span className="flex gap-2 text-[11px] text-zinc-400">
            {r.project ? (
              <Link href={projectHref(r.project.slug)} className="hover:underline">
                {r.project.emoji} {r.project.name}
              </Link>
            ) : null}
            {r.account && r.account !== "claude" ? <span className="rounded-full bg-violet-100 px-1.5 font-semibold text-violet-700">{r.account}</span> : null}
          </span>
        ) : null}
      </div>
      <Cell className={clsx(WIDE, "justify-start gap-2 px-2")}>
        {r.agent ? (
          <Link href={personHref(r.agent.id)} className="flex min-w-0 items-center gap-1.5 hover:underline" title={`${r.agent.name}, ${r.agent.role}`}>
            <Character spec={r.agent.avatar} pose="idle" desk={false} size={24} />
            <span className="truncate text-xs font-semibold">{r.agent.name}</span>
          </Link>
        ) : (
          <span className="text-xs text-zinc-300">—</span>
        )}
      </Cell>
      <Cell className={clsx(WIDE, "px-2 text-xs")}>
        <span className="truncate" title={r.schedule}>
          {r.schedule}
        </span>
      </Cell>
      <Cell className={clsx(WIDE, "text-xs")} >
        {r.state === "scheduled" && r.nextRunAt ? (
          <span title={new Date(r.nextRunAt).toLocaleString()} className="font-semibold text-ink">
            {when(r.nextRunAt, now)}
          </span>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </Cell>
      <div className="flex items-stretch border-l border-white">
        {run ? (
          <span className={clsx("flex w-full flex-col items-center justify-center px-1 text-center text-xs font-bold text-white", run.cls)} title={r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : undefined}>
            {run.label}
            <span className="text-[10px] font-semibold opacity-80">{when(r.lastRunAt, now)}</span>
          </span>
        ) : (
          <span className="flex w-full items-center justify-center bg-[#c4c4c4] text-xs font-bold text-white">Not run yet</span>
        )}
      </div>
      <Cell className="flex-col gap-0.5 px-1">
        {r.latestUrl ? (
          <a href={r.latestUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap rounded-xl bg-ink px-2 py-1 text-xs font-bold text-paper shadow-sm hover:opacity-90" title={`Open the ${r.latestLabel.toLowerCase()} on claude.ai`}>
            {r.latestLabel} ↗
          </a>
        ) : (
          <a href={r.routineUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap rounded-xl bg-white px-2 py-1 text-xs font-bold ring-1 ring-black/10 hover:bg-zinc-50" title="Open the routine on claude.ai">
            Routine ↗
          </a>
        )}
        {r.session ? (
          <Link href={`/sessions/${r.session.id}`} className="text-[10px] font-semibold text-orange-700 hover:underline">
            details
          </Link>
        ) : null}
      </Cell>
    </div>
  );
}

function Group({ title, color, items, now, folded = false, hint }: { title: string; color: string; items: RoutineItem[]; now: number | null; folded?: boolean; hint?: string }) {
  const [open, setOpen] = useState(!folded);
  if (!items.length) return null;
  return (
    <section>
      <header className="flex flex-wrap items-center gap-3 pb-1">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? `Collapse ${title}` : `Expand ${title}`} className="w-4 text-sm" style={{ color }}>
          {open ? "▾" : "▸"}
        </button>
        <h2 className="text-lg font-bold" style={{ color }}>
          {title}
        </h2>
        <span className="text-xs text-zinc-400">
          {items.length}
          {hint ? ` · ${hint}` : ""}
        </span>
      </header>
      {open ? (
        <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
          <div className={clsx(COLS, "text-[11px] font-semibold text-zinc-500")}>
            <div className="flex items-center border-l-[6px] py-1.5 pl-2" style={{ borderColor: color }}>
              Routine
            </div>
            <Cell className={clsx(WIDE, "min-h-0 justify-start px-2")}>Owner</Cell>
            <Cell className={clsx(WIDE, "min-h-0")}>Schedule</Cell>
            <Cell className={clsx(WIDE, "min-h-0")}>Next run</Cell>
            <Cell className="min-h-0">Last run</Cell>
            <Cell className="min-h-0">Open</Cell>
          </div>
          {items.map((r) => (
            <Row key={r.id} r={r} color={color} now={now} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function RoutinesBoard({ items, empty }: { items: RoutineItem[]; empty: React.ReactNode }) {
  const now = useNow();
  const soonest = (a: RoutineItem, b: RoutineItem) => (a.nextRunAt ?? "9999").localeCompare(b.nextRunAt ?? "9999");
  const recurring = items.filter((r) => r.state === "scheduled" && r.recurring).sort(soonest);
  const checkins = items.filter((r) => r.state === "scheduled" && !r.recurring).sort(soonest);
  const done = items.filter((r) => r.state === "done").sort((a, b) => (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? ""));
  if (!items.length) return <div className="rounded-3xl border-2 border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">{empty}</div>;
  return (
    <div className="space-y-6">
      <Group title="Recurring routines" color="#579bfc" items={recurring} now={now} hint="run on a schedule" />
      <Group title="Scheduled check-ins" color="#fdab3d" items={checkins} now={now} hint="sessions coming back to something" />
      {!recurring.length && !checkins.length ? <p className="text-sm text-zinc-500">Nothing scheduled right now.</p> : null}
      <Group title="Ran / switched off" color="#c4c4c4" items={done} now={now} folded />
    </div>
  );
}
