"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import clsx from "clsx";
import {
  addMilestoneAction,
  createTodoAction,
  deleteGoalAction,
  deleteMilestoneAction,
  deleteTodoAction,
  linkSessionToGoalAction,
  setGoalStatusAction,
  toggleMilestoneAction,
  toggleTodoAction,
} from "@/app/actions";
import { bulkAddGoalsAction, bulkTodosAction, type TodoOp } from "@/app/_actions/bulk";
import type { CommentRow } from "@/lib/comments";
import { dueLabel, timeAgo } from "@/lib/format";
import { goalHref, projectHref, resumeFor } from "@/lib/links";
import { isoDate, parseLines } from "@/lib/quickadd";
import type { GoalView, OrgOptions, TodoItem } from "@/lib/queries";
import type { GoalRow, MilestoneRow, Priority, SessionRow } from "@/lib/types";
import { Character } from "../Character";
import { OpenSession } from "../asks/AskActions";
import { SessionStatusCell } from "../board/SessionStatusCell";
import { GOAL_STATUS, GROUP_COLORS, PRIORITY } from "../board/palette";
import { CommentThread } from "../comments/CommentThread";
import { GoalForm } from "../GoalForm";
import { OrgPicker } from "../ui/Picker";
import { MenuItem, Popover } from "../ui/Popover";
import { Renameable } from "../ui/Renameable";
import { useToast } from "../ui/Toaster";
import { useBulkRunner } from "../ui/useBulk";

/**
 * A project's plan as one board: every goal is a coloured group, and
 * its milestones, to-dos and the sessions working on it are rows with the same columns
 * (owner, status, due, priority, last update). To-dos with no goal get their own group.
 */

export interface SessionOption {
  id: string;
  title: string;
  goal_id: string | null;
}


/** Item · Owner · Status · Due · Priority · Updated (the last three from sm up). */
const COLS = "grid grid-cols-[minmax(0,1fr)_2.5rem_5.5rem] sm:grid-cols-[minmax(0,1fr)_4rem_8rem_6.5rem_6rem_5.5rem]";
const WIDE = "hidden sm:flex";



const NEXT_PRIORITY: Record<Priority, Priority> = { low: "normal", normal: "high", high: "low" };


function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Relative times differ between server and browser, so render them only after mount. */
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function Ago({ iso }: { iso: string | null }) {
  const mounted = useMounted();
  return <span className="text-xs text-zinc-500">{mounted ? timeAgo(iso) : ""}</span>;
}

/** A solid colour cell — the board's status / priority look. */
function Block({ bg, children, onClick, title, dim }: { bg: string; children: React.ReactNode; onClick?: () => void; title?: string; dim?: boolean }) {
  const cls = clsx("flex h-full w-full items-center justify-center px-1 text-center text-xs font-bold text-white", dim && "opacity-60");
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={clsx(cls, "transition hover:brightness-110")} style={{ background: bg }}>
      {children}
    </button>
  ) : (
    <span title={title} className={cls} style={{ background: bg }}>
      {children}
    </span>
  );
}

const Empty = () => <span className="text-xs text-zinc-300">—</span>;

function Cell({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={clsx("flex min-h-10 items-center justify-center border-l border-white", className)}>{children}</div>;
}

function Owner({ agent }: { agent: OrgOptions["agents"][number] | null | undefined }) {
  return agent ? (
    <span title={`${agent.name}, ${agent.role}`}>
      <Character spec={agent.avatar} pose="working" desk={false} size={28} />
    </span>
  ) : (
    <span title="You" className="grid h-7 w-7 place-items-center rounded-full bg-amber-100 text-xs">
      👤
    </span>
  );
}

function Row({ color, children, done }: { color: string; children: React.ReactNode; done?: boolean }) {
  return (
    <div className={clsx(COLS, "group border-t border-zinc-100 bg-white hover:bg-zinc-50", done && "text-zinc-400")}>
      <div className="flex min-w-0 items-center gap-2 border-l-[6px] py-1.5 pl-2 pr-2" style={{ borderColor: color }}>
        {children}
      </div>
    </div>
  );
}

// ---------- rows ----------

/** A to-do as a board row. `where` adds its project and goal under the title (boards that mix projects). */
export function TodoRow({ item, color, options, where }: { item: TodoItem; color: string; options: OrgOptions; where?: boolean }) {
  const { task } = item;
  const [done, setDone] = useOptimistic(task.status === "done");
  const [, start] = useTransition();
  const { run } = useBulkRunner();
  const agent = options.agents.find((a) => a.id === task.agent_id);
  const due = done ? null : dueLabel(task.due_date);
  const apply = (op: TodoOp) => run(() => bulkTodosAction([task.id], op));
  const toggle = () =>
    start(async () => {
      setDone(!done);
      await toggleTodoAction(task.id, !done);
    });

  return (
    <div className={clsx(COLS, "group border-t border-zinc-100 bg-white hover:bg-zinc-50")}>
      <div className="flex min-w-0 items-center gap-2 border-l-[6px] py-1.5 pl-2 pr-2" style={{ borderColor: color }}>
        <span aria-hidden className="text-xs text-zinc-400">☐</span>
        <div className="min-w-0 flex-1">
          <Renameable kind="todo" id={task.id} value={task.title} className={clsx("block min-w-0 truncate text-sm", done && "text-zinc-400 line-through")} label="Rename to-do" />
          {where && (item.project || item.goal) ? (
            <span className="block truncate text-xs text-zinc-500">
              {item.project ? (
                <Link href={projectHref(item.project.slug)} className="hover:underline">
                  {item.project.emoji} {item.project.name}
                </Link>
              ) : null}
              {item.goal ? (
                <Link href={goalHref(item.goal.id)} className="hover:underline">
                  {item.project ? " · " : ""}🎯 {item.goal.title}
                </Link>
              ) : null}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => confirm(`Delete the to-do “${task.title}”?`) && start(() => deleteTodoAction(task.id))}
          className="hidden shrink-0 text-xs text-zinc-300 opacity-0 hover:text-rose-600 group-hover:opacity-100 sm:inline"
          aria-label="Delete to-do"
        >
          ✕
        </button>
      </div>
      <Cell>
        <Popover label={<Owner agent={agent} />} className="rounded-full" panelClassName="w-72" title="Change owner" floating>
          {(close) => (
            <OrgPicker
              options={options}
              kinds={["person"]}
              none={{ kind: "person", label: "👤 Me" }}
              placeholder="Search people…"
              onPick={(p) => {
                close();
                apply({ type: "assign", agentId: p.id });
              }}
            />
          )}
        </Popover>
      </Cell>
      <Cell>
        <Block bg={done ? "#00c875" : "#c4c4c4"} onClick={toggle} title={done ? "Mark not done" : "Mark done"}>
          {done ? "Done" : "To do"}
        </Block>
      </Cell>
      <Cell className={WIDE}>
        <Popover
          label={due ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${due.tone}`}>{due.text}</span> : <span className="text-xs text-zinc-300 group-hover:text-zinc-500">+ date</span>}
          className="rounded-full px-1"
          title="Set due date"
          panelClassName="w-48"
          floating
        >
          {(close) => (
            <div className="py-1">
              {(
                [
                  ["Today", addDays(0)],
                  ["Tomorrow", addDays(1)],
                  ["In 3 days", addDays(3)],
                  ["Next week", addDays(7)],
                ] as const
              ).map(([label, date]) => (
                <MenuItem
                  key={label}
                  onClick={() => {
                    close();
                    apply({ type: "due", date });
                  }}
                >
                  {label}
                </MenuItem>
              ))}
              <label className="flex items-center gap-2 px-3 py-2">
                <input
                  type="date"
                  defaultValue={task.due_date ?? ""}
                  aria-label="Due date"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    close();
                    apply({ type: "due", date: e.target.value });
                  }}
                  className="w-full rounded-lg border-0 bg-zinc-50 px-2 py-1 text-sm ring-1 ring-black/10"
                />
              </label>
              {task.due_date ? (
                <MenuItem
                  danger
                  onClick={() => {
                    close();
                    apply({ type: "due", date: null });
                  }}
                >
                  Clear date
                </MenuItem>
              ) : null}
            </div>
          )}
        </Popover>
      </Cell>
      <Cell className={WIDE}>
        <Block bg={PRIORITY[task.priority].bg} dim={done} onClick={() => apply({ type: "priority", priority: NEXT_PRIORITY[task.priority] })} title="Click to change priority">
          {PRIORITY[task.priority].label}
        </Block>
      </Cell>
      <Cell className={WIDE}>
        <Ago iso={task.created_at} />
      </Cell>
    </div>
  );
}

function MilestoneRowView({ m, color }: { m: MilestoneRow; color: string }) {
  const [done, setDone] = useOptimistic(m.done);
  const [, start] = useTransition();
  return (
    <div className={clsx(COLS, "group border-t border-zinc-100 bg-white hover:bg-zinc-50")}>
      <div className="flex min-w-0 items-center gap-2 border-l-[6px] py-1.5 pl-2 pr-2" style={{ borderColor: color }}>
        <span aria-hidden className="text-xs text-zinc-400">◆</span>
        <Renameable kind="milestone" id={m.id} value={m.title} className={clsx("min-w-0 flex-1 truncate text-sm", done && "text-zinc-400 line-through")} label="Rename milestone" />
        <button
          type="button"
          onClick={() => start(() => deleteMilestoneAction(m.id))}
          className="hidden shrink-0 text-xs text-zinc-300 opacity-0 hover:text-rose-600 group-hover:opacity-100 sm:inline"
          aria-label="Remove milestone"
        >
          ✕
        </button>
      </div>
      <Cell>
        <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Milestone</span>
      </Cell>
      <Cell>
        <Block
          bg={done ? "#00c875" : "#c4c4c4"}
          title={done ? "Reopen" : "Mark done"}
          onClick={() =>
            start(async () => {
              setDone(!done);
              await toggleMilestoneAction(m.id, !done);
            })
          }
        >
          {done ? "Done" : "Not started"}
        </Block>
      </Cell>
      <Cell className={WIDE}>
        <Empty />
      </Cell>
      <Cell className={WIDE}>
        <Empty />
      </Cell>
      <Cell className={WIDE}>
        <Ago iso={m.done_at} />
      </Cell>
    </div>
  );
}

/** A session as a board row; its status cell is a menu (see SessionStatusCell). */
export function SessionRowView({
  s,
  color,
  options,
  askId,
  unlink = true,
  where,
}: {
  s: SessionRow;
  color: string;
  options: OrgOptions;
  askId?: string;
  /** Offer "unlink" from its goal (goal boards only). */
  unlink?: boolean;
  /** Show the goal it works on under the title. */
  where?: { id: string; title: string } | null;
}) {
  const [, start] = useTransition();
  return (
    <div className={clsx(COLS, "group border-t border-zinc-100 bg-white hover:bg-zinc-50")}>
      <div className="flex min-w-0 items-center gap-2 border-l-[6px] py-1.5 pl-2 pr-2" style={{ borderColor: color }}>
        <span aria-hidden className="text-xs text-zinc-400">⚡</span>
        <div className="min-w-0 flex-1">
          <Link href={`/sessions/${s.id}`} className="block truncate text-sm hover:underline" title={s.summary ?? s.title}>
            {s.title}
          </Link>
          {where ? (
            <Link href={goalHref(where.id)} className="block truncate text-xs text-zinc-500 hover:underline">
              🎯 {where.title}
            </Link>
          ) : null}
        </div>
        <span className="shrink-0">
          <OpenSession url={s.url} resume={resumeFor(s)} small />
        </span>
        {unlink ? (
          <button
            type="button"
            onClick={() => start(() => linkSessionToGoalAction(s.id, null))}
            className="hidden shrink-0 text-xs text-zinc-300 opacity-0 hover:text-rose-600 group-hover:opacity-100 sm:inline"
            aria-label="Unlink session from goal"
          >
            unlink
          </button>
        ) : null}
      </div>
      <Cell>{s.agent_id ? <Owner agent={options.agents.find((a) => a.id === s.agent_id)} /> : <Empty />}</Cell>
      <Cell className="[&>div]:flex [&>div]:h-full [&>div]:w-full">
        <SessionStatusCell session={s} askId={askId} />
      </Cell>
      <Cell className={WIDE}>
        <Empty />
      </Cell>
      <Cell className={WIDE}>
        <Empty />
      </Cell>
      <Cell className={WIDE}>
        <Ago iso={s.last_activity_at} />
      </Cell>
    </div>
  );
}

// ---------- groups ----------

function AddRow({ color, projectId, goalId, linkable }: { color: string; projectId: string; goalId: string | null; linkable: SessionOption[] }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"todo" | "milestone">("todo");
  const [, start] = useTransition();
  const { toast } = useToast();
  return (
    <Row color={`${color}66`}>
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const title = text.trim();
          if (!title) return;
          setText("");
          start(async () => {
            if (kind === "milestone" && goalId) await addMilestoneAction(goalId, title);
            else {
              const r = await createTodoAction({ title, projectId, goalId });
              if (!r.ok) {
                setText(title);
                toast({ message: r.message, tone: "error" });
              }
            }
          });
        }}
      >
        {goalId ? (
          <select value={kind} onChange={(e) => setKind(e.target.value as "todo" | "milestone")} aria-label="What to add" className="rounded-md border-0 bg-transparent py-0.5 pl-1 pr-6 text-xs text-zinc-500">
            <option value="todo">+ To-do</option>
            <option value="milestone">+ Milestone</option>
          </select>
        ) : (
          <span className="pl-1 text-xs text-zinc-500">+ To-do</span>
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === "milestone" && goalId ? "Add a milestone" : "Add a to-do"}
          aria-label={kind === "milestone" && goalId ? "New milestone" : "New to-do"}
          className="min-w-0 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-0"
        />
      </form>
      {goalId && linkable.length ? (
        <select
          aria-label="Link a session"
          value=""
          onChange={(e) => e.target.value && start(() => linkSessionToGoalAction(e.target.value, goalId))}
          className="hidden max-w-48 rounded-md border-0 bg-transparent py-0.5 text-xs text-zinc-500 sm:block"
        >
          <option value="">⚡ Link a session…</option>
          {linkable.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
              {s.goal_id ? " (from another goal)" : ""}
            </option>
          ))}
        </select>
      ) : null}
    </Row>
  );
}

export function ColumnHeads({ color, label }: { color: string; label: React.ReactNode }) {
  return (
    <div className={clsx(COLS, "text-[11px] font-semibold text-zinc-500")}>
      <div className="flex min-w-0 items-center border-l-[6px] py-1.5 pl-2" style={{ borderColor: color }}>
        {label}
      </div>
      <Cell>Owner</Cell>
      <Cell>Status</Cell>
      <Cell className={WIDE}>Due</Cell>
      <Cell className={WIDE}>Priority</Cell>
      <Cell className={WIDE}>Updated</Cell>
    </div>
  );
}

function GoalGroup({
  view,
  color,
  todos,
  sessionOptions,
  options,
  comments,
  asks,
  standalone,
}: {
  view: GoalView;
  color: string;
  todos: TodoItem[];
  sessionOptions: SessionOption[];
  options: OrgOptions;
  comments: CommentRow[];
  asks: Record<string, string>;
  /** On the goal's own page: always open, notes shown, no link to itself. */
  standalone?: boolean;
}) {
  const { goal, team, milestones, sessions } = view;
  const [open, setOpen] = useState(standalone || goal.status === "active");
  const [editing, setEditing] = useState(false);
  const [talk, setTalk] = useState(!!standalone);
  const [pending, start] = useTransition();
  const pct = Math.round(view.progress * 100);
  const due = goal.status === "active" ? dueLabel(goal.due_date) : null;
  const count = milestones.length + todos.length + sessions.length;
  const st = GOAL_STATUS[goal.status];

  return (
    <section id={`goal-${goal.id}`} className={clsx("scroll-mt-6 target:rounded-xl target:ring-2 target:ring-amber-400", pending && "animate-pulse")}>
      {standalone ? (
        // The goal's own page already shows its title, status and progress above the board.
        <header className="flex items-center gap-2 pb-1">
          <h2 className="text-sm font-bold text-zinc-500">
            {count} item{count === 1 ? "" : "s"}
          </h2>
          <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-md px-1.5 text-xs text-zinc-500 hover:bg-zinc-100" aria-label="Edit goal">
              ✎
            </button>
            <button
              type="button"
              onClick={() => confirm(`Delete the goal “${goal.title}”? Linked sessions and to-dos are kept.`) && start(() => deleteGoalAction(goal.id))}
              className="rounded-md px-1.5 text-xs text-zinc-500 hover:bg-rose-50 hover:text-rose-600"
              aria-label="Delete goal"
            >
              🗑
            </button>
          </div>
        </header>
      ) : (
      <header className="group flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Collapse goal" : "Expand goal"} className="w-4 text-sm" style={{ color }}>
            {open ? "▾" : "▸"}
          </button>
          <h3 className="flex min-w-0 items-center gap-1 text-lg font-bold" style={{ color }}>
            <Renameable kind="goal" id={goal.id} value={goal.title} className="min-w-0" label="Rename goal" />
            {goal.priority === "high" ? <span className="text-xs" title="High priority">🔥</span> : null}
          </h3>
          {standalone ? null : (
            <Link href={goalHref(goal.id)} className="rounded-md px-1.5 text-xs font-semibold text-zinc-400 hover:bg-zinc-100 hover:text-ink" title="Open the goal's page">
              Open ↗
            </Link>
          )}
          <span className="text-xs text-zinc-400">
            {count} item{count === 1 ? "" : "s"}
            {team ? ` · ${team.name}` : ""}
          </span>
          <Popover label={st.label} className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white hover:brightness-110 ${st.cls}`} panelClassName="w-40" title="Goal status">
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
                    <span className="h-3 w-3 rounded-full" style={{ background: GOAL_STATUS[s].bg }} />
                    {GOAL_STATUS[s].label}
                  </MenuItem>
                ))}
              </div>
            )}
          </Popover>
          {due ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${due.tone}`}>due {due.text}</span> : null}
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden h-2 w-28 overflow-hidden rounded-full bg-zinc-100 sm:block" title={`${pct}% done`}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: "#00c875" }} />
            </div>
            <span className="text-xs font-bold text-zinc-500">{pct}%</span>
            <button type="button" onClick={() => setTalk((v) => !v)} className={clsx("rounded-md px-1.5 text-xs", talk ? "bg-ink text-paper" : "text-zinc-500 hover:bg-zinc-100")} aria-label="Notes on this goal">
              💬{comments.length ? ` ${comments.length}` : ""}
            </button>
            <button type="button" onClick={() => setEditing((v) => !v)} className="rounded-md px-1.5 text-xs text-zinc-500 hover:bg-zinc-100" aria-label="Edit goal">
              ✎
            </button>
            <button
              type="button"
              onClick={() => confirm(`Delete the goal “${goal.title}”? Linked sessions and to-dos are kept.`) && start(() => deleteGoalAction(goal.id))}
              className="rounded-md px-1.5 text-xs text-zinc-500 hover:bg-rose-50 hover:text-rose-600"
              aria-label="Delete goal"
            >
              🗑
            </button>
          </div>
        </header>
      )}

      {editing ? (
        <div className="mb-2 rounded-xl bg-white p-3 ring-2 ring-amber-300">
          <GoalForm
            projectId={goal.project_id}
            goalId={goal.id}
            teams={options.teams.filter((t) => t.project_id === goal.project_id)}
            initial={{ title: goal.title, description: goal.description, teamId: goal.team_id, dueDate: goal.due_date, priority: goal.priority }}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}
      {talk && !standalone ? (
        <div className="mb-2 rounded-xl bg-zinc-50 p-3">
          <CommentThread entity="goal" entityId={goal.id} initial={comments} title="Notes on this goal" />
        </div>
      ) : null}

      {open ? (
        <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
          <ColumnHeads color={color} label={goal.description ? <span className="truncate font-normal text-zinc-400">{goal.description}</span> : "Item"} />
          {milestones.map((m) => (
            <MilestoneRowView key={m.id} m={m} color={color} />
          ))}
          {todos.map((t) => (
            <TodoRow key={t.task.id} item={t} color={color} options={options} />
          ))}
          {sessions.map((s) => (
            <SessionRowView key={s.id} s={s} color={color} options={options} askId={asks[s.id]} />
          ))}
          <AddRow color={color} projectId={goal.project_id} goalId={goal.id} linkable={sessionOptions.filter((s) => s.goal_id !== goal.id)} />
        </div>
      ) : null}
      {standalone ? (
        <div className="mt-6 rounded-xl bg-white/60 p-3 ring-1 ring-black/5">
          <CommentThread entity="goal" entityId={goal.id} initial={comments} title="Notes on this goal" />
        </div>
      ) : null}
    </section>
  );
}

function NewGoalRow({ projectId }: { projectId: string }) {
  const [text, setText] = useState("");
  const { run, pending } = useBulkRunner();
  const lines = parseLines(text, 100);
  return (
    <form
      className="flex items-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!lines.length) return;
        const before = text;
        setText("");
        run(() => bulkAddGoalsAction(projectId, before), { onFailed: () => setText(before) });
      }}
    >
      <span className="text-sm font-bold text-zinc-400">+</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (!pasted.includes("\n")) return;
          // A pasted list becomes one goal per line.
          e.preventDefault();
          run(() => bulkAddGoalsAction(projectId, pasted));
        }}
        placeholder="Add a goal group (paste a list to add many)"
        aria-label="New goal"
        className="min-w-0 flex-1 border-0 bg-transparent text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-0"
      />
      <button disabled={!lines.length || pending} className="rounded-lg bg-ink px-3 py-1 text-xs font-bold text-paper disabled:opacity-30">
        Add
      </button>
    </form>
  );
}

export function GoalsTable({
  projectId,
  goals,
  todos,
  sessionOptions,
  options,
  comments,
  asks,
  single,
}: {
  projectId: string;
  goals: GoalView[];
  todos: TodoItem[];
  sessionOptions: SessionOption[];
  options: OrgOptions;
  comments: Record<string, CommentRow[]>;
  /** Open ask id by session id, so a session's "Needs you" can be cleared from its row. */
  asks: Record<string, string>;
  /** Just the one goal in `goals` (its own page): no "No goal" group, no new-goal row. */
  single?: boolean;
}) {
  const loose = todos.filter((t) => !t.task.goal_id);
  const looseColor = "#c4c4c4";
  if (single && goals[0]) {
    const g = goals[0];
    return (
      <GoalGroup
        view={g}
        color={GROUP_COLORS[0]}
        todos={todos.filter((t) => t.task.goal_id === g.goal.id)}
        sessionOptions={sessionOptions}
        options={options}
        comments={comments[g.goal.id] ?? []}
        asks={asks}
        standalone
      />
    );
  }
  return (
    <div className="space-y-6">
      {goals.map((g, i) => (
        <GoalGroup
          key={g.goal.id}
          view={g}
          color={GROUP_COLORS[i % GROUP_COLORS.length]}
          todos={todos.filter((t) => t.task.goal_id === g.goal.id)}
          sessionOptions={sessionOptions}
          options={options}
          comments={comments[g.goal.id] ?? []}
          asks={asks}
        />
      ))}

      <section>
        <header className="flex items-center gap-3 pb-1">
          <span className="w-4" />
          <h3 className="text-lg font-bold text-zinc-500">No goal</h3>
          <span className="text-xs text-zinc-400">
            {loose.length} to-do{loose.length === 1 ? "" : "s"}
          </span>
        </header>
        <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
          <ColumnHeads color={looseColor} label="Item" />
          {loose.map((t) => (
            <TodoRow key={t.task.id} item={t} color={looseColor} options={options} />
          ))}
          <AddRow color={looseColor} projectId={projectId} goalId={null} linkable={[]} />
        </div>
      </section>

      <NewGoalRow projectId={projectId} />
    </div>
  );
}
