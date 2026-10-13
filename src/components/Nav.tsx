"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { openCommandPalette } from "./ui/CommandPalette";

export interface NavProject {
  id: string;
  name: string;
  emoji: string;
  slug: string;
  asks: number;
}

export interface NavCompany {
  /** null = projects without a company */
  id: string | null;
  name: string;
  emoji: string;
  slug: string | null;
  asks: number;
  projects: NavProject[];
}

export interface NavCounts {
  inbox: number;
  todos: number;
  unfiled: number;
}

interface NavLink {
  href: string;
  label: string;
  icon: string;
  badge?: keyof NavCounts;
  tone?: string;
}

/** What you reach for every day; always on top. */
const PRIMARY: NavLink[] = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/inbox", label: "Needs you", icon: "🙋", badge: "inbox", tone: "bg-rose-500 text-white" },
  { href: "/todos", label: "My to-dos", icon: "✅", badge: "todos", tone: "bg-zinc-200 text-zinc-700" },
];

/** Everything else, folded under "More" on desktop so the project tree gets the room. */
const MORE: NavLink[] = [
  { href: "/digest", label: "Daily digest", icon: "📰" },
  { href: "/office", label: "Office", icon: "🪑" },
  { href: "/organize", label: "Organize", icon: "🧩", badge: "unfiled", tone: "bg-amber-300 text-amber-950" },
  { href: "/sessions", label: "All sessions", icon: "🗂️" },
  { href: "/routines", label: "Scheduled", icon: "⏰" },
  { href: "/projects", label: "Projects & goals", icon: "🎯" },
  { href: "/settings", label: "Sources & settings", icon: "⚙️" },
];

const MORE_KEY = "__more";

/** "/projects" is the all-projects page only; a project's own page lives in the tree below. */
const EXACT = new Set(["/", "/projects"]);
const isActive = (path: string, href: string) => (EXACT.has(href) ? path === href : path.startsWith(href));

const OPEN_KEY = "timu.nav.open";

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeOpen(v: Record<string, boolean>) {
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(v));
  } catch {
    // Private mode or storage blocked: the tree just won't remember.
  }
}

export function Nav({ counts, tree }: { counts: NavCounts; tree: NavCompany[] }) {
  const path = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const totalProjects = tree.reduce((n, c) => n + c.projects.length, 0);
  const defaultOpen = totalProjects <= 12;

  useEffect(() => setOpen(readOpen()), []);

  const isOpen = (key: string, holdsCurrent: boolean) => open[key] ?? (defaultOpen || holdsCurrent);
  const moreOpen = open[MORE_KEY] ?? MORE.some((l) => isActive(path, l.href));
  const toggle = (key: string, now: boolean) => {
    const next = { ...open, [key]: !now };
    setOpen(next);
    writeOpen(next);
  };

  return (
    <nav className="flex min-h-0 flex-col gap-3">
      <button
        type="button"
        onClick={openCommandPalette}
        className="hidden items-center gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm text-zinc-500 ring-1 ring-black/10 hover:bg-zinc-50 md:flex"
      >
        <span aria-hidden>🔎</span>
        <span className="flex-1">Search…</span>
        <kbd className="rounded-md bg-black/5 px-1.5 text-[11px] font-bold">⌘K</kbd>
      </button>

      <div className="flex gap-1 overflow-x-auto md:flex-col">
        {PRIMARY.map((l) => (
          <NavItem key={l.href} link={l} path={path} counts={counts} />
        ))}
        {/* On phones everything shares one scrolling row; on desktop the rest sits under "More". */}
        {MORE.map((l) => (
          <NavItem key={l.href} link={l} path={path} counts={counts} className="md:hidden" />
        ))}
      </div>

      {tree.length ? (
        <div className="hidden flex-col md:flex">
          <div className="flex items-center justify-between px-3 pb-1">
            <Link href="/companies" className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-700">
              Companies
            </Link>
          </div>
          <ul className="space-y-0.5 text-sm">
            {tree.map((c) => {
              const key = c.id ?? "none";
              const holdsCurrent = c.projects.some((p) => path.startsWith(`/projects/${p.slug}`)) || (!!c.slug && path.startsWith(`/companies/${c.slug}`));
              const expanded = isOpen(key, holdsCurrent);
              const companyActive = !!c.slug && path === `/companies/${c.slug}`;
              return (
                <li key={key}>
                  <div className={clsx("group flex items-center rounded-lg", companyActive ? "bg-black/10" : "hover:bg-black/5")}>
                    <button
                      type="button"
                      onClick={() => toggle(key, expanded)}
                      aria-label={expanded ? `Collapse ${c.name}` : `Expand ${c.name}`}
                      aria-expanded={expanded}
                      className="grid h-7 w-6 shrink-0 place-items-center text-[10px] text-zinc-400 hover:text-zinc-700"
                    >
                      {expanded ? "▾" : "▸"}
                    </button>
                    {c.slug ? (
                      <Link href={`/companies/${c.slug}`} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 font-semibold text-zinc-700">
                        <span aria-hidden>{c.emoji}</span>
                        <span className="truncate">{c.name}</span>
                        {c.asks ? <span className="ml-auto text-[11px] font-bold text-rose-600">{c.asks}</span> : null}
                      </Link>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 font-semibold text-zinc-500">
                        <span aria-hidden>{c.emoji}</span>
                        <span className="truncate">{c.name}</span>
                        {c.asks ? <span className="ml-auto text-[11px] font-bold text-rose-600">{c.asks}</span> : null}
                      </span>
                    )}
                  </div>
                  {expanded ? (
                    <ul className="ml-6 border-l border-black/10 pl-1">
                      {c.projects.map((p) => {
                        const active = path.startsWith(`/projects/${p.slug}`);
                        return (
                          <li key={p.id}>
                            <Link
                              href={`/projects/${p.slug}`}
                              className={clsx(
                                "flex items-center gap-1.5 rounded-lg px-2 py-1",
                                active ? "bg-ink font-semibold text-paper" : "text-zinc-600 hover:bg-black/5",
                              )}
                            >
                              <span aria-hidden>{p.emoji}</span>
                              <span className="truncate">{p.name}</span>
                              {p.asks ? (
                                <span className={clsx("ml-auto text-[11px] font-bold", active ? "text-rose-300" : "text-rose-600")}>{p.asks}</span>
                              ) : null}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="hidden md:block">
        <button
          type="button"
          onClick={() => toggle(MORE_KEY, moreOpen)}
          aria-expanded={moreOpen}
          className="flex w-full items-center gap-2 px-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-700"
        >
          <span className="w-3 text-[10px]">{moreOpen ? "▾" : "▸"}</span>
          More
          {!moreOpen && counts.unfiled ? <span className="ml-auto rounded-full bg-amber-300 px-2 text-[10px] text-amber-950">{counts.unfiled} unfiled</span> : null}
        </button>
        {moreOpen ? (
          <div className="flex flex-col gap-0.5">
            {MORE.map((l) => (
              <NavItem key={l.href} link={l} path={path} counts={counts} dense />
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function NavItem({ link: l, path, counts, className, dense }: { link: NavLink; path: string; counts: NavCounts; className?: string; dense?: boolean }) {
  const active = isActive(path, l.href);
  const n = l.badge ? counts[l.badge] : 0;
  return (
    <Link
      href={l.href}
      className={clsx(
        "flex shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition",
        dense ? "py-1.5" : "py-2",
        active ? "bg-ink text-paper shadow-sm" : "text-zinc-700 hover:bg-black/5",
        className,
      )}
    >
      <span aria-hidden>{l.icon}</span>
      <span>{l.label}</span>
      {n > 0 ? <span className={clsx("ml-auto rounded-full px-2 text-xs font-bold", l.tone)}>{n}</span> : null}
    </Link>
  );
}
