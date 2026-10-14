"use client";

import Link from "next/link";
import clsx from "clsx";
import { Character } from "../Character";
import { SourceBadge } from "../SourceBadge";
import { SelectBox } from "../ui/BulkBar";
import { Ago } from "../ui/Ago";
import { LeaveStamp, markedClasses } from "../ui/Leaving";
import { MenuItem, Popover, SNOOZE_CHOICES } from "../ui/Popover";
import type { LeaveEffect, LeavePhase } from "../ui/useLeaving";
import { AskActions, OpenSession, type AskHandlers } from "./AskActions";
import { ENGINE_ICON, KIND_POSE, KIND_STYLE } from "./style";
import { KIND_LABEL } from "@/lib/format";
import { companyHref, personHref, projectHref, teamHref } from "@/lib/links";
import type { AskView } from "@/lib/ask-view";

interface Common {
  ask: AskView;
  phase: LeavePhase;
  effect: LeaveEffect;
  handlers: AskHandlers;
  selected?: boolean;
  onSelect?: (shift: boolean) => void;
  focused?: boolean;
}

function poseOf(ask: AskView, phase: LeavePhase, effect: LeaveEffect) {
  if (phase !== "idle" && effect === "done") return "done" as const;
  if (phase !== "idle" && effect === "snooze") return "idle" as const;
  return KIND_POSE[ask.kind] ?? "needs_you";
}

/** The full card: who's asking, what they need, the quote, and the actions. */
export function AskCard({ ask, phase, effect, handlers, selected, onSelect, focused }: Common) {
  const marked = phase !== "idle";
  return (
    <article
      data-ask={ask.id}
      className={clsx(
        "relative flex gap-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5 transition sm:p-5",
        !marked && "hover:shadow-md",
        selected && !marked && "bg-amber-50/70 ring-2 ring-amber-300",
        focused && !marked && !selected && "ring-2 ring-ink/30",
        markedClasses(phase, effect),
      )}
    >
      <LeaveStamp phase={phase} effect={effect} />
      {onSelect ? (
        <div className="pt-1">
          <SelectBox checked={!!selected} onToggle={onSelect} label={`Select “${ask.title}”`} className="h-5 w-5 cursor-pointer accent-amber-500" />
        </div>
      ) : null}
      <div className="hidden shrink-0 sm:block">
        <div className={clsx("rounded-2xl bg-gradient-to-b p-1 transition-colors", marked && effect === "done" ? "from-emerald-50 to-emerald-200" : "from-amber-50 to-orange-100")}>
          <Character
            spec={ask.agent?.avatar ?? { seed: ask.session.title }}
            pose={poseOf(ask, phase, effect)}
            size={104}
            title={ask.agent ? `${ask.agent.name}, ${ask.agent.role}` : undefined}
          />
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-24 text-xs text-zinc-500">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white ${KIND_STYLE[ask.kind] ?? "bg-zinc-500"}`}>
            {KIND_LABEL[ask.kind] ?? ask.kind}
          </span>
          {ask.agent ? (
            <span className="font-semibold text-zinc-800">
              <Link href={personHref(ask.agent.id)} className="hover:underline">
                {ask.agent.name}
              </Link>{" "}
              <span className="font-normal text-zinc-500">· {ask.agent.role}</span>
            </span>
          ) : null}
          {ask.team ? (
            <Link href={teamHref(ask.team.id)} className="hover:underline">
              · {ask.team.name}
            </Link>
          ) : null}
          {ask.project ? (
            <Link href={projectHref(ask.project.slug)} className="hover:underline">
              · {ask.project.emoji} {ask.project.name}
            </Link>
          ) : null}
          {ask.company ? (
            <Link href={companyHref(ask.company.slug)} className="hover:underline">
              · {ask.company.emoji} {ask.company.name}
            </Link>
          ) : null}
          <span>· <Ago iso={ask.raisedAt} /></span>
          {ask.judge ? (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500" title={`${ask.judge.reason} (${ask.judge.engine})`}>
              {ENGINE_ICON[ask.judge.engine] ?? "🤖"} {Math.round(ask.judge.confidence * 100)}% sure
            </span>
          ) : null}
        </div>
        <h3 className="font-display text-lg font-bold leading-snug">
          <span className={clsx("strike", marked && (effect === "done" || effect === "dismiss") && "strike-on")}>{ask.title}</span>
        </h3>
        {ask.detail ? <p className="text-sm text-zinc-600">{ask.detail}</p> : null}
        {ask.quote ? (
          <blockquote className="line-clamp-3 rounded-2xl bg-zinc-50 px-3 py-2 text-sm italic text-zinc-600 ring-1 ring-black/5">“{ask.quote}”</blockquote>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <SourceBadge source={ask.session.source} />
          <Link href={`/sessions/${ask.session.id}`} className="truncate font-medium text-zinc-700 hover:underline">
            {ask.session.title}
          </Link>
          {ask.session.repo ? <span className="font-mono">{ask.session.repo}</span> : null}
        </div>
        <div className={clsx("pt-1", marked && "pointer-events-none opacity-40")}>
          <AskActions url={ask.session.url} resume={ask.session.resume} handlers={handlers} disabled={marked} />
        </div>
      </div>
    </article>
  );
}

/** One line per ask, for scanning hundreds quickly. Actions appear on hover/focus. */
export function AskRow({ ask, phase, effect, handlers, selected, onSelect, focused, showProject = true }: Common & { showProject?: boolean }) {
  const marked = phase !== "idle";
  return (
    <div
      data-ask={ask.id}
      className={clsx(
        "group relative flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-white px-3 py-2 ring-1 ring-black/5 transition sm:flex-nowrap",
        selected && !marked && "bg-amber-50 ring-2 ring-amber-300",
        focused && !marked && !selected && "ring-2 ring-ink/30",
        markedClasses(phase, effect),
      )}
    >
      {onSelect ? <SelectBox checked={!!selected} onToggle={onSelect} label={`Select “${ask.title}”`} /> : null}
      <span className="relative shrink-0" title={ask.agent ? `${ask.agent.name}, ${ask.agent.role}` : "Unfiled"}>
        <Character spec={ask.agent?.avatar ?? { seed: ask.session.title }} pose={poseOf(ask, phase, effect)} desk={false} size={40} />
      </span>
      <span
        className={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white sm:inline ${KIND_STYLE[ask.kind] ?? "bg-zinc-500"}`}
      >
        {KIND_LABEL[ask.kind] ?? ask.kind}
      </span>
      <div className="min-w-0 flex-1">
        <Link href={`/sessions/${ask.session.id}`} className="block truncate text-sm font-semibold hover:underline" title={ask.title}>
          <span className={clsx("strike", marked && (effect === "done" || effect === "dismiss") && "strike-on")}>{ask.title}</span>
        </Link>
        <span className="block truncate text-xs text-zinc-500">
          {ask.agent ? `${ask.agent.name} · ` : ""}
          {showProject && ask.project ? `${ask.project.emoji} ${ask.project.name} · ` : ""}
          <Ago iso={ask.raisedAt} />
        </span>
      </div>
      {/* On phones the actions wrap onto their own line; from sm up they float over the row's right
          edge on hover instead of reserving their width, so titles stay readable in narrow columns. */}
      {marked ? (
        <LeaveStamp phase={phase} effect={effect} size="sm" />
      ) : (
        <div className="flex w-full shrink-0 items-center justify-end gap-1 opacity-100 transition sm:pointer-events-none sm:w-auto sm:absolute sm:right-2 sm:top-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:bg-white sm:p-1 sm:opacity-0 sm:shadow-md sm:ring-1 sm:ring-black/5 sm:group-focus-within:pointer-events-auto sm:group-focus-within:opacity-100 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100">
          <OpenSession url={ask.session.url} resume={ask.session.resume} small />
          <button
            type="button"
            onClick={handlers.onHandled}
            title="Handled (e)"
            aria-label="Handled"
            className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500 text-sm font-black text-white hover:bg-emerald-600"
          >
            ✓
          </button>
          <Popover label="⏰" title="Snooze (s)" className="grid h-7 w-7 place-items-center rounded-lg text-sm ring-1 ring-black/10 hover:bg-zinc-50" align="right" panelClassName="w-36">
            {(close) =>
              SNOOZE_CHOICES.map(([label, hours]) => (
                <MenuItem
                  key={label}
                  onClick={() => {
                    close();
                    handlers.onSnooze(hours, label);
                  }}
                >
                  {label}
                </MenuItem>
              ))
            }
          </Popover>
          <button
            type="button"
            onClick={() => handlers.onNotNeeded()}
            title="Not needed (n)"
            aria-label="Not needed"
            className="grid h-7 w-7 place-items-center rounded-lg text-sm ring-1 ring-black/10 hover:bg-zinc-50"
          >
            🙅
          </button>
        </div>
      )}
    </div>
  );
}
