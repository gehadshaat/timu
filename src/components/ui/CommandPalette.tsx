"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { searchIndexAction } from "@/app/_actions/search";
import { rankSearch, type SearchKind, type Searchable } from "@/lib/search";

const KIND_LABEL: Record<SearchKind, string> = {
  page: "Page",
  company: "Company",
  project: "Project",
  team: "Team",
  person: "Person",
  goal: "Goal",
  todo: "To-do",
  session: "Session",
};

/** Open the palette from anywhere (e.g. the sidebar's search button). */
export function openCommandPalette() {
  window.dispatchEvent(new Event("timu:palette"));
}

/** ⌘K / Ctrl+K: jump to any company, project, team, person, goal, session or page. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<Searchable[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const show = useCallback(() => {
    setOpen(true);
    setQ("");
    setCursor(0);
    setLoading(true);
    // Refresh the index each time it opens; the previous one is used meanwhile.
    searchIndexAction()
      .then(setIndex)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
      }
    };
    const onOpen = () => show();
    window.addEventListener("keydown", onKey);
    window.addEventListener("timu:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("timu:palette", onOpen);
    };
  }, [open, show]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const results = useMemo(() => {
    if (!index) return [];
    if (!q.trim()) return index.filter((i) => i.kind === "page" || i.kind === "company" || i.kind === "project").slice(0, 16);
    return rankSearch(q, index, 30);
  }, [index, q]);

  const go = (item: Searchable | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/40 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Search everything"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-3xl bg-paper shadow-2xl ring-1 ring-black/10"
      >
        <div className="flex items-center gap-2 border-b border-black/5 px-4">
          <span aria-hidden className="text-lg">
            🔎
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                const n = Math.min(results.length - 1, cursor + 1);
                setCursor(n);
                listRef.current?.querySelector(`[data-i="${n}"]`)?.scrollIntoView({ block: "nearest" });
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const n = Math.max(0, cursor - 1);
                setCursor(n);
                listRef.current?.querySelector(`[data-i="${n}"]`)?.scrollIntoView({ block: "nearest" });
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[cursor]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder="Jump to a company, project, teammate, session…"
            aria-label="Search"
            className="min-w-0 flex-1 border-0 bg-transparent py-4 text-base outline-none"
          />
          <kbd className="rounded-md bg-black/5 px-1.5 py-0.5 text-[11px] font-bold text-zinc-500">esc</kbd>
        </div>
        <ul ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
          {!index && loading ? <li className="px-3 py-6 text-center text-sm text-zinc-500">Loading…</li> : null}
          {index && results.length === 0 ? <li className="px-3 py-6 text-center text-sm text-zinc-500">Nothing matches “{q}”.</li> : null}
          {results.map((r, i) => (
            <li key={`${r.kind}:${r.id}`} data-i={i}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r)}
                className={clsx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left", cursor === i ? "bg-amber-100" : "hover:bg-black/5")}
              >
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white text-base ring-1 ring-black/5">
                  {r.emoji ?? "•"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.label}</span>
                  {r.sublabel ? <span className="block truncate text-xs text-zinc-500">{r.sublabel}</span> : null}
                </span>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-zinc-400">{KIND_LABEL[r.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-black/5 px-4 py-2 text-[11px] font-semibold text-zinc-500">
          <span>↑↓ to move · ↵ to open</span>
          <span>⌘K / Ctrl+K anywhere</span>
        </div>
      </div>
    </div>
  );
}
