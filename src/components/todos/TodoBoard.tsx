"use client";

import { useState } from "react";
import type { OrgOptions, TodoItem } from "@/lib/queries";
import { isoDate } from "@/lib/quickadd";
import { ColumnHeads, TodoRow } from "../goals/GoalsTable";

/**
 * To-dos as a board, grouped by when they're due: Overdue, Today,
 * This week, Later, No date — and Done when finished ones are shown. Rows are the same to-do
 * rows as on project boards: click a cell to tick, reassign, reschedule or re-prioritise.
 */

const BUCKETS = [
  { key: "overdue", label: "Overdue", color: "#e2445c" },
  { key: "today", label: "Today", color: "#fdab3d" },
  { key: "week", label: "This week", color: "#579bfc" },
  { key: "later", label: "Later", color: "#a25ddc" },
  { key: "none", label: "No date", color: "#c4c4c4" },
  { key: "done", label: "Done", color: "#00c875" },
] as const;
type Bucket = (typeof BUCKETS)[number]["key"];

function bucketOf(t: TodoItem, today: string, weekEnd: string): Bucket {
  if (t.task.status === "done") return "done";
  const due = t.task.due_date;
  if (!due) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  return due <= weekEnd ? "week" : "later";
}

export function TodoBoard({ items, options, empty }: { items: TodoItem[]; options: OrgOptions; empty: string }) {
  const [{ today, weekEnd }] = useState(() => {
    const d = new Date();
    const end = new Date(d);
    end.setDate(d.getDate() + 7);
    return { today: isoDate(d), weekEnd: isoDate(end) };
  });
  const [closed, setClosed] = useState<Record<string, boolean>>({ done: true });
  const groups = BUCKETS.map((b) => ({ ...b, items: items.filter((t) => bucketOf(t, today, weekEnd) === b.key) })).filter((g) => g.items.length);

  if (!items.length) return <p className="rounded-3xl border-2 border-dashed border-zinc-300 p-10 text-center text-zinc-500">{empty}</p>;

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const open = !closed[g.key];
        return (
          <section key={g.key}>
            <header className="flex items-center gap-3 pb-1">
              <button
                type="button"
                onClick={() => setClosed((c) => ({ ...c, [g.key]: open }))}
                aria-expanded={open}
                aria-label={open ? `Collapse ${g.label}` : `Expand ${g.label}`}
                className="w-4 text-sm"
                style={{ color: g.color }}
              >
                {open ? "▾" : "▸"}
              </button>
              <h2 className="text-lg font-bold" style={{ color: g.color }}>
                {g.label}
              </h2>
              <span className="text-xs text-zinc-400">
                {g.items.length} to-do{g.items.length === 1 ? "" : "s"}
              </span>
            </header>
            {open ? (
              <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
                <ColumnHeads color={g.color} label="To-do" />
                {g.items.map((t) => (
                  <TodoRow key={t.task.id} item={t} color={g.color} options={options} where />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
