"use client";

import Link from "next/link";
import { useMemo, useOptimistic, useState } from "react";
import clsx from "clsx";
import { bulkProjectsAction } from "@/app/_actions/bulk";
import { groupColor } from "./board/palette";
import { Character } from "./Character";
import { companyHref, projectHref } from "@/lib/links";
import type { AvatarSpec } from "@/lib/types";
import { BAR_POPOVER, BarButton, BulkBar, SelectBox } from "./ui/BulkBar";
import { MenuItem, Popover } from "./ui/Popover";
import { useBulkRunner } from "./ui/useBulk";
import { useSelection } from "./ui/useSelection";

export interface BoardCompany {
  id: string;
  slug: string;
  name: string;
  emoji: string;
}

export interface BoardProject {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  company_id: string | null;
  /** Teammates on this project, for the avatar strip. */
  people: { id: string; name: string; role: string; avatar: AvatarSpec }[];
  waiting: number;
}

const LOOSE = "__none__";

/** ☐ · Project · Needs you · People (from md) · Company. */
const COLS = "grid grid-cols-[2rem_minmax(0,1fr)_4.5rem_8rem] md:grid-cols-[2rem_minmax(0,1fr)_5rem_8rem_11rem]";
const MIME = "application/x-timu-project";

/** Drag data: one id, or a JSON list when several selected chips move together. */
function readIds(data: string): string[] {
  if (!data) return [];
  if (!data.startsWith("[")) return [data];
  try {
    return (JSON.parse(data) as unknown[]).filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * Companies as a board: a group per company, a row per project. Drag a row onto another company
 * (or "Projects without a company") to move it, or pick one in its Company column. Select several
 * to move or delete them together. Moves show instantly, save in the background and can be undone.
 */
export function CompanyBoard({ companies, projects: initial }: { companies: BoardCompany[]; projects: BoardProject[] }) {
  const [projects, moveLocal] = useOptimistic(initial, (state, move: { ids: string[]; to: string | null }) =>
    state.map((p) => (move.ids.includes(p.id) ? { ...p, company_id: move.to } : p)),
  );
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string[]>([]);
  const order = useMemo(
    () => [...companies.flatMap((c) => projects.filter((p) => p.company_id === c.id)), ...projects.filter((p) => !p.company_id)].map((p) => p.id),
    [companies, projects],
  );
  const sel = useSelection(order);
  const { run } = useBulkRunner();

  const move = (ids: string[], to: string | null) => {
    const moving = ids.filter((id) => projects.some((x) => x.id === id && x.company_id !== to));
    if (!moving.length) return;
    run(async () => {
      moveLocal({ ids: moving, to });
      return bulkProjectsAction(moving, { type: "company", companyId: to });
    });
  };

  const zone = (key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== key) setOver(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      const ids = readIds(e.dataTransfer.getData(MIME));
      if (ids.length) move(ids, key === LOOSE ? null : key);
    },
  });

  const row = (p: BoardProject, color: string) => {
    const selected = sel.has(p.id);
    return (
      <li
        key={p.id}
        draggable
        onDragStart={(e) => {
          const ids = selected ? sel.ids : [p.id];
          e.dataTransfer.setData(MIME, ids.length > 1 ? JSON.stringify(ids) : p.id);
          e.dataTransfer.effectAllowed = "move";
          setDragging(ids);
        }}
        onDragEnd={() => {
          setDragging([]);
          setOver(null);
        }}
        data-project={p.name}
        title="Drag onto another company"
        className={clsx(
          COLS,
          "group cursor-grab border-t border-zinc-100 bg-white active:cursor-grabbing",
          dragging.includes(p.id) ? "opacity-40" : "hover:bg-zinc-50",
          selected && "bg-amber-50 hover:bg-amber-50",
        )}
      >
        <div className="flex items-center justify-center border-l-[6px]" style={{ borderColor: color }}>
          <SelectBox checked={selected} onToggle={(shift) => sel.toggle(p.id, { shift })} label={`Select ${p.name}`} className="h-3.5 w-3.5 cursor-pointer accent-amber-500" />
        </div>
        <div className="flex min-w-0 items-center gap-2 py-2 pl-2 pr-2">
          <span aria-hidden className="select-none text-zinc-300">⠿</span>
          <Link href={projectHref(p.slug)} draggable={false} className="truncate text-sm font-bold hover:underline">
            {p.emoji} {p.name}
          </Link>
        </div>
        <div className="flex items-center justify-center border-l border-zinc-100">
          {p.waiting ? <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-black text-white">{p.waiting}</span> : <span className="text-xs text-zinc-300">—</span>}
        </div>
        <div className="hidden items-center justify-center border-l border-zinc-100 md:flex">
          {p.people.length ? (
            <span className="flex -space-x-2">
              {p.people.slice(0, 4).map((a) => (
                <Character key={a.id} spec={a.avatar} pose="idle" desk={false} size={24} title={`${a.name}, ${a.role}`} />
              ))}
              {p.people.length > 4 ? <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-600">+{p.people.length - 4}</span> : null}
            </span>
          ) : (
            <span className="text-xs text-zinc-300">—</span>
          )}
        </div>
        <div className="flex items-center border-l border-zinc-100 px-1">
          <select
            aria-label={`Move ${p.name} to`}
            value={p.company_id ?? LOOSE}
            onChange={(e) => move([p.id], e.target.value === LOOSE ? null : e.target.value)}
            className="w-full cursor-pointer truncate rounded-md border-0 bg-transparent py-1 pl-1 pr-6 text-xs text-zinc-600 hover:bg-zinc-100"
            title="Move to another company"
          >
            <option value={LOOSE}>📦 No company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </div>
      </li>
    );
  };

  const groups: { key: string; company: BoardCompany | null; mine: BoardProject[] }[] = [
    ...companies.map((c) => ({ key: c.id, company: c, mine: projects.filter((p) => p.company_id === c.id) })),
    { key: LOOSE, company: null, mine: projects.filter((p) => !p.company_id) },
  ];

  return (
    <div className="space-y-6">
      {groups.map((g, i) => {
        const color = g.company ? groupColor(i) : "#c4c4c4";
        const hot = over === g.key;
        const waiting = g.mine.reduce((n, p) => n + p.waiting, 0);
        const people = new Set(g.mine.flatMap((p) => p.people.map((a) => a.id))).size;
        const ids = g.mine.map((p) => p.id);
        const all = ids.length > 0 && ids.every((id) => sel.has(id));
        return (
          <section key={g.key} {...zone(g.key)} aria-label={g.company ? `Company ${g.company.name}` : "Projects without a company"} className={clsx("rounded-xl transition", hot && "bg-sky-50 ring-2 ring-sky-400")}>
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1">
              {g.company ? (
                <Link href={companyHref(g.company.slug)} className="text-lg font-bold hover:underline" style={{ color }}>
                  {g.company.emoji} {g.company.name}
                </Link>
              ) : (
                <h2 className="text-lg font-bold text-zinc-500">📦 Projects without a company</h2>
              )}
              <span className="text-xs text-zinc-400">
                {g.mine.length} project{g.mine.length === 1 ? "" : "s"} · {people} people
              </span>
              {waiting ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">🙋 {waiting} waiting on you</span> : null}
            </header>
            <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
              <div className={clsx(COLS, "text-[11px] font-semibold text-zinc-500")}>
                <div className="flex items-center justify-center border-l-[6px]" style={{ borderColor: color }}>
                  <input
                    type="checkbox"
                    aria-label={`Select all in ${g.company?.name ?? "projects without a company"}`}
                    checked={all}
                    disabled={!ids.length}
                    onChange={() => (all ? sel.remove(ids) : sel.selectAll([...sel.ids, ...ids]))}
                    className="h-3.5 w-3.5 cursor-pointer accent-amber-500"
                  />
                </div>
                <div className="py-1.5 pl-2">Project</div>
                <div className="flex items-center justify-center border-l border-white">Needs you</div>
                <div className="hidden items-center justify-center border-l border-white md:flex">People</div>
                <div className="flex items-center border-l border-white px-2">Company</div>
              </div>
              <ul>{g.mine.map((p) => row(p, color))}</ul>
              {!g.mine.length ? (
                <p className="border-t border-zinc-100 bg-white px-4 py-3 text-sm text-zinc-400">
                  {hot ? "Drop to move it here" : g.company ? "Drag projects here" : "Every project has a company. Drag one here to take it out."}
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
      <p className="text-xs text-zinc-500">Drag a project row onto another company, or pick one in its Company column; tick several to move them together.</p>

      <BulkBar count={sel.size} noun={["project", "projects"]} onClear={sel.clear}>
        <Popover label="➜ Move to…" side="top" className={BAR_POPOVER} panelClassName="w-56">
          {(close) => (
            <>
              {companies.map((c) => (
                <MenuItem
                  key={c.id}
                  onClick={() => {
                    close();
                    move(sel.ids, c.id);
                  }}
                >
                  {c.emoji} {c.name}
                </MenuItem>
              ))}
              <MenuItem
                onClick={() => {
                  close();
                  move(sel.ids, null);
                }}
              >
                📦 No company
              </MenuItem>
            </>
          )}
        </Popover>
        <BarButton
          tone="danger"
          onClick={() => {
            const n = sel.size;
            if (!confirm(`Delete ${n} project${n === 1 ? "" : "s"}? Their teams, people and goals go too; sessions stay imported but unfiled; to-dos are kept.`)) return;
            const ids = sel.ids;
            run(() => bulkProjectsAction(ids, { type: "delete" }), { onOk: () => sel.clear() });
          }}
        >
          🗑 Delete
        </BarButton>
      </BulkBar>
    </div>
  );
}
