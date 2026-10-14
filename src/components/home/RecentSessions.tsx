"use client";

import Link from "next/link";
import type { OrgOptions } from "@/lib/queries";
import type { SessionRow } from "@/lib/types";
import { ColumnHeads, SessionRowView } from "../goals/GoalsTable";
import { groupColor } from "../board/palette";

/** The latest sessions as a small board, so home shows what Claude touched last. */
export function RecentSessions({
  sessions,
  options,
  asks,
  goals,
}: {
  sessions: SessionRow[];
  options: OrgOptions;
  /** Open ask id by session id. */
  asks: Record<string, string>;
  /** Goal titles by id, so a row can say what it works on. */
  goals: Record<string, string>;
}) {
  if (!sessions.length) return null;
  const color = groupColor(0);
  return (
    <section>
      <header className="flex items-center gap-3 pb-1">
        <h2 className="text-lg font-bold" style={{ color }}>
          Recent sessions
        </h2>
        <Link href="/sessions" className="text-xs text-zinc-400 hover:underline">
          See all →
        </Link>
      </header>
      <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
        <ColumnHeads color={color} label="Session" />
        {sessions.map((s) => (
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
      </div>
    </section>
  );
}
