"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { bulkTodosAction, type TodoOp } from "@/app/_actions/bulk";
import { dueLabel } from "@/lib/format";
import { personHref, projectHref } from "@/lib/links";
import { isoDate } from "@/lib/quickadd";
import type { OrgOptions, TodoItem } from "@/lib/queries";
import type { TaskStatus } from "@/lib/types";
import { Character } from "./Character";
import { TodoForm } from "./TodoForm";
import { BAR_POPOVER, BarButton, BulkBar, SelectBox } from "./ui/BulkBar";
import { Leaving, LeaveStamp, markedClasses } from "./ui/Leaving";
import { OrgPicker } from "./ui/Picker";
import { MenuItem, Popover } from "./ui/Popover";
import { useBulkRunner } from "./ui/useBulk";
import { useLeavingList, type LeaveEffect, type LeavePhase } from "./ui/useLeaving";
import { useSelection } from "./ui/useSelection";

function addDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function nextFriday() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return isoDate(d);
}

function Row({
  item,
  options,
  showProject,
  phase,
  effect,
  selected,
  selecting,
  onSelect,
  onToggle,
  onDelete,
}: {
  item: TodoItem;
  options: OrgOptions;
  showProject: boolean;
  phase: LeavePhase;
  effect: LeaveEffect;
  selected: boolean;
  selecting: boolean;
  onSelect: (shift: boolean) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { task, agent, project, goal } = item;
  const [editing, setEditing] = useState(false);
  const marked = phase !== "idle";
  const done = task.status === "done";
  const due = done ? null : dueLabel(task.due_date);

  if (editing) {
    return (
      <div className="rounded-xl bg-white p-3 ring-2 ring-amber-300">
        <TodoForm
          options={options}
          taskId={task.id}
          initial={{ title: task.title, agentId: task.agent_id, projectId: task.project_id, goalId: task.goal_id, dueDate: task.due_date, priority: task.priority }}
          onDone={() => setEditing(false)}
        />
        <button type="button" onClick={() => setEditing(false)} className="mt-1 text-xs text-zinc-500">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "group relative flex items-center gap-2.5 rounded-xl bg-white px-3 py-2 ring-1 ring-black/5 transition",
        selected && !marked && "bg-amber-50 ring-2 ring-amber-300",
        markedClasses(phase, effect),
      )}
    >
      <span className={clsx("transition", selecting || selected ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100")}>
        <SelectBox checked={selected} onToggle={onSelect} label={`Select “${task.title}”`} className="h-3.5 w-3.5 cursor-pointer accent-amber-500" />
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={marked}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={clsx(
          "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black transition",
          done ? "bg-emerald-500 text-white" : "ring-2 ring-zinc-300 hover:bg-emerald-50 hover:ring-emerald-400",
        )}
      >
        {done ? "✓" : ""}
      </button>
      {agent ? (
        <span className="shrink-0" title={`${agent.name}, ${agent.role}`}>
          <Character spec={agent.avatar} pose={marked && effect === "done" ? "done" : "working"} desk={false} size={32} />
        </span>
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-sm" title="You">
          👤
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={clsx("truncate text-sm font-semibold", done && !marked && "text-zinc-400 line-through")}>
          {task.priority === "high" && !done ? "🔥 " : ""}
          <span className={clsx("strike", marked && (effect === "done" || effect === "dismiss") && "strike-on")}>{task.title}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
          {agent ? (
            <Link href={personHref(agent.id)} className="hover:underline">
              {agent.name}
            </Link>
          ) : (
            <span>You</span>
          )}
          {showProject && project ? (
            <Link href={projectHref(project.slug)} className="hover:underline">
              · {project.emoji} {project.name}
            </Link>
          ) : null}
          {goal ? <span>· 🎯 {goal.title}</span> : null}
          {task.priority === "low" && !done ? <span>· low</span> : null}
        </div>
      </div>
      {due ? <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${due.tone}`}>{due.text}</span> : null}
      {marked ? (
        <LeaveStamp phase={phase} effect={effect} size="sm" />
      ) : (
        <div className="flex shrink-0 gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
          <button type="button" onClick={() => setEditing(true)} className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-100" aria-label="Edit">
            ✎
          </button>
          <button type="button" onClick={onDelete} className="rounded px-1.5 text-xs text-zinc-500 hover:bg-rose-50 hover:text-rose-600" aria-label="Delete">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * To-dos with a satisfying "done": tick one and it flashes green, strikes through and
 * folds away (Undo in the toast). Select several (shift-click for a range) to finish,
 * reassign, reschedule, re-prioritise, link to a goal or delete them together.
 */
export function TodoList({
  items,
  options,
  showProject = true,
  empty = "Nothing to do. Nice.",
  groupByAgent = false,
  keepDone = false,
}: {
  items: TodoItem[];
  options: OrgOptions;
  showProject?: boolean;
  empty?: string;
  /** Sections: yours first, then each teammate. */
  groupByAgent?: boolean;
  /** The list shows finished to-dos too: ticking one keeps it (struck through) instead of folding it away. */
  keepDone?: boolean;
}) {
  const list = useLeavingList(items, (t) => t.task.id);
  const liveIds = useMemo(() => list.visible.filter((t) => !list.leavingIds.has(t.task.id)).map((t) => t.task.id), [list.visible, list.leavingIds]);
  const sel = useSelection(liveIds);
  const { run } = useBulkRunner();
  // Optimistic status while the server catches up.
  const [override, setOverride] = useState<Record<string, TaskStatus>>({});
  const statusOf = (t: TodoItem) => override[t.task.id] ?? t.task.status;
  const setStatus = (ids: string[], status: TaskStatus | null) =>
    setOverride((o) => {
      const next = { ...o };
      for (const id of ids) {
        if (status) next[id] = status;
        else delete next[id];
      }
      return next;
    });

  const apply = (ids: string[], op: TodoOp, effect?: LeaveEffect) => {
    if (!ids.length) return;
    // In a list that shows finished to-dos, "done" flashes and stays.
    const keep = effect === "done" && keepDone;
    if (effect) {
      list.leave(ids, effect, { keep });
      if (!keep) sel.remove(ids);
    }
    if (op.type === "done" || op.type === "open") setStatus(ids, op.type === "done" ? "done" : "open");
    run(() => bulkTodosAction(ids, op), {
      onOk: () => setStatus(ids, null),
      onFailed: () => {
        setStatus(ids, null);
        if (effect && !keep) list.restore(ids);
      },
      onUndone: () => effect && !keep && list.restore(ids),
    });
  };

  const toggle = (item: TodoItem) => {
    if (statusOf(item) === "done") apply([item.task.id], { type: "open" });
    else apply([item.task.id], { type: "done" }, "done");
  };

  const groups = useMemo(() => {
    if (!groupByAgent) return [{ key: "all", agent: null as TodoItem["agent"], project: null as TodoItem["project"], items: list.visible }];
    const out = new Map<string, { key: string; agent: TodoItem["agent"]; project: TodoItem["project"]; items: TodoItem[] }>();
    out.set("me", { key: "me", agent: null, project: null, items: [] });
    for (const t of list.visible) {
      const key = t.agent?.id ?? "me";
      if (!out.has(key)) out.set(key, { key, agent: t.agent, project: t.project, items: [] });
      out.get(key)!.items.push(t);
    }
    return [...out.values()].filter((g) => g.items.length || g.key === "me");
  }, [groupByAgent, list.visible]);

  if (!list.visible.length && !groupByAgent) {
    return <p className="rounded-xl bg-white/60 px-3 py-2 text-sm text-zinc-500 ring-1 ring-black/5">{empty}</p>;
  }

  const renderRows = (rows: TodoItem[]) => (
    <ul className="space-y-1.5">
      {rows.map((it) => {
        const { phase, effect } = list.phaseOf(it.task.id);
        return (
          <Leaving key={it.task.id} phase={phase} as="li" className="board-row">
            <Row
              item={override[it.task.id] ? { ...it, task: { ...it.task, status: override[it.task.id] } } : it}
              options={options}
              showProject={showProject}
              phase={phase}
              effect={effect}
              selected={sel.has(it.task.id)}
              selecting={sel.size > 0}
              onSelect={(shift) => sel.toggle(it.task.id, { shift })}
              onToggle={() => toggle(it)}
              onDelete={() => apply([it.task.id], { type: "delete" }, "dismiss")}
            />
          </Leaving>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-5">
      {groups.map((g) =>
        groupByAgent ? (
          <section key={g.key} className="space-y-2">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold">
              {g.agent ? (
                <>
                  <Character spec={g.agent.avatar} pose="working" desk={false} size={40} />
                  <Link href={personHref(g.agent.id)} className="hover:underline">
                    {g.agent.name}
                  </Link>
                  <span className="text-sm font-semibold text-zinc-400">· {g.agent.role}</span>
                </>
              ) : (
                <>👤 Yours</>
              )}
              <span className="text-sm font-semibold text-zinc-400">· {g.items.length}</span>
            </h2>
            {g.items.length ? renderRows(g.items) : <p className="rounded-xl bg-white/60 px-3 py-2 text-sm text-zinc-500 ring-1 ring-black/5">{empty}</p>}
          </section>
        ) : (
          <div key={g.key}>{renderRows(g.items)}</div>
        ),
      )}

      <BulkBar
        count={sel.size}
        noun={["to-do", "to-dos"]}
        onClear={sel.clear}
        extra={
          sel.size < liveIds.length ? (
            <button type="button" onClick={() => sel.selectAll()} className="rounded-lg px-2 py-1 text-xs font-bold text-amber-300 hover:bg-white/10">
              Select all {liveIds.length}
            </button>
          ) : null
        }
      >
        <BarButton tone="good" onClick={() => apply(sel.ids, { type: "done" }, "done")}>
          ✓ Done
        </BarButton>
        <Popover label="👤 Assign…" side="top" className={BAR_POPOVER} panelClassName="w-80">
          {(close) => (
            <OrgPicker
              options={options}
              kinds={["person"]}
              none={{ kind: "person", label: "👤 Me" }}
              placeholder="Search people…"
              onPick={(p) => {
                close();
                apply(sel.ids, { type: "assign", agentId: p.id });
              }}
            />
          )}
        </Popover>
        <Popover label="📅 Due…" side="top" className={BAR_POPOVER} panelClassName="w-48">
          {(close) => (
            <>
              {(
                [
                  ["Today", addDays(0)],
                  ["Tomorrow", addDays(1)],
                  ["Friday", nextFriday()],
                  ["Next week", addDays(7)],
                  ["No date", null],
                ] as [string, string | null][]
              ).map(([label, date]) => (
                <MenuItem
                  key={label}
                  onClick={() => {
                    close();
                    apply(sel.ids, { type: "due", date });
                  }}
                >
                  {label}
                </MenuItem>
              ))}
              <label className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500">
                Pick
                <input
                  type="date"
                  aria-label="Due date"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    close();
                    apply(sel.ids, { type: "due", date: e.target.value });
                  }}
                  className="min-w-0 flex-1 rounded-md border-0 bg-zinc-50 px-1 py-0.5 text-xs ring-1 ring-black/10"
                />
              </label>
            </>
          )}
        </Popover>
        <Popover label="🔥 Priority…" side="top" className={BAR_POPOVER} panelClassName="w-40">
          {(close) =>
            (
              [
                ["🔥 High", "high"],
                ["Normal", "normal"],
                ["Low", "low"],
              ] as const
            ).map(([label, priority]) => (
              <MenuItem
                key={priority}
                onClick={() => {
                  close();
                  apply(sel.ids, { type: "priority", priority });
                }}
              >
                {label}
              </MenuItem>
            ))
          }
        </Popover>
        <Popover label="🎯 Goal…" side="top" className={BAR_POPOVER} panelClassName="w-80">
          {(close) => (
            <OrgPicker
              options={options}
              kinds={["goal"]}
              none={{ kind: "goal", label: "🚫 No goal" }}
              placeholder="Search goals…"
              onPick={(p) => {
                close();
                apply(sel.ids, { type: "goal", goalId: p.id });
              }}
            />
          )}
        </Popover>
        <BarButton tone="danger" onClick={() => apply(sel.ids, { type: "delete" }, "dismiss")}>
          🗑 Delete
        </BarButton>
      </BulkBar>
    </div>
  );
}
