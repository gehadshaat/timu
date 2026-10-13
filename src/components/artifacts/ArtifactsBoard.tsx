"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import clsx from "clsx";
import { importArtifactsAction, moveArtifactAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";
import { projectHref } from "@/lib/links";
import type { OrgOptions } from "@/lib/queries";
import { groupColor } from "../board/palette";
import { OrgPicker } from "../ui/Picker";
import { Popover } from "../ui/Popover";
import { useToast } from "../ui/Toaster";

/**
 * Claude artifacts as a board: a group per project (unfiled last), a row per artifact — title
 * (opens it on claude.ai), project (click to move), the session that links to it, and when it changed.
 */

export interface ArtifactItem {
  id: string;
  url: string;
  title: string;
  owner: "mine" | "shared" | null;
  updatedAt: string | null;
  filedBy: "session" | "title" | "you" | null;
  project: { id: string; name: string; emoji: string; slug: string } | null;
  company: { id: string; name: string; emoji: string } | null;
  session: { id: string; title: string } | null;
}

/** Artifact · Project · Session (from md) · Updated (from sm). */
const COLS = "grid grid-cols-[minmax(0,1fr)_8rem] sm:grid-cols-[minmax(0,1fr)_10rem_5.5rem] md:grid-cols-[minmax(0,1fr)_11rem_14rem_6rem]";

const FILED: Record<string, string> = { session: "from its session", title: "by its title", you: "by you" };

function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  return now;
}

function ProjectCell({ a, options }: { a: ArtifactItem; options: OrgOptions }) {
  const [pending, start] = useTransition();
  const { toast } = useToast();
  return (
    <Popover
      floating
      align="right"
      panelClassName="w-80"
      title={a.filedBy ? `Filed ${FILED[a.filedBy]} — click to move` : "Click to file it"}
      className={clsx("flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs hover:bg-zinc-100", pending && "opacity-50")}
      label={
        a.project ? (
          <span className="min-w-0">
            <span className="block truncate font-semibold">
              {a.project.emoji} {a.project.name}
            </span>
            {a.filedBy ? <span className="block truncate text-[10px] text-zinc-400">{FILED[a.filedBy]}</span> : null}
          </span>
        ) : a.company ? (
          <span className="truncate text-zinc-600">
            {a.company.emoji} {a.company.name} · <span className="text-amber-700">pick a project</span>
          </span>
        ) : (
          <span className="font-semibold text-amber-700">+ File it</span>
        )
      }
    >
      {(close) => (
        <OrgPicker
          options={options}
          kinds={["project"]}
          none={{ kind: "project", label: "🚫 No project" }}
          placeholder="Search projects…"
          onPick={(p) => {
            close();
            start(async () => {
              const r = await moveArtifactAction(a.id, p.id);
              toast({ message: r.message, tone: r.ok ? undefined : "error" });
            });
          }}
        />
      )}
    </Popover>
  );
}

function Row({ a, color, options, now }: { a: ArtifactItem; color: string; options: OrgOptions; now: number | null }) {
  return (
    <div className={clsx(COLS, "border-t border-zinc-100 bg-white hover:bg-zinc-50")}>
      <div className="flex min-w-0 items-center gap-2 border-l-[6px] py-2 pl-2 pr-2" style={{ borderColor: color }}>
        <span aria-hidden className="text-sm">🖼️</span>
        <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sm font-semibold hover:underline" title={`Open “${a.title}” on claude.ai`}>
          {a.title}
        </a>
        {a.owner === "shared" ? <span className="shrink-0 rounded-full bg-sky-100 px-1.5 text-[10px] font-bold text-sky-700">shared with you</span> : null}
        {a.id.startsWith("chat-") ? <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">in a chat</span> : null}
        <a href={a.url} target="_blank" rel="noreferrer" className="ml-auto shrink-0 rounded-xl bg-ink px-2 py-1 text-xs font-bold text-paper shadow-sm hover:opacity-90">
          Open ↗
        </a>
      </div>
      <div className="flex min-w-0 items-center border-l border-zinc-100 px-1 [&>div]:w-full">
        <ProjectCell a={a} options={options} />
      </div>
      <div className="hidden min-w-0 items-center border-l border-zinc-100 px-2 md:flex">
        {a.session ? (
          <Link href={`/sessions/${a.session.id}`} className="truncate text-xs text-zinc-600 hover:underline" title={a.session.title}>
            ⚡ {a.session.title}
          </Link>
        ) : (
          <span className="text-xs text-zinc-300">—</span>
        )}
      </div>
      <div className="hidden items-center justify-center border-l border-zinc-100 text-xs text-zinc-500 sm:flex">{a.updatedAt && now ? timeAgo(a.updatedAt, now) : "—"}</div>
    </div>
  );
}

export function ArtifactsBoard({ items, options, grouped = true, empty }: { items: ArtifactItem[]; options: OrgOptions; grouped?: boolean; empty?: React.ReactNode }) {
  const now = useNow();
  if (!items.length) return empty ? <div className="rounded-3xl border-2 border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">{empty}</div> : null;
  const groups: { key: string; label: React.ReactNode; items: ArtifactItem[] }[] = [];
  for (const a of items) {
    // By project; ones only matched to a company get that company's group; the rest go last.
    const key = !grouped ? "all" : a.project ? a.project.id : a.company ? `company:${a.company.id}` : "none";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const label = !grouped ? null : a.project ? (
        <Link href={projectHref(a.project.slug)} className="hover:underline">
          {a.project.emoji} {a.project.name}
        </Link>
      ) : a.company ? (
        <span>
          {a.company.emoji} {a.company.name} <span className="text-sm font-semibold text-zinc-400">· pick a project</span>
        </span>
      ) : (
        "Not filed yet"
      );
      groups.push((g = { key, label, items: [] }));
    }
    g.items.push(a);
  }
  groups.sort((x, y) => Number(x.key === "none") - Number(y.key === "none"));

  return (
    <div className="space-y-6">
      {groups.map((g, i) => {
        const color = g.key === "none" ? "#c4c4c4" : groupColor(i);
        return (
          <section key={g.key}>
            {g.label ? (
              <h3 className="flex items-center gap-2 px-1 pb-1 text-lg font-bold" style={{ color }}>
                {g.label} <span className="text-xs font-semibold text-zinc-400">{g.items.length}</span>
              </h3>
            ) : null}
            <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
              <div className={clsx(COLS, "text-[11px] font-semibold text-zinc-500")}>
                <div className="flex items-center border-l-[6px] py-1.5 pl-2" style={{ borderColor: color }}>
                  Artifact
                </div>
                <div className="flex items-center border-l border-white px-2">Project</div>
                <div className="hidden items-center border-l border-white px-2 md:flex">Session</div>
                <div className="hidden items-center justify-center border-l border-white sm:flex">Updated</div>
              </div>
              {g.items.map((a) => (
                <Row key={a.id} a={a} color={color} options={options} now={now} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Paste the list Claude prints when you ask for your artifacts. */
export function ArtifactsImport() {
  const [result, action, pending] = useActionState(importArtifactsAction, null);
  return (
    <details className="group rounded-2xl bg-white/70 p-3 ring-1 ring-black/5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm font-semibold text-zinc-600">
        <span className="inline-block w-4 text-xs text-zinc-400 group-open:rotate-90">▸</span> Update artifacts
        {result ? <span className={result.ok ? "text-emerald-700" : "text-rose-700"}>· {result.message}</span> : null}
      </summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm text-zinc-600">
          <p>
            <b>Easiest:</b> with Timu connected over MCP, ask Claude <i>“list my artifacts and import them into Timu”</i> — it reads your gallery and sends the list here.
          </p>
          <p>
            <b>Or paste</b> the list Claude prints when you ask for your artifacts (one <code>claude.ai/artifact/…</code> link per line). Artifacts linked from your sessions show up on their own.
          </p>
        </div>
        <form action={action} className="space-y-2">
          <textarea
            name="text"
            rows={5}
            placeholder={"- (mine) Sunbeam SEO Audit — https://claude.ai/artifact/AbCdEf123 — updated 2026-10-13"}
            aria-label="Artifacts list"
            className="w-full rounded-xl border-0 bg-zinc-50 px-3 py-2 font-mono text-xs ring-1 ring-black/10"
          />
          <button disabled={pending} className="rounded-xl bg-ink px-3 py-1.5 text-sm font-bold text-paper disabled:opacity-40">
            {pending ? "Importing…" : "Import artifacts"}
          </button>
        </form>
      </div>
    </details>
  );
}
