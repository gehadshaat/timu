"use client";

import Link from "next/link";
import { useState } from "react";
import { personHref } from "@/lib/links";
import type { OrgOptions, TodoItem } from "@/lib/queries";
import type { SessionRow } from "@/lib/types";
import { Character } from "../Character";
import { ColumnHeads, SessionRowView, TodoRow } from "../goals/GoalsTable";
import { groupColor } from "./palette";

/**
 * A team's work as a board: a group per teammate, their to-dos and sessions as rows, the same
 * columns and click-to-change cells as every other board.
 */

export interface PersonGroup {
  agent: { id: string; name: string; role: string; avatar: OrgOptions["agents"][number]["avatar"] };
  sessions: SessionRow[];
  todos: TodoItem[];
}

export function PeopleWorkBoard({
  people,
  options,
  asks,
  goals,
}: {
  people: PersonGroup[];
  options: OrgOptions;
  /** Open ask id by session id. */
  asks: Record<string, string>;
  /** Goal titles by id, so a session row can say what it works on. */
  goals: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      {people.map((p, i) => (
        <PersonGroupView key={p.agent.id} person={p} color={groupColor(i)} options={options} asks={asks} goals={goals} />
      ))}
    </div>
  );
}

function PersonGroupView({ person, color, options, asks, goals }: { person: PersonGroup; color: string; options: OrgOptions; asks: Record<string, string>; goals: Record<string, string> }) {
  const waiting = person.sessions.filter((s) => asks[s.id]).length;
  const [open, setOpen] = useState(true);
  const count = person.sessions.length + person.todos.length;
  return (
    <section>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Collapse" : "Expand"} className="w-4 text-sm" style={{ color }}>
          {open ? "▾" : "▸"}
        </button>
        <Character spec={person.agent.avatar} pose={waiting ? "needs_you" : "working"} desk={false} size={30} />
        <Link href={personHref(person.agent.id)} className="text-lg font-bold hover:underline" style={{ color }}>
          {person.agent.name}
        </Link>
        <span className="text-xs text-zinc-400">
          {person.agent.role} · {count} item{count === 1 ? "" : "s"}
        </span>
        {waiting ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">🙋 {waiting} waiting on you</span> : null}
      </header>
      {open ? (
        <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
          <ColumnHeads color={color} label="Item" />
          {person.todos.map((t) => (
            <TodoRow key={t.task.id} item={t} color={color} options={options} where />
          ))}
          {person.sessions.map((s) => (
            <SessionRowView
              key={s.id}
              s={s}
              color={color}
              options={options}
              askId={asks[s.id]}
              unlink={false}
              where={s.goal_id && goals[s.goal_id] ? { id: s.goal_id, title: goals[s.goal_id] } : null}
            />
          ))}
          {!count ? <p className="border-t border-zinc-100 bg-white px-4 py-3 text-sm text-zinc-400">Nothing on {person.agent.name}&apos;s plate.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
