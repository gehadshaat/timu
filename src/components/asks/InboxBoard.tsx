"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { recheckOpenAsksAction } from "@/app/actions";
import { KIND_LABEL, SOURCE_LABEL } from "@/lib/format";
import { fold } from "@/lib/search";
import { KIND_URGENCY, type AskView } from "@/lib/ask-view";
import { Character } from "../Character";
import { BAR_POPOVER, BarButton, BulkBar } from "../ui/BulkBar";
import { Leaving } from "../ui/Leaving";
import { MenuItem, Popover, SNOOZE_CHOICES } from "../ui/Popover";
import { useToast } from "../ui/Toaster";
import { useLeavingList } from "../ui/useLeaving";
import { useSelection } from "../ui/useSelection";
import { AskCard, AskRow } from "./AskCard";
import { AskBoardHead, AskBoardRow } from "./AskBoard";
import { groupColor } from "../board/palette";
import { useAskActions } from "./useAskActions";

export interface InboxFilters {
  q: string;
  company: string;
  project: string;
  kind: string;
  source: string;
  age: string;
  sort: "newest" | "oldest" | "urgent";
  group: "project" | "company" | "kind" | "none";
}

export const DEFAULT_FILTERS: InboxFilters = { q: "", company: "", project: "", kind: "", source: "", age: "", sort: "newest", group: "project" };

const AGES: [string, string, (days: number) => boolean][] = [
  ["today", "Today", (d) => d < 1],
  ["week", "This week", (d) => d < 7],
  ["older7", "Older than a week", (d) => d >= 7],
  ["older30", "Older than 30 days", (d) => d >= 30],
];

// v2: Board became the default; a Cards/Compact choice saved before it existed shouldn't hide it.
const VIEW_KEY = "timu.inbox.view.v2";
type View = "board" | "cards" | "compact";
const PAGE: Record<View, number> = { board: 80, cards: 25, compact: 80 };

function ageDays(iso: string, now: number) {
  return (now - Date.parse(iso)) / 86_400_000;
}

function haystack(a: AskView) {
  return fold(
    [a.title, a.detail, a.quote, a.session.title, a.session.repo, a.agent?.name, a.agent?.role, a.team?.name, a.project?.name, a.company?.name]
      .filter(Boolean)
      .join(" "),
  );
}

function isTyping(el: EventTarget | null) {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

export function InboxBoard({ asks, snoozed, initial }: { asks: AskView[]; snoozed: number; initial: Partial<InboxFilters> }) {
  const [f, setF] = useState<InboxFilters>({ ...DEFAULT_FILTERS, ...initial });
  const [view, setView] = useState<View>("board");
  const [limit, setLimit] = useState(PAGE[view]);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();
  const [rechecking, startRecheck] = useTransition();
  const [now] = useState(() => Date.now());

  // Remember the preferred view.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "board" || v === "cards" || v === "compact") {
        setView(v);
        setLimit(PAGE[v]);
      }
    } catch {
      // storage unavailable
    }
  }, []);
  const changeView = (v: View) => {
    setView(v);
    setLimit(PAGE[v]);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage unavailable
    }
  };

  // Keep the filters in the URL so a view can be bookmarked or linked to.
  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v && v !== DEFAULT_FILTERS[k as keyof InboxFilters]) p.set(k, String(v));
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", qs ? `?${qs}` : window.location.pathname);
  }, [f]);

  const set = <K extends keyof InboxFilters>(k: K, v: InboxFilters[K]) => {
    setF((prev) => ({ ...prev, [k]: v, ...(k === "company" && v ? { project: "" } : {}) }));
    setLimit(PAGE[view]);
  };

  const list = useLeavingList(asks, (a) => a.id);
  const search = useMemo(() => new Map(asks.map((a) => [a.id, haystack(a)])), [asks]);

  const filtered = useMemo(() => {
    const terms = fold(f.q).split(" ").filter(Boolean);
    const age = AGES.find((a) => a[0] === f.age)?.[2];
    const out = list.visible.filter(
      (a) =>
        (!f.company || (f.company === "none" ? !a.company : a.company?.id === f.company)) &&
        (!f.project || (f.project === "none" ? !a.project : a.project?.id === f.project)) &&
        (!f.kind || a.kind === f.kind) &&
        (!f.source || a.session.source === f.source) &&
        (!age || age(ageDays(a.raisedAt, now))) &&
        (!terms.length || terms.every((t) => (search.get(a.id) ?? haystack(a)).includes(t))),
    );
    const cmp = {
      newest: (a: AskView, b: AskView) => b.raisedAt.localeCompare(a.raisedAt),
      oldest: (a: AskView, b: AskView) => a.raisedAt.localeCompare(b.raisedAt),
      urgent: (a: AskView, b: AskView) => (KIND_URGENCY[a.kind] ?? 9) - (KIND_URGENCY[b.kind] ?? 9) || b.raisedAt.localeCompare(a.raisedAt),
    }[f.sort];
    return out.sort(cmp);
  }, [list.visible, f, now, search]);

  const shown = filtered.slice(0, limit);
  const live = useMemo(() => filtered.filter((a) => !list.leavingIds.has(a.id)), [filtered, list.leavingIds]);
  const total = useMemo(() => list.visible.filter((a) => !list.leavingIds.has(a.id)).length, [list.visible, list.leavingIds]);
  const liveIds = useMemo(() => live.map((a) => a.id), [live]);
  const shownLiveIds = useMemo(() => shown.filter((a) => !list.leavingIds.has(a.id)).map((a) => a.id), [shown, list.leavingIds]);
  const sel = useSelection(liveIds);

  const asksRef = useRef(asks);
  asksRef.current = asks;
  const onGone = useCallback(
    (ids: string[]) => {
      sel.remove(ids);
      // Move the cursor past the items that are leaving.
      setCursorId((cur) => {
        if (!cur || !ids.includes(cur)) return cur;
        const order = shownLiveIds;
        const at = order.indexOf(cur);
        const gone = new Set(ids);
        return order.slice(at + 1).find((id) => !gone.has(id)) ?? order.slice(0, at).reverse().find((id) => !gone.has(id)) ?? null;
      });
    },
    [sel, shownLiveIds],
  );
  const actions = useAskActions(list, () => asksRef.current, onGone);

  const handlersFor = (id: string) => ({
    onHandled: () => actions.handled([id]),
    onNotNeeded: (why?: string) => actions.notNeeded([id], why),
    onSnooze: (hours: number, label: string) => actions.snooze([id], hours, label),
  });

  // Facets with counts, from the asks themselves.
  const facets = useMemo(() => {
    const companies = new Map<string, { label: string; n: number }>();
    const projects = new Map<string, { label: string; n: number; company: string }>();
    const kinds = new Map<string, number>();
    const sources = new Map<string, number>();
    for (const a of list.visible) {
      const c = a.company ? a.company.id : "none";
      const cl = a.company ? `${a.company.emoji} ${a.company.name}` : "No company";
      companies.set(c, { label: cl, n: (companies.get(c)?.n ?? 0) + 1 });
      const p = a.project ? a.project.id : "none";
      projects.set(p, { label: a.project ? `${a.project.emoji} ${a.project.name}` : "Unfiled", n: (projects.get(p)?.n ?? 0) + 1, company: c });
      kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
      sources.set(a.session.source, (sources.get(a.session.source) ?? 0) + 1);
    }
    const byCount = <T extends { n: number; label: string }>(m: Map<string, T>) => [...m.entries()].sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label));
    return {
      companies: byCount(companies),
      projects: byCount(projects).filter(([, v]) => !f.company || v.company === f.company),
      kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]),
      sources: [...sources.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [list.visible, f.company]);

  const groups = useMemo(() => {
    const out = new Map<string, { label: string; items: AskView[] }>();
    for (const a of shown) {
      let key = "all";
      let label = "";
      if (f.group === "project") {
        key = a.project?.id ?? "none";
        label = a.project ? `${a.project.emoji} ${a.project.name}` : "Unfiled";
      } else if (f.group === "company") {
        key = a.company?.id ?? "none";
        label = a.company ? `${a.company.emoji} ${a.company.name}` : "No company";
      } else if (f.group === "kind") {
        key = a.kind;
        label = KIND_LABEL[a.kind] ?? a.kind;
      }
      if (!out.has(key)) out.set(key, { label, items: [] });
      out.get(key)!.items.push(a);
    }
    return [...out.entries()];
  }, [shown, f.group]);

  const activeFilters = (["company", "project", "kind", "source", "age", "q"] as const).filter((k) => f[k]);
  const clearFilters = () => {
    setF((prev) => ({ ...prev, company: "", project: "", kind: "", source: "", age: "", q: "" }));
    setLimit(PAGE[view]);
  };

  // Keyboard: j/k move, x select, e handled, n not needed, s snooze, o open, ↵ details, / search, ? help.
  const targets = () => (sel.size ? sel.ids : cursorId ? [cursorId] : []);
  const keyState = useRef({ shownLiveIds, cursorId, targets, sel, actions, asks });
  keyState.current = { shownLiveIds, cursorId, targets, sel, actions, asks };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = keyState.current;
      const order = k.shownLiveIds;
      const move = (dir: 1 | -1) => {
        const at = k.cursorId ? order.indexOf(k.cursorId) : -1;
        const next = order[Math.max(0, Math.min(order.length - 1, at + dir))] ?? null;
        setCursorId(next);
        if (next) document.querySelector(`[data-ask="${next}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      const current = k.asks.find((a) => a.id === k.cursorId);
      switch (e.key) {
        case "j":
          move(1);
          break;
        case "k":
          move(-1);
          break;
        case "x":
          if (k.cursorId) k.sel.toggle(k.cursorId);
          break;
        case "e":
          k.actions.handled(k.targets());
          break;
        case "n":
          k.actions.notNeeded(k.targets());
          break;
        case "s":
          k.actions.snooze(k.targets(), 24, "Tomorrow");
          break;
        case "o":
          if (current?.session.url) window.open(current.session.url, "_blank", "noreferrer");
          else if (current?.session.resume) navigator.clipboard?.writeText(current.session.resume).catch(() => undefined);
          break;
        case "Enter":
          if (current) router.push(`/sessions/${current.session.id}`);
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "?":
          setHelp((v) => !v);
          break;
        case "Escape":
          setHelp(false);
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const allShownSelected = shownLiveIds.length > 0 && shownLiveIds.every((id) => sel.has(id));
  const someSelected = sel.size > 0 && !allShownSelected;

  if (!asks.length && !list.visible.length) {
    return (
      <div className="rounded-[32px] bg-gradient-to-br from-emerald-50 to-sky-50 p-10 text-center ring-1 ring-black/5">
        <div className="mx-auto flex w-fit -space-x-4">
          {["Maya", "Omar", "Noor"].map((seed) => (
            <Character key={seed} spec={{ seed }} pose="done" size={110} desk={false} />
          ))}
        </div>
        <h2 className="mt-4 font-display text-2xl font-bold">Nobody is waiting on you 🎉</h2>
        <p className="mt-1 text-zinc-600">When a session asks you something, finishes work for review, or gets stuck, it shows up here.</p>
      </div>
    );
  }

  const select = (props: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) => (
    <span className="relative">
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={clsx(
          "max-w-[12rem] cursor-pointer appearance-none truncate rounded-xl border-0 py-1.5 pl-3 pr-7 text-sm font-semibold ring-1 ring-black/10",
          props.value ? "bg-amber-100 ring-amber-300" : "bg-white",
        )}
      >
        {props.children}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500">
        ▼
      </span>
    </span>
  );

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="sticky top-0 z-30 -mx-1 space-y-2 rounded-2xl bg-paper/90 px-1 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">
              🔎
            </span>
            <input
              ref={searchRef}
              value={f.q}
              onChange={(e) => set("q", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  set("q", "");
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="Search asks, sessions, people, repos…  ( / )"
              aria-label="Search asks"
              className="w-full rounded-xl border-0 bg-white py-2 pl-9 pr-3 text-sm ring-1 ring-black/10 focus:ring-2 focus:ring-amber-300"
            />
          </div>
          <div className="flex rounded-xl bg-white p-0.5 ring-1 ring-black/10" role="group" aria-label="View">
            {(["board", "cards", "compact"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => changeView(v)}
                className={clsx("rounded-lg px-2.5 py-1 text-sm font-semibold", view === v ? "bg-ink text-paper" : "text-zinc-600 hover:bg-black/5")}
              >
                {v === "board" ? "▦ Board" : v === "cards" ? "▤ Cards" : "☰ Compact"}
              </button>
            ))}
          </div>
          <Popover label="⋯" title="More" align="right" panelClassName="w-64" className="rounded-xl bg-white px-3 py-1.5 text-sm font-bold ring-1 ring-black/10 hover:bg-zinc-50">
            {(close) => (
              <>
                <MenuItem
                  disabled={rechecking}
                  onClick={() => {
                    close();
                    toast({ message: "Re-checking every open ask with the triage judge…", tone: "info" });
                    startRecheck(async () => {
                      const r = await recheckOpenAsksAction();
                      toast({ message: r.message, tone: r.ok ? "success" : "error" });
                    });
                  }}
                >
                  🧹 Re-check all with triage
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    setHelp(true);
                  }}
                >
                  ⌨️ Keyboard shortcuts
                </MenuItem>
              </>
            )}
          </Popover>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {select({
            label: "Company",
            value: f.company,
            onChange: (v) => set("company", v),
            children: (
              <>
                <option value="">All companies</option>
                {facets.companies.map(([id, c]) => (
                  <option key={id} value={id}>
                    {c.label} ({c.n})
                  </option>
                ))}
              </>
            ),
          })}
          {select({
            label: "Project",
            value: f.project,
            onChange: (v) => set("project", v),
            children: (
              <>
                <option value="">All projects</option>
                {facets.projects.map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.label} ({p.n})
                  </option>
                ))}
              </>
            ),
          })}
          {select({
            label: "Kind",
            value: f.kind,
            onChange: (v) => set("kind", v),
            children: (
              <>
                <option value="">All kinds</option>
                {facets.kinds.map(([k, n]) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k] ?? k} ({n})
                  </option>
                ))}
              </>
            ),
          })}
          {select({
            label: "Age",
            value: f.age,
            onChange: (v) => set("age", v),
            children: (
              <>
                <option value="">Any age</option>
                {AGES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </>
            ),
          })}
          {facets.sources.length > 1
            ? select({
                label: "Source",
                value: f.source,
                onChange: (v) => set("source", v),
                children: (
                  <>
                    <option value="">All sources</option>
                    {facets.sources.map(([s, n]) => (
                      <option key={s} value={s}>
                        {SOURCE_LABEL[s] ?? s} ({n})
                      </option>
                    ))}
                  </>
                ),
              })
            : null}
          <span className="mx-1 hidden h-5 w-px bg-black/10 sm:block" />
          {select({
            label: "Sort",
            value: f.sort === "newest" ? "" : f.sort,
            onChange: (v) => set("sort", (v || "newest") as InboxFilters["sort"]),
            children: (
              <>
                <option value="">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="urgent">Most urgent</option>
              </>
            ),
          })}
          {select({
            label: "Group by",
            value: f.group === "project" ? "" : f.group,
            onChange: (v) => set("group", (v || "project") as InboxFilters["group"]),
            children: (
              <>
                <option value="">By project</option>
                <option value="company">By company</option>
                <option value="kind">By kind</option>
                <option value="none">No grouping</option>
              </>
            ),
          })}
          {activeFilters.length ? (
            <button type="button" onClick={clearFilters} className="rounded-xl px-2 py-1.5 text-sm font-semibold text-orange-700 hover:underline">
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {/* list header */}
      <div className="flex flex-wrap items-center gap-3 px-1 text-sm text-zinc-500">
        <input
          type="checkbox"
          aria-label="Select all shown"
          checked={allShownSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={() => (allShownSelected ? sel.clear() : sel.selectAll(shownLiveIds))}
          className="h-4 w-4 cursor-pointer accent-amber-500"
        />
        <span>
          <b className="text-ink">{live.length}</b> {live.length === 1 ? "ask" : "asks"}
          {activeFilters.length ? ` match (of ${total})` : " waiting"}
          {snoozed ? ` · ${snoozed} snoozed` : ""}
        </span>
        {live.length > shown.length ? <span>· showing {Math.min(limit, filtered.length)}</span> : null}
        <span className="ml-auto hidden text-xs sm:block">
          <kbd className="rounded bg-black/5 px-1">j</kbd>/<kbd className="rounded bg-black/5 px-1">k</kbd> move · <kbd className="rounded bg-black/5 px-1">x</kbd> select ·{" "}
          <kbd className="rounded bg-black/5 px-1">e</kbd> handled · <kbd className="rounded bg-black/5 px-1">?</kbd> more
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-zinc-300 p-10 text-center text-zinc-500">
          No asks match these filters.{" "}
          <button type="button" onClick={clearFilters} className="font-semibold text-orange-700 hover:underline">
            Clear filters
          </button>
        </div>
      ) : null}

      {groups.map(([key, g], gi) => {
        const ids = g.items.filter((a) => !list.leavingIds.has(a.id)).map((a) => a.id);
        const all = ids.length > 0 && ids.every((id) => sel.has(id));
        const toggleAll = () => (all ? sel.remove(ids) : sel.selectAll([...sel.ids, ...ids]));
        if (view === "board") {
          const color = groupColor(gi);
          return (
            <section key={key}>
              {f.group !== "none" ? (
                <h2 className="flex items-center gap-2 px-1 pb-1 text-lg font-bold" style={{ color }}>
                  {g.label} <span className="text-xs font-semibold text-zinc-400">{ids.length}</span>
                </h2>
              ) : null}
              <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
                <AskBoardHead color={color} label={g.label || "this list"} all={all} onSelectAll={toggleAll} count={ids.length} />
                {g.items.map((a) => {
                  const { phase, effect } = list.phaseOf(a.id);
                  return (
                    <Leaving key={a.id} phase={phase}>
                      <div onMouseDown={() => setCursorId(a.id)}>
                        <AskBoardRow
                          ask={a}
                          color={color}
                          phase={phase}
                          effect={effect}
                          handlers={handlersFor(a.id)}
                          selected={sel.has(a.id)}
                          onSelect={(shift) => sel.toggle(a.id, { shift })}
                          focused={cursorId === a.id}
                          now={now}
                        />
                      </div>
                    </Leaving>
                  );
                })}
              </div>
            </section>
          );
        }
        return (
          <section key={key} className="space-y-2">
            {f.group !== "none" ? (
              <h2 className="flex items-center gap-2 px-1 font-display text-base font-bold text-zinc-700">
                <input
                  type="checkbox"
                  aria-label={`Select all in ${g.label}`}
                  checked={all}
                  onChange={toggleAll}
                  className="h-4 w-4 cursor-pointer accent-amber-500"
                />
                {g.label} <span className="text-sm font-semibold text-zinc-400">· {ids.length}</span>
              </h2>
            ) : null}
            <div className={view === "cards" ? "space-y-3" : "space-y-1.5"}>
              {g.items.map((a) => {
                const { phase, effect } = list.phaseOf(a.id);
                const common = {
                  ask: a,
                  phase,
                  effect,
                  handlers: handlersFor(a.id),
                  selected: sel.has(a.id),
                  onSelect: (shift: boolean) => sel.toggle(a.id, { shift }),
                  focused: cursorId === a.id,
                };
                return (
                  <Leaving key={a.id} phase={phase}>
                    <div onMouseDown={() => setCursorId(a.id)}>
                      {view === "cards" ? <AskCard {...common} /> : <AskRow {...common} showProject={f.group !== "project"} />}
                    </div>
                  </Leaving>
                );
              })}
            </div>
          </section>
        );
      })}

      {filtered.length > limit ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE[view])}
            className="rounded-xl bg-white px-4 py-2 text-sm font-bold ring-1 ring-black/10 hover:bg-zinc-50"
          >
            Show {Math.min(PAGE[view], filtered.length - limit)} more · {filtered.length - limit} left
          </button>
        </div>
      ) : null}

      <BulkBar
        count={sel.size}
        noun={["ask", "asks"]}
        onClear={sel.clear}
        extra={
          sel.size < live.length ? (
            <button type="button" onClick={() => sel.selectAll(liveIds)} className="rounded-lg px-2 py-1 text-xs font-bold text-amber-300 hover:bg-white/10">
              Select all {live.length}
            </button>
          ) : null
        }
      >
        <BarButton tone="good" onClick={() => actions.handled(sel.ids)} title="Mark handled (e)">
          ✓ Handled
        </BarButton>
        <BarButton onClick={() => actions.notNeeded(sel.ids)} title="Not needed (n)">
          🙅 Not needed
        </BarButton>
        <Popover label="⏰ Snooze" side="top" className={BAR_POPOVER} panelClassName="w-40">
          {(close) =>
            SNOOZE_CHOICES.map(([label, hours]) => (
              <MenuItem
                key={label}
                onClick={() => {
                  close();
                  actions.snooze(sel.ids, hours, label);
                }}
              >
                {label}
              </MenuItem>
            ))
          }
        </Popover>
        <BarButton onClick={() => actions.archive(sel.ids)} title="Archive the sessions behind these asks">
          🗄️ Archive sessions
        </BarButton>
      </BulkBar>

      {help ? <ShortcutHelp onClose={() => setHelp(false)} /> : null}
    </div>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["j / k", "Next / previous ask"],
    ["x", "Select or unselect"],
    ["shift-click", "Select a range"],
    ["e", "Handled (selection, or the focused ask)"],
    ["n", "Not needed"],
    ["s", "Snooze until tomorrow"],
    ["o", "Open the session (or copy its resume command)"],
    ["↵", "Session details"],
    ["/", "Search"],
    ["esc", "Clear selection"],
    ["⌘K", "Jump anywhere"],
  ];
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-ink/40 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-label="Keyboard shortcuts" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-3xl bg-paper p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">⌨️ Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-400 hover:text-ink">
            ✕
          </button>
        </div>
        <dl className="space-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <dt className="w-24 shrink-0">
                <kbd className="rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-xs font-bold">{k}</kbd>
              </dt>
              <dd className="text-zinc-600">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
