"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { bulkAgentsAction, bulkHireAction } from "@/app/_actions/bulk";
import { POSE_LABEL, type Pose } from "@/lib/avatar";
import { personHref } from "@/lib/links";
import type { OrgOptions } from "@/lib/queries";
import { parsePersonLine } from "@/lib/quickadd";
import type { AgentRow } from "@/lib/types";
import { POSE_TONE } from "../board/palette";
import { Character } from "../Character";
import { DeleteDialog } from "../DeleteDialog";
import { EntityDialog } from "../EntityDialog";
import { BAR_POPOVER, BarButton, BulkBar, SelectBox } from "../ui/BulkBar";
import { OrgPicker } from "../ui/Picker";
import { Popover } from "../ui/Popover";
import { Renameable } from "../ui/Renameable";
import { useBulkRunner } from "../ui/useBulk";
import { useSelection } from "../ui/useSelection";

/** ☐ · Teammate · Role (from md) · Status · Sessions (from sm) · actions. */
const COLS = "grid grid-cols-[2rem_minmax(0,1fr)_6.5rem_5.5rem] sm:grid-cols-[2rem_minmax(0,1fr)_7rem_5rem_6.5rem] md:grid-cols-[2rem_minmax(0,1fr)_12rem_7rem_5rem_6.5rem]";

export interface PersonCard {
  agent: AgentRow;
  pose: Pose;
  sessions: number;
}

/** A team's people: rename in place, select several to move or remove, hire several at once. */
export function PeopleBoard({
  teamId,
  people,
  options,
  teamChoices,
  moveTargets,
}: {
  teamId: string;
  people: PersonCard[];
  options: OrgOptions;
  teamChoices: { id: string; label: string }[];
  /** Who can take over a removed teammate's sessions. */
  moveTargets: { id: string; label: string }[];
}) {
  const ids = useMemo(() => people.map((p) => p.agent.id), [people]);
  const sel = useSelection(ids);
  const { run, pending } = useBulkRunner();
  const [hiring, setHiring] = useState(false);
  const [text, setText] = useState("");
  const parsed = text
    .split(/\r?\n/)
    .map(parsePersonLine)
    .filter((p): p is { name: string; role: string } => !!p);

  return (
    <div className="space-y-3">
      {people.length ? (
        <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
          <div className={clsx(COLS, "text-[11px] font-semibold text-zinc-500")}>
            <div className="flex items-center justify-center border-l-[6px] border-[#579bfc]">
              <input
                type="checkbox"
                aria-label="Select everyone"
                checked={sel.size > 0 && sel.size === ids.length}
                onChange={() => (sel.size === ids.length ? sel.clear() : sel.selectAll())}
                className="h-3.5 w-3.5 cursor-pointer accent-amber-500"
              />
            </div>
            <div className="py-1.5 pl-2">Teammate</div>
            <div className="hidden items-center border-l border-white px-2 md:flex">Role</div>
            <div className="flex items-center justify-center border-l border-white">Status</div>
            <div className="hidden items-center justify-center border-l border-white sm:flex">Sessions</div>
            <div className="border-l border-white" />
          </div>
          <ul>
            {people.map((m) => {
              const selected = sel.has(m.agent.id);
              return (
                <li key={m.agent.id} className={clsx(COLS, "group border-t border-zinc-100 bg-white hover:bg-zinc-50", selected && "bg-amber-50 hover:bg-amber-50")}>
                  <div className="flex items-center justify-center border-l-[6px] border-[#579bfc]">
                    <SelectBox checked={selected} onToggle={(shift) => sel.toggle(m.agent.id, { shift })} label={`Select ${m.agent.name}`} className="h-3.5 w-3.5 cursor-pointer accent-amber-500" />
                  </div>
                  <div className="flex min-w-0 items-center gap-2 py-1.5 pl-2 pr-2">
                    <Character spec={m.agent.avatar} pose={m.pose} desk={false} size={32} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Renameable kind="agent" id={m.agent.id} value={m.agent.name} className="min-w-0 text-sm font-bold" label={`Rename ${m.agent.name}`} />
                        <Link href={personHref(m.agent.id)} className="shrink-0 text-xs font-semibold text-orange-700 hover:underline">
                          open →
                        </Link>
                      </div>
                      <div className="truncate text-xs text-zinc-500 md:hidden">{m.agent.role}</div>
                    </div>
                  </div>
                  <div className="hidden min-w-0 items-center border-l border-zinc-100 px-2 text-xs text-zinc-600 md:flex">
                    <span className="truncate">{m.agent.role}</span>
                  </div>
                  <div className="flex items-stretch border-l border-white">
                    <span className={clsx("flex w-full items-center justify-center px-1 text-center text-xs font-bold text-white", POSE_TONE[m.pose] ?? POSE_TONE.idle)}>{POSE_LABEL[m.pose]}</span>
                  </div>
                  <div className="hidden items-center justify-center border-l border-zinc-100 text-xs text-zinc-500 sm:flex">{m.sessions}</div>
                  <div className="flex items-center justify-center gap-1 border-l border-zinc-100 px-1">
                    <EntityDialog
                      kind="agent"
                      id={m.agent.id}
                      initial={{ name: m.agent.name, role: m.agent.role, persona: m.agent.persona, prop: m.agent.avatar.prop ?? "mug", team_id: m.agent.team_id }}
                      choices={teamChoices}
                    />
                    <DeleteDialog
                      kind="agent"
                      id={m.agent.id}
                      name={m.agent.name}
                      targets={moveTargets.filter((t) => t.id !== m.agent.id)}
                      impact={[`${m.sessions} session${m.sessions === 1 ? "" : "s"} need a new owner`]}
                      buttonLabel="🗑"
                      buttonClassName="rounded-lg px-2 py-1 text-xs ring-1 ring-black/10 hover:bg-rose-50"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No one on this team yet.</p>
      )}

      {hiring ? (
        <form
          className="space-y-2 rounded-2xl bg-white p-3 ring-2 ring-amber-300"
          onSubmit={(e) => {
            e.preventDefault();
            if (!parsed.length) return;
            const before = text;
            setText("");
            setHiring(false);
            run(() => bulkHireAction(teamId, before), { onFailed: () => setText(before) });
          }}
        >
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={"One person per line — Name — Role\nNoor — Marketing Manager\nSam — QA Engineer"}
            aria-label="People to hire, one per line"
            className="w-full rounded-xl border-0 bg-zinc-50 px-3 py-2 text-sm ring-1 ring-black/10"
          />
          {parsed.length ? (
            <div className="flex flex-wrap gap-1.5">
              {parsed.slice(0, 20).map((p, i) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-0.5 pr-2 text-xs">
                  <Character spec={{ seed: `${p.name}:${p.role}` }} pose="idle" desk={false} size={22} />
                  <b>{p.name}</b> · {p.role}
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button disabled={!parsed.length || pending} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-bold text-paper disabled:opacity-40">
              Hire {parsed.length || ""}
            </button>
            <button type="button" onClick={() => setHiring(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-500 hover:bg-zinc-100">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setHiring(true)} className="rounded-xl border-2 border-dashed border-zinc-300 px-4 py-2 text-sm font-bold text-zinc-600 hover:bg-white">
          + Hire several at once
        </button>
      )}

      <BulkBar count={sel.size} noun={["teammate", "teammates"]} onClear={sel.clear}>
        <Popover label="➜ Move to team…" side="top" className={BAR_POPOVER} panelClassName="w-80">
          {(close) => (
            <OrgPicker
              options={options}
              kinds={["team"]}
              placeholder="Search teams…"
              onPick={(p) => {
                close();
                if (!p.id || p.id === teamId) return;
                const chosen = sel.ids;
                run(() => bulkAgentsAction(chosen, { type: "team", teamId: p.id! }), { onOk: () => sel.clear() });
              }}
            />
          )}
        </Popover>
        <BarButton
          tone="danger"
          onClick={() => {
            if (!confirm(`Remove ${sel.size} teammate${sel.size === 1 ? "" : "s"}? Their sessions become unfiled.`)) return;
            const chosen = sel.ids;
            run(() => bulkAgentsAction(chosen, { type: "delete" }), { onOk: () => sel.clear() });
          }}
        >
          🗑 Remove
        </BarButton>
      </BulkBar>
    </div>
  );
}
