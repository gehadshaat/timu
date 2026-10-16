"use client";

import { useState, useTransition } from "react";
import { pushClickUpAction, type ActionResult } from "@/app/actions";
import type { MirrorStatus } from "@/lib/clickup/mirror";
import { SUGGESTED_STATUSES } from "@/lib/clickup/statuses";
import { Ago } from "./ui/Ago";

const code = "rounded bg-zinc-100 px-1";

/** The ClickUp mirror on the Settings page: how to turn it on, what's mirrored, and a push button. */
export function ClickUpPanel({ status }: { status: MirrorStatus }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const m = status.mirrored;
  const counts = [
    [m.sessions, "session"],
    [m.goals, "goal"],
    [m.milestones, "milestone"],
    [m.todos, "to-do"],
  ]
    .filter(([n]) => n)
    .map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`)
    .join(", ");
  const failed = status.lastOk === false && !result ? status.lastMessage : null;

  return (
    <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <span aria-hidden className="text-2xl">🗂️</span>
        Mirror into ClickUp
      </h2>
      <p className="text-sm text-zinc-600">
        After every sync, Timu pushes your org into one ClickUp Space: a folder per project, a list per team plus 🎯 Goals and ✅ To-dos, and a task
        for every session, goal, milestone and to-do, with the status its board shows and the teammate as a tag. It only sends what changed. It&apos;s
        one-way: edits made in ClickUp are replaced the next time that thing changes in Timu.
      </p>
      {!status.configured ? (
        <div className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
          <p>
            <b>Off.</b> In ClickUp, open <b>Settings → Apps</b> and copy your <b>API Token</b> (it starts with <code>pk_</code>). Put it in .env.local as{" "}
            <code>CLICKUP_API_TOKEN=pk_…</code> and restart Timu.
          </p>
          <p>
            Timu writes into a Space called &ldquo;Timu&rdquo; in your first workspace, and makes it if it&apos;s missing. To use a Space you already have, set{" "}
            <code>CLICKUP_SPACE_ID</code> (the number after <code>/s/</code> in its link).
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900 ring-1 ring-emerald-200">
            <b>🟢 On.</b>{" "}
            {status.spaceId ? (
              <>
                Mirroring into space <code>{status.spaceId}</code>
                {status.workspaceId ? (
                  <>
                    {" "}
                    of{" "}
                    <a className="font-semibold underline" href={`https://app.clickup.com/${status.workspaceId}`} target="_blank" rel="noreferrer">
                      your workspace ↗
                    </a>
                  </>
                ) : null}
                {counts ? `: ${counts}.` : "."}
              </>
            ) : (
              "Nothing pushed yet; the next sync makes the space."
            )}
            {status.lastAt ? (
              <span className="mt-1 block text-emerald-800/80">
                Last push <Ago iso={status.lastAt} />: {status.lastOk === false ? "failed" : status.lastMessage}
              </span>
            ) : null}
          </p>
          {failed ? <p className="text-sm font-semibold text-rose-700">⚠ {failed}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending || status.running}
              onClick={() => start(async () => setResult(await pushClickUpAction()))}
              className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
            >
              {pending || status.running ? "Pushing…" : "Push to ClickUp now"}
            </button>
            {result ? <p className={`text-sm font-semibold ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>{result.ok ? "✓ " : "⚠ "}{result.message}</p> : null}
          </div>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-zinc-700">Statuses</summary>
        <p className="mt-2 text-xs text-zinc-600">
          ClickUp doesn&apos;t let apps create statuses, so Timu matches the Space&apos;s own by name. For an exact fit, add these to the Timu Space (Space
          settings → Statuses):{" "}
          {SUGGESTED_STATUSES.map((s, i) => (
            <span key={s.name}>
              {i ? ", " : ""}
              <code className={code}>{s.name}</code> ({s.type === "custom" ? "active" : s.type === "open" ? "not started" : "closed"})
            </span>
          ))}
          . Without them, sessions use &ldquo;to do&rdquo;, &ldquo;in progress&rdquo; and &ldquo;complete&rdquo;, and the task says the exact status.
        </p>
      </details>
    </section>
  );
}
