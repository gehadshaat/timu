"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import clsx from "clsx";
import { setGoalStatusAction } from "@/app/actions";
import { bulkAddGoalsAction } from "@/app/_actions/bulk";
import { dueLabel } from "@/lib/format";
import { goalHref, projectHref } from "@/lib/links";
import { parseLines } from "@/lib/quickadd";
import type { GoalRow } from "@/lib/types";
import { GOAL_STATUS, GROUP_COLORS, SESSION_STATUS } from "../board/palette";
import { OpenSession } from "../asks/AskActions";
import { ArtifactChip } from "../artifacts/ArtifactChip";
import { MenuItem, Popover } from "../ui/Popover";
import { useBulkRunner } from "../ui/useBulk";

/**
 * Goals across several projects as one board (a company's goals): every project is a coloured
 * group and every goal a row — click its status to mark it achieved (or drop / reopen it), click
 * its title to open the goal's page.
 */

export interface OverviewGoal {
  goal: GoalRow;
  team: string | null;
  /** 0..1 */
  progress: number;
  items: number;
  /** The sessions working on it, so they can be opened right from the goal's row. */
  sessions: { id: string; title: string; status: string; url: string | null; resume: string | null }[];
  /** Artifacts its sessions made. */
  artifacts?: number;
}

export interface OverviewGroup {
  project: { id: string; name: string; emoji: string; slug: string };
  goals: OverviewGoal[];
}



/** Goal · Sessions · Team · Status · Due · Progress (team, due and progress from md up). */
const COLS = "grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem] md:grid-cols-[minmax(0,1fr)_7rem_8rem_7.5rem_6rem_8rem]";
const WIDE = "hidden md:flex";

function Cell({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={clsx("flex min-h-10 items-center justify-center border-l border-white", className)}>{children}</div>;
}

/** A goal's status as a solid cell; click it to change. Shared by every goals board. */
export function GoalStatusCell({ goal, className }: { goal: GoalRow; className?: string }) {
  const [pending, start] = useTransition();
  const st = GOAL_STATUS[goal.status];
  return (
    <Popover
      label={pending ? "…" : st.label}
      floating
      align="right"
      panelClassName="w-44"
      title="Change goal status"
      className={clsx("flex h-full w-full items-center justify-center px-1 text-xs font-bold text-white transition hover:brightness-110", st.cls, className)}
    >
      {(close) => (
        <div className="py-1">
          {(Object.keys(GOAL_STATUS) as GoalRow["status"][]).map((s) => (
            <MenuItem
              key={s}
              disabled={s === goal.status}
              onClick={() => {
                close();
                start(() => setGoalStatusAction(goal.id, s));
              }}
            >
              <span className={clsx("h-3 w-3 rounded-full", GOAL_STATUS[s].cls)} />
              {s === "achieved" ? "Achieved 🏆" : s === "active" ? (goal.status === "active" ? "Active" : "Reopen") : "Drop it"}
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** "⚡ 3": the goal's sessions in a menu, each with Open (claude.ai, or a resume command for local ones). */
function GoalSessions({ sessions }: { sessions: OverviewGoal["sessions"] }) {
  if (!sessions.length) return <span className="text-xs text-zinc-300">—</span>;
  return (
    <Popover
      label={`⚡ ${sessions.length}`}
      floating
      align="right"
      panelClassName="w-80"
      title="Open a session working on this goal"
      className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-700 hover:bg-zinc-200"
    >
      <ul className="max-h-80 overflow-y-auto py-1">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50">
            <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", (SESSION_STATUS[s.status] ?? SESSION_STATUS.idle).cls)} title={(SESSION_STATUS[s.status] ?? SESSION_STATUS.idle).label} />
            <Link href={`/sessions/${s.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
              {s.title}
            </Link>
            <OpenSession url={s.url} resume={s.resume} small />
          </li>
        ))}
      </ul>
    </Popover>
  );
}

function GoalLine({ g, color }: { g: OverviewGoal; color: string }) {
  const [pending, start] = useTransition();
  const { goal } = g;
  const done = goal.status !== "active";
  const due = done ? null : dueLabel(goal.due_date);
  const pct = Math.round(g.progress * 100);
  return (
    <div className={clsx(COLS, "group border-t border-zinc-100 bg-white hover:bg-zinc-50", pending && "animate-pulse")}>
      <div className="flex min-w-0 items-center gap-2 border-l-[6px] py-1.5 pl-2 pr-2" style={{ borderColor: color }}>
        <button
          type="button"
          onClick={() => start(() => setGoalStatusAction(goal.id, done ? "active" : "achieved"))}
          aria-label={done ? `Reopen “${goal.title}”` : `Mark “${goal.title}” achieved`}
          title={done ? "Reopen" : "Mark achieved"}
          className={clsx(
            "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black transition",
            goal.status === "achieved" ? "bg-[#00c875] text-white" : "ring-2 ring-zinc-300 hover:bg-emerald-50 hover:ring-emerald-400",
          )}
        >
          {goal.status === "achieved" ? "✓" : ""}
        </button>
        <Link href={goalHref(goal.id)} className={clsx("min-w-0 flex-1 truncate text-sm font-semibold hover:underline", done && "text-zinc-400", goal.status === "dropped" && "line-through")}>
          {goal.priority === "high" && !done ? "🔥 " : ""}
          {goal.title}
        </Link>
      </div>
      <Cell className="gap-1">
        <GoalSessions sessions={g.sessions} />
        <ArtifactChip count={g.artifacts} href={`${goalHref(goal.id)}#artifacts`} />
      </Cell>
      <Cell className={clsx(WIDE, "px-2 text-xs text-zinc-500")}>
        <span className="truncate">{g.team ?? "Whole project"}</span>
      </Cell>
      <Cell className="[&>div]:flex [&>div]:h-full [&>div]:w-full">
        <GoalStatusCell goal={goal} />
      </Cell>
      <Cell className={WIDE}>{due ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${due.tone}`}>{due.text}</span> : <span className="text-xs text-zinc-300">—</span>}</Cell>
      <Cell className={clsx(WIDE, "gap-2 px-3")}>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
          <span className="block h-full rounded-full bg-[#00c875]" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-[11px] font-bold text-zinc-500">{pct}%</span>
      </Cell>
    </div>
  );
}

function AddGoal({ projectId, color }: { projectId: string; color: string }) {
  const [text, setText] = useState("");
  const { run, pending } = useBulkRunner();
  return (
    <form
      className="flex items-center gap-2 border-t border-zinc-100 border-l-[6px] bg-white py-1.5 pl-2 pr-2"
      style={{ borderLeftColor: `${color}66` }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!parseLines(text, 100).length) return;
        const before = text;
        setText("");
        run(() => bulkAddGoalsAction(projectId, before), { onFailed: () => setText(before) });
      }}
    >
      <span className="pl-1 text-xs text-zinc-500">+ Goal</span>
      <input
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a goal"
        aria-label="New goal"
        className="min-w-0 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-0"
      />
    </form>
  );
}

export function GoalsOverview({ groups }: { groups: OverviewGroup[] }) {
  return (
    <div className="space-y-6">
      {groups.map((grp, i) => (
        <OverviewGroupView key={grp.project.id} grp={grp} color={GROUP_COLORS[i % GROUP_COLORS.length]} />
      ))}
    </div>
  );
}

function OverviewGroupView({ grp, color }: { grp: OverviewGroup; color: string }) {
  const [open, setOpen] = useState(true);
  const active = grp.goals.filter((g) => g.goal.status === "active");
  const [showDone, setShowDone] = useState(false);
  const finished = grp.goals.length - active.length;
  const shown = showDone ? grp.goals : active;
  return (
    <section>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Collapse" : "Expand"} className="w-4 text-sm" style={{ color }}>
          {open ? "▾" : "▸"}
        </button>
        <Link href={projectHref(grp.project.slug)} className="text-lg font-bold hover:underline" style={{ color }}>
          {grp.project.emoji} {grp.project.name}
        </Link>
        <span className="text-xs text-zinc-400">
          {active.length} active goal{active.length === 1 ? "" : "s"}
        </span>
        {finished ? (
          <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs font-semibold text-zinc-500 hover:text-ink">
            {showDone ? "Hide" : "Show"} {finished} achieved / dropped
          </button>
        ) : null}
      </header>
      {open ? (
        <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
          <div className={clsx(COLS, "text-[11px] font-semibold text-zinc-500")}>
            <div className="flex items-center border-l-[6px] py-1.5 pl-2" style={{ borderColor: color }}>
              Goal
            </div>
            <Cell>Sessions</Cell>
            <Cell className={WIDE}>Team</Cell>
            <Cell>Status</Cell>
            <Cell className={WIDE}>Due</Cell>
            <Cell className={WIDE}>Progress</Cell>
          </div>
          {shown.map((g) => (
            <GoalLine key={g.goal.id} g={g} color={color} />
          ))}
          <AddGoal projectId={grp.project.id} color={color} />
        </div>
      ) : null}
    </section>
  );
}

/** The goal page's big "done" button: mark achieved, or reopen once it is. */
export function GoalDoneButton({ goal }: { goal: GoalRow }) {
  const [pending, start] = useTransition();
  const achieved = goal.status === "achieved";
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => setGoalStatusAction(goal.id, achieved ? "active" : "achieved"))}
      className={clsx(
        "rounded-xl px-3 py-1.5 text-sm font-bold shadow-sm transition disabled:opacity-60",
        achieved ? "bg-white text-zinc-600 ring-1 ring-black/10 hover:bg-zinc-50" : "bg-[#00c875] text-white hover:brightness-105",
      )}
    >
      {pending ? "Saving…" : achieved ? "🏆 Achieved · reopen" : "✓ Mark achieved"}
    </button>
  );
}
