"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { bulkSessionsAction, type BulkResult, type SessionOp } from "@/app/_actions/bulk";
import { timeAgo } from "@/lib/format";
import { resumeFor } from "@/lib/links";
import type { OrgOptions } from "@/lib/queries";
import type { SessionLite } from "@/lib/session-lite";
import { Character } from "../Character";
import { SourceBadge } from "../SourceBadge";
import { OpenSession } from "../asks/AskActions";
import { SessionStatusCell } from "../board/SessionStatusCell";
import { groupColor } from "../board/palette";
import { BAR_POPOVER, BarButton, BulkBar, SelectBox } from "../ui/BulkBar";
import { Leaving, markedClasses } from "../ui/Leaving";
import { OrgPicker, type Pick as Picked } from "../ui/Picker";
import { MenuItem, Popover } from "../ui/Popover";
import { Renameable } from "../ui/Renameable";
import { useBulkRunner } from "../ui/useBulk";
import { useLeavingList } from "../ui/useLeaving";
import { useSelection } from "../ui/useSelection";

const PAGE = 100;

/** ☐ · Session · Owner · Status · Last active (from md) · ⋯ — the same columns on every board. */
const COLS =
  "grid grid-cols-[2rem_minmax(0,1fr)_3rem_6.5rem_2.5rem] md:grid-cols-[2rem_minmax(0,1fr)_11rem_7.5rem_5.5rem_3rem]";

/** Which changes take a session out of this list (so it should animate away). */
export type ListScope = "all" | "unfiled" | "archived" | "agent" | "team" | "project";

function leavesList(scope: ListScope, op: SessionOp): boolean {
  if (op.type === "archive") return scope !== "archived";
  if (op.type === "unarchive") return scope === "archived";
  if (scope === "unfiled") return op.type === "assign" || op.type === "team";
  if (scope === "agent") return op.type !== "goal";
  if (scope === "team") return op.type === "assign" || op.type === "team" || op.type === "project" || op.type === "unassign" || op.type === "refile";
  if (scope === "project") return op.type === "project" || op.type === "refile";
  return false;
}

export function opForPick(p: Picked): SessionOp | null {
  if (p.kind === "person") return p.id ? { type: "assign", agentId: p.id } : { type: "unassign" };
  if (p.kind === "team") return p.id ? { type: "team", teamId: p.id } : { type: "unassign" };
  if (p.kind === "project") return { type: "project", projectId: p.id };
  if (p.kind === "goal") return { type: "goal", goalId: p.id };
  return null;
}

export function SessionBoard({
  sessions,
  options,
  scope = "all",
  empty = "No sessions match.",
  commentCounts = {},
  asks = {},
  groupBy,
}: {
  sessions: SessionLite[];
  options: OrgOptions;
  scope?: ListScope;
  empty?: string;
  commentCounts?: Record<string, number>;
  /** Open ask id by session id, so "Needs you" shows (and can be cleared) on the right rows. */
  asks?: Record<string, string>;
  /** Group rows into one table per project; defaults to on for lists that span projects. */
  groupBy?: "project" | "none";
}) {
  const list = useLeavingList(sessions, (s) => s.id);
  const [limit, setLimit] = useState(PAGE);
  const liveIds = useMemo(() => list.visible.filter((s) => !list.leavingIds.has(s.id)).map((s) => s.id), [list.visible, list.leavingIds]);
  const sel = useSelection(liveIds);
  const { run } = useBulkRunner();

  const apply = (ids: string[], op: SessionOp, message?: (r: BulkResult) => string) => {
    if (!ids.length) return;
    const leaving = leavesList(scope, op);
    if (leaving) {
      list.leave(ids, "move");
      sel.remove(ids);
    }
    run(() => bulkSessionsAction(ids, op), {
      message,
      onFailed: () => leaving && list.restore(ids),
      onUndone: () => leaving && list.restore(ids),
    });
  };

  const agents = useMemo(() => new Map(options.agents.map((a) => [a.id, a])), [options.agents]);
  const teams = useMemo(() => new Map(options.teams.map((t) => [t.id, t])), [options.teams]);
  const projects = useMemo(() => new Map(options.projects.map((p) => [p.id, p])), [options.projects]);
  const goals = useMemo(() => new Map(options.goals.map((g) => [g.id, g])), [options.goals]);

  if (!list.visible.length) return <p className="rounded-2xl bg-white p-6 text-sm text-zinc-500 ring-1 ring-black/5">{empty}</p>;

  const allSelected = liveIds.length > 0 && liveIds.every((id) => sel.has(id));
  const grouping = groupBy ?? (scope === "all" || scope === "unfiled" || scope === "archived" ? "project" : "none");
  const shown = list.visible.slice(0, limit);
  const groups: { key: string; label: string; items: SessionLite[] }[] = [];
  for (const s of shown) {
    const project = grouping === "project" ? projects.get(s.project_id ?? teams.get(s.team_id ?? "")?.project_id ?? "") : undefined;
    const key = grouping === "project" ? (project?.id ?? "none") : "all";
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, label: grouping === "project" ? (project ? `${project.emoji} ${project.name}` : "No project") : "", items: [] }));
    g.items.push(s);
  }

  const row = (s: SessionLite, color: string) => {
    const { phase, effect } = list.phaseOf(s.id);
    const agent = s.agent_id ? agents.get(s.agent_id) : undefined;
    const team = teams.get(agent?.team_id ?? s.team_id ?? "");
    const project = projects.get(s.project_id ?? team?.project_id ?? "");
    const goal = s.goal_id ? goals.get(s.goal_id) : undefined;
    const selected = sel.has(s.id);
    return (
      <Leaving key={s.id} phase={phase} as="li">
        <div className={clsx(COLS, "group relative border-t border-zinc-100 bg-white hover:bg-zinc-50", selected && "bg-amber-50 hover:bg-amber-50", markedClasses(phase, effect))}>
          <div className="flex items-center justify-center border-l-[6px]" style={{ borderColor: color }}>
            <SelectBox checked={selected} onToggle={(shift) => sel.toggle(s.id, { shift })} label={`Select “${s.title}”`} className="h-3.5 w-3.5 cursor-pointer accent-amber-500" />
          </div>
          <div className="min-w-0 py-1.5 pl-2 pr-2">
            <div className="flex min-w-0 items-center gap-2">
              <Renameable kind="session" id={s.id} value={s.title} className="min-w-0 text-sm font-semibold" label={`Rename “${s.title}”`} />
              <Link href={`/sessions/${s.id}`} className="shrink-0 text-xs font-semibold text-orange-700 hover:underline">
                details →
              </Link>
              <span className="ml-auto shrink-0">
                <OpenSession url={s.url} resume={resumeFor(s)} small />
              </span>
              {commentCounts[s.id] ? (
                <Link href={`/sessions/${s.id}#comments`} className="shrink-0 rounded-full bg-zinc-100 px-1.5 text-[11px] font-bold text-zinc-600 hover:bg-zinc-200" title="Comments">
                  💬 {commentCounts[s.id]}
                </Link>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-zinc-400">
              <SourceBadge source={s.source} />
              {s.account && s.account !== "claude" ? (
                <span className="rounded-full bg-violet-100 px-1.5 font-semibold text-violet-700" title="Claude account">
                  {s.account}
                </span>
              ) : null}
              {s.repo ? <span className="font-mono">{s.repo}</span> : null}
              {goal ? <span className="truncate font-semibold text-zinc-500">🎯 {goal.title}</span> : null}
              {s.summary && s.summary !== s.title ? <span className="truncate">{s.summary}</span> : null}
            </div>
          </div>
          <div className="flex min-w-0 items-center border-l border-zinc-100 px-1">
            <Popover
              label={
                agent ? (
                  <span className="flex min-w-0 items-center gap-2 text-left">
                    <Character spec={agent.avatar} pose="idle" desk={false} size={28} />
                    <span className="hidden min-w-0 md:block">
                      <span className="block truncate text-xs font-bold">{agent.name}</span>
                      <span className="block truncate text-[11px] text-zinc-500">{team?.name}</span>
                    </span>
                  </span>
                ) : (
                  <span className="block text-left text-xs font-bold text-amber-700">
                    <span className="md:hidden">—</span>
                    <span className="hidden md:inline">Unfiled</span>
                    {project && grouping !== "project" ? <span className="hidden truncate text-[11px] font-normal text-zinc-500 md:block">{`${project.emoji} ${project.name}`}</span> : null}
                  </span>
                )
              }
              title="Reassign"
              className="w-full min-w-0 rounded-lg px-1 py-1 hover:bg-zinc-100"
              panelClassName="w-80"
              floating
            >
              {(close) => (
                <OrgPicker
                  options={options}
                  kinds={["person", "team", "project"]}
                  none={{ kind: "person", label: "🚫 Unassign (keep the project)" }}
                  onPick={(p) => {
                    close();
                    const op = opForPick(p);
                    if (op) apply([s.id], op);
                  }}
                />
              )}
            </Popover>
          </div>
          <div className="flex items-stretch border-l border-white [&>div]:flex [&>div]:w-full">
            <SessionStatusCell session={{ ...s, status: s.claude_status }} askId={asks[s.id]} />
          </div>
          <div className="hidden items-center justify-center border-l border-zinc-100 text-[11px] text-zinc-500 md:flex">{timeAgo(s.last_activity_at)}</div>
          <div className="flex items-center justify-center border-l border-zinc-100">
            <Popover label="⋯" title="Session actions" align="right" floating className="rounded-lg px-2 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100">
              {(close) => {
                const item = (label: string, op: SessionOp) => (
                  <MenuItem
                    key={label}
                    onClick={() => {
                      close();
                      apply([s.id], op);
                    }}
                  >
                    {label}
                  </MenuItem>
                );
                return (
                  <>
                    {s.goal_id ? item("Unlink from goal", { type: "goal", goalId: null }) : null}
                    {s.agent_id ? item("Unassign teammate", { type: "unassign" }) : null}
                    {s.project_id ? item("Remove from project", { type: "project", projectId: null }) : null}
                    {!s.archived ? item("🔄 Re-file with AI", { type: "refile" }) : null}
                    {s.archived ? item("Unarchive", { type: "unarchive" }) : item("🗄️ Archive (hide everywhere)", { type: "archive" })}
                  </>
                );
              }}
            </Popover>
          </div>
        </div>
      </Leaving>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 px-2 text-xs font-semibold text-zinc-500">
        <input
          type="checkbox"
          aria-label="Select all sessions"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = sel.size > 0 && !allSelected;
          }}
          onChange={() => (allSelected ? sel.clear() : sel.selectAll())}
          className="h-4 w-4 cursor-pointer accent-amber-500"
        />
        <span>
          {liveIds.length} session{liveIds.length === 1 ? "" : "s"} · shift-click to select a range
        </span>
      </div>
      {groups.map((g, gi) => {
        const color = groupColor(gi);
        const ids = g.items.filter((x) => !list.leavingIds.has(x.id)).map((x) => x.id);
        const all = ids.length > 0 && ids.every((id) => sel.has(id));
        return (
          <section key={g.key}>
            {g.label ? (
              <h3 className="flex items-center gap-2 px-1 pb-1 text-lg font-bold" style={{ color }}>
                {g.label} <span className="text-xs font-semibold text-zinc-400">{ids.length}</span>
              </h3>
            ) : null}
            <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
              <div className={clsx(COLS, "text-[11px] font-semibold text-zinc-500")}>
                <div className="flex items-center justify-center border-l-[6px]" style={{ borderColor: color }}>
                  <input
                    type="checkbox"
                    aria-label={`Select all in ${g.label || "this list"}`}
                    checked={all}
                    onChange={() => (all ? sel.remove(ids) : sel.selectAll([...sel.ids, ...ids]))}
                    className="h-3.5 w-3.5 cursor-pointer accent-amber-500"
                  />
                </div>
                <div className="py-1.5 pl-2">Session</div>
                <div className="flex items-center border-l border-white px-2">Owner</div>
                <div className="flex items-center justify-center border-l border-white">Status</div>
                <div className="hidden items-center justify-center border-l border-white md:flex">Last active</div>
                <div className="border-l border-white" />
              </div>
              <ul>{g.items.map((s) => row(s, color))}</ul>
            </div>
          </section>
        );
      })}
      {list.visible.length > limit ? (
        <div className="flex justify-center">
          <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="rounded-xl bg-white px-4 py-2 text-sm font-bold ring-1 ring-black/10 hover:bg-zinc-50">
            Show {Math.min(PAGE, list.visible.length - limit)} more · {list.visible.length - limit} left
          </button>
        </div>
      ) : null}

      <BulkBar
        count={sel.size}
        noun={["session", "sessions"]}
        onClear={sel.clear}
        extra={
          sel.size < liveIds.length ? (
            <button type="button" onClick={() => sel.selectAll()} className="rounded-lg px-2 py-1 text-xs font-bold text-amber-300 hover:bg-white/10">
              Select all {liveIds.length}
            </button>
          ) : null
        }
      >
        <Popover label="👤 Assign…" side="top" className={BAR_POPOVER} panelClassName="w-80">
          {(close) => (
            <OrgPicker
              options={options}
              kinds={["person", "team", "project"]}
              none={{ kind: "person", label: "🚫 Unassign (keep their projects)" }}
              onPick={(p) => {
                close();
                const op = opForPick(p);
                if (op) apply(sel.ids, op);
              }}
            />
          )}
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
        {scope === "archived" ? (
          <BarButton onClick={() => apply(sel.ids, { type: "unarchive" })}>↩ Unarchive</BarButton>
        ) : (
          <>
            <BarButton onClick={() => apply(sel.ids, { type: "refile" })} title="Clear their filing and let the organiser place them again">
              🔄 Re-file with AI
            </BarButton>
            <BarButton tone="danger" onClick={() => apply(sel.ids, { type: "archive" })}>
              🗄️ Archive
            </BarButton>
          </>
        )}
      </BulkBar>
    </div>
  );
}
