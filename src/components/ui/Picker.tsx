"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { fold } from "@/lib/search";
import type { OrgOptions } from "@/lib/queries";

export type PickKind = "company" | "project" | "team" | "person" | "goal";
export interface Pick {
  kind: PickKind;
  /** null = the "none" choice (unassign, no project, you). */
  id: string | null;
  label: string;
}

interface Entry {
  kind: PickKind;
  id: string;
  label: string;
  /** Where it sits: "Acme › Sunbeam Web › Marketing" */
  path: string;
  emoji: string;
  depth: number;
  selectable: boolean;
  search: string;
}

const KIND_TAG: Record<PickKind, string> = { company: "company", project: "project", team: "team", person: "person", goal: "goal" };

/** company › project › (goals) › team › person, in tree order. */
function buildEntries(options: OrgOptions, kinds: PickKind[]): Entry[] {
  const can = new Set(kinds);
  const out: Entry[] = [];
  const companies = [...options.companies, { id: "", name: "No company", emoji: "📦" }];
  for (const c of companies) {
    const projects = options.projects.filter((p) => (c.id ? p.company_id === c.id : !p.company_id));
    if (!projects.length && !(can.has("company") && c.id)) continue;
    if (c.id || can.has("company")) {
      out.push({ kind: "company", id: c.id, label: c.name, path: "", emoji: c.emoji, depth: 0, selectable: can.has("company") && !!c.id, search: fold(c.name) });
    }
    for (const p of projects) {
      const pPath = c.id ? c.name : "";
      out.push({ kind: "project", id: p.id, label: p.name, path: pPath, emoji: p.emoji, depth: 1, selectable: can.has("project"), search: fold(`${p.name} ${p.slug} ${c.id ? c.name : ""}`) });
      if (can.has("goal")) {
        for (const g of options.goals.filter((x) => x.project_id === p.id && x.status === "active")) {
          out.push({ kind: "goal", id: g.id, label: g.title, path: [pPath, p.name].filter(Boolean).join(" › "), emoji: "🎯", depth: 2, selectable: true, search: fold(`${g.title} ${p.name}`) });
        }
      }
      if (can.has("team") || can.has("person")) {
        for (const t of options.teams.filter((x) => x.project_id === p.id)) {
          const tPath = [pPath, p.name].filter(Boolean).join(" › ");
          out.push({ kind: "team", id: t.id, label: t.name, path: tPath, emoji: "👥", depth: 2, selectable: can.has("team"), search: fold(`${t.name} ${p.name}`) });
          if (can.has("person")) {
            for (const a of options.agents.filter((x) => x.team_id === t.id)) {
              out.push({ kind: "person", id: a.id, label: a.name, path: `${tPath} › ${t.name}`, emoji: "🧑", depth: 3, selectable: true, search: fold(`${a.name} ${a.role} ${t.name} ${p.name}`) });
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * A searchable picker over the whole org. Without a query it shows the tree; typing
 * shows matching choices with where they sit.
 */
export function OrgPicker({
  options,
  kinds,
  onPick,
  none,
  placeholder = "Search people, teams, projects…",
  autoFocus = true,
}: {
  options: OrgOptions;
  kinds: PickKind[];
  onPick: (pick: Pick) => void;
  /** Offer a "none" choice first, e.g. { kind: "person", label: "👤 Me (unassign)" }. */
  none?: { kind: PickKind; label: string };
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const kindsKey = kinds.join(",");
  const entries = useMemo(() => buildEntries(options, kindsKey.split(",") as PickKind[]), [options, kindsKey]);
  const query = fold(q);
  const shown = useMemo(() => {
    if (!query) return entries;
    const terms = query.split(" ");
    return entries.filter((e) => e.selectable && terms.every((t) => e.search.includes(t)));
  }, [entries, query]);
  const choices = useMemo(() => {
    const base: (Entry | { kind: "none"; label: string })[] = none && !query ? [{ kind: "none", label: none.label }] : [];
    return [...base, ...shown];
  }, [shown, none, query]);
  const selectable = choices.map((c, i) => ("selectable" in c ? c.selectable : true) ? i : -1).filter((i) => i >= 0);

  const choose = (i: number) => {
    const c = choices[i];
    if (!c) return;
    if (c.kind === "none") onPick({ kind: none!.kind, id: null, label: none!.label });
    else if (c.selectable) onPick({ kind: c.kind, id: c.id, label: c.label });
  };

  const move = (dir: 1 | -1) => {
    if (!selectable.length) return;
    const pos = selectable.indexOf(cursor);
    const next = selectable[(pos + dir + selectable.length) % selectable.length] ?? selectable[0];
    setCursor(next);
    listRef.current?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="flex max-h-96 flex-col">
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setCursor(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(cursor >= 0 ? cursor : (selectable[0] ?? -1));
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="m-2 rounded-xl border-0 bg-zinc-100 px-3 py-2 text-sm outline-none ring-amber-300 focus:ring-2"
      />
      <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-1" role="listbox">
        {choices.length === 0 ? <li className="px-3 py-3 text-sm text-zinc-500">No matches.</li> : null}
        {choices.map((c, i) => {
          if (c.kind === "none") {
            return (
              <li key="none" data-i={i}>
                <button
                  type="button"
                  onClick={() => choose(i)}
                  onMouseEnter={() => setCursor(i)}
                  className={clsx("flex w-full items-center gap-2 px-3 py-1.5 text-left font-semibold", cursor === i ? "bg-amber-100" : "hover:bg-zinc-50")}
                >
                  {c.label}
                </button>
              </li>
            );
          }
          const indent = query ? 0 : c.depth;
          return (
            <li key={`${c.kind}:${c.id}`} data-i={i}>
              {c.selectable ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={cursor === i}
                  onClick={() => choose(i)}
                  onMouseEnter={() => setCursor(i)}
                  style={{ paddingLeft: 12 + indent * 14 }}
                  className={clsx("flex w-full items-center gap-2 py-1.5 pr-3 text-left", cursor === i ? "bg-amber-100" : "hover:bg-zinc-50")}
                >
                  <span aria-hidden>{c.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.label}</span>
                    {query && c.path ? <span className="block truncate text-xs text-zinc-500">{c.path}</span> : null}
                  </span>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-zinc-400">{KIND_TAG[c.kind]}</span>
                </button>
              ) : (
                <div style={{ paddingLeft: 12 + indent * 14 }} className="flex items-center gap-2 pb-0.5 pt-2 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                  <span aria-hidden>{c.emoji}</span>
                  <span className="truncate">{c.label}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
