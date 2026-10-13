"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyProposalAction, startOrganizeAction } from "@/app/actions";
import { Character } from "./Character";
import { SourcesPanel, type SourceInfo } from "./SourcesPanel";
import { PROP_KINDS, type Proposal } from "@/lib/classify/schema";
import type { OrganizeJob } from "@/lib/organize";

interface SessionBrief {
  id: string;
  title: string;
}

export function SetupWizard({
  info,
  job: initialJob,
  proposal,
  sessions,
  claudeAvailable,
}: {
  info: SourceInfo;
  job: OrganizeJob | null;
  proposal: { id: string; engine: string; body: Proposal } | null;
  sessions: SessionBrief[];
  claudeAvailable: boolean;
}) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [starting, startTransition] = useTransition();
  const total = Object.values(info.counts).reduce((a, b) => a + b, 0);
  const running = job?.state === "running";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const next = (await fetch("/api/organize", { cache: "no-store" }).then((r) => r.json())) as OrganizeJob;
      setJob(next);
      if (next.state !== "running") router.refresh();
    }, 1500);
    return () => clearInterval(t);
  }, [running, router]);

  const step = proposal ? 3 : running ? 2 : 1;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col items-start justify-between gap-6 rounded-[32px] bg-gradient-to-br from-violet-100 via-amber-50 to-emerald-100 p-6 ring-1 ring-black/5 sm:flex-row sm:items-end sm:p-8">
        <div className="max-w-xl">
          <p className="text-sm font-bold uppercase tracking-widest text-violet-700/70">Welcome to Timu</p>
          <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">Let&apos;s meet your Claude team</h1>
          <p className="mt-2 text-zinc-600">
            Import your sessions and Timu will organise them into projects, teams and teammates, then show you what&apos;s waiting on you.
          </p>
          <ol className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
            {["Import sessions", "Build the team", "Review & hire"].map((label, i) => (
              <li
                key={label}
                className={`rounded-full px-3 py-1 ${step === i + 1 ? "bg-ink text-paper" : step > i + 1 ? "bg-emerald-200 text-emerald-900" : "bg-white/70 text-zinc-500"}`}
              >
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </div>
        <div className="-mb-8 flex -space-x-6">
          {["Maya:SEO", "Omar:Dev", "Lena:Design"].map((seed, i) => (
            <Character key={seed} spec={{ seed, prop: (["magnifier", "laptop", "palette"] as const)[i] }} pose={(["needs_you", "working", "idle"] as const)[i]} size={110} desk={false} />
          ))}
        </div>
      </header>

      {step === 1 ? (
        <>
          <SourcesPanel info={info} />
          <div className="flex flex-col items-start gap-3 rounded-3xl bg-ink p-6 text-paper sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-xl font-bold">{total} session{total === 1 ? "" : "s"} imported</h2>
              <p className="text-sm text-white/70">
                {claudeAvailable
                  ? "Claude will read them and propose projects, teams, teammates and goals. You review before anything is saved."
                  : "The Claude CLI isn't installed here — Timu will group sessions with simple rules (by repo and keywords). Install Claude Code and sign in for smarter teams."}
              </p>
              {job?.state === "error" ? <p className="mt-2 text-sm font-semibold text-rose-300">Last run failed: {job.error}</p> : null}
            </div>
            <div className="flex shrink-0 gap-2">
              {job?.state === "error" && job.engine === "claude" ? (
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => startTransition(async () => setJob(await startOrganizeAction("setup", true)))}
                  className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold ring-1 ring-white/30"
                >
                  Use rules instead
                </button>
              ) : null}
              <button
                type="button"
                disabled={total === 0 || starting}
                onClick={() => startTransition(async () => setJob(await startOrganizeAction("setup")))}
                className="rounded-2xl bg-amber-400 px-5 py-3 font-display text-lg font-bold text-ink shadow disabled:opacity-40"
              >
                Build my team →
              </button>
            </div>
          </div>
        </>
      ) : null}

      {step === 2 && job ? <Organizing job={job} /> : null}

      {step === 3 && proposal ? <OrgEditor proposal={proposal} sessions={sessions} onDone={() => router.push("/")} /> : null}
    </div>
  );
}

function Organizing({ job }: { job: OrganizeJob }) {
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 5;
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-white p-10 text-center shadow-sm ring-1 ring-black/5">
      <div className="flex -space-x-4">
        {["A", "B", "C", "D"].map((s, i) => (
          <Character key={s} spec={{ seed: `hire-${s}`, prop: (["laptop", "chart", "notepad", "megaphone"] as const)[i] }} pose="working" size={120} />
        ))}
      </div>
      <h2 className="font-display text-2xl font-bold">{job.engine === "claude" ? "Claude is interviewing your sessions…" : "Sorting your sessions…"}</h2>
      <p className="text-zinc-500">
        {job.done} / {job.total || "…"} sessions read
      </p>
      <div className="h-3 w-full max-w-md overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${Math.max(pct, 5)}%` }} />
      </div>
    </div>
  );
}

function OrgEditor({ proposal, sessions, onDone }: { proposal: { id: string; engine: string; body: Proposal }; sessions: SessionBrief[]; onDone: () => void }) {
  const [org, setOrg] = useState<Proposal>(() => structuredClone(proposal.body));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const titles = useMemo(() => new Map(sessions.map((s) => [s.id, s.title])), [sessions]);

  const update = (fn: (draft: Proposal) => void) =>
    setOrg((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });

  const removeMember = (pi: number, ti: number, mi: number) =>
    update((d) => {
      const team = d.projects[pi].teams[ti];
      const gone = team.members[mi];
      const heir = team.members.find((_, i) => i !== mi);
      if (!heir) return;
      for (const a of d.assignments) if (a.member_key === gone.key) a.member_key = heir.key;
      team.members.splice(mi, 1);
    });

  const needsYou = org.assignments.filter((a) => a.attention !== "none").length;

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-emerald-50 p-5 ring-1 ring-emerald-200">
        <h2 className="font-display text-xl font-bold">Here&apos;s your team</h2>
        <p className="text-sm text-emerald-900/80">
          {org.projects.length} projects · {org.projects.reduce((n, p) => n + p.teams.reduce((m, t) => m + t.members.length, 0), 0)} teammates ·{" "}
          {org.assignments.length} sessions filed · {needsYou} waiting on you. Rename anyone, drop goals you don&apos;t want, then hire them.
          {proposal.engine === "heuristic" ? " (Organised by rules — install Claude Code and sign in for Claude-picked teams.)" : ""}
        </p>
      </div>

      {org.projects.map((p, pi) => (
        <section key={p.key} className="space-y-4 rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={p.emoji}
              onChange={(e) => update((d) => void (d.projects[pi].emoji = e.target.value))}
              className="w-14 rounded-xl border-0 bg-zinc-50 p-2 text-center text-2xl ring-1 ring-black/10"
              aria-label="Project emoji"
            />
            <input
              value={p.name}
              onChange={(e) => update((d) => void (d.projects[pi].name = e.target.value))}
              className="min-w-0 flex-1 rounded-xl border-0 bg-zinc-50 px-3 py-2 font-display text-xl font-bold ring-1 ring-black/10"
              aria-label="Project name"
            />
            <input
              value={p.company ?? ""}
              onChange={(e) => update((d) => void (d.projects[pi].company = e.target.value || null))}
              placeholder="Company (optional)"
              className="w-48 rounded-xl border-0 bg-sky-50 px-3 py-2 text-sm font-semibold ring-1 ring-sky-200"
              aria-label="Company"
            />
          </div>
          <p className="text-sm text-zinc-500">{p.description}</p>

          {p.goals.length ? (
            <div className="space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-400">Goals</h3>
              {p.goals.map((g, gi) => (
                <div key={g.key} className="flex items-center gap-2">
                  <span aria-hidden>🎯</span>
                  <input
                    value={g.title}
                    onChange={(e) => update((d) => void (d.projects[pi].goals[gi].title = e.target.value))}
                    className="min-w-0 flex-1 rounded-lg border-0 bg-zinc-50 px-2 py-1 text-sm ring-1 ring-black/10"
                    aria-label="Goal"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      update((d) => {
                        d.projects[pi].goals.splice(gi, 1);
                        for (const a of d.assignments) if (a.goal_key === g.key) a.goal_key = null;
                      })
                    }
                    className="rounded-lg px-2 text-sm text-zinc-400 hover:text-rose-600"
                    aria-label="Remove goal"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {p.teams.map((t, ti) => (
              <div key={t.key} className="space-y-3 rounded-2xl bg-amber-50/60 p-4 ring-1 ring-amber-200/60">
                <input
                  value={t.name}
                  onChange={(e) => update((d) => void (d.projects[pi].teams[ti].name = e.target.value))}
                  className="w-full rounded-lg border-0 bg-white px-2 py-1 font-display text-lg font-bold ring-1 ring-black/10"
                  aria-label="Team name"
                />
                {t.members.map((m, mi) => {
                  const mine = org.assignments.filter((a) => a.member_key === m.key);
                  const waiting = mine.some((a) => a.attention !== "none");
                  return (
                    <div key={m.key} className="flex gap-3 rounded-xl bg-white p-2 ring-1 ring-black/5">
                      <Character spec={{ seed: `${m.name}:${m.role}`, prop: m.prop }} pose={waiting ? "needs_you" : "working"} size={92} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex gap-1">
                          <input
                            value={m.name}
                            onChange={(e) => update((d) => void (d.projects[pi].teams[ti].members[mi].name = e.target.value))}
                            className="w-24 rounded-md border-0 bg-zinc-50 px-2 py-1 text-sm font-bold ring-1 ring-black/10"
                            aria-label="Name"
                          />
                          <input
                            value={m.role}
                            onChange={(e) => update((d) => void (d.projects[pi].teams[ti].members[mi].role = e.target.value))}
                            className="min-w-0 flex-1 rounded-md border-0 bg-zinc-50 px-2 py-1 text-sm ring-1 ring-black/10"
                            aria-label="Role"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={m.prop}
                            onChange={(e) => update((d) => void (d.projects[pi].teams[ti].members[mi].prop = e.target.value as (typeof PROP_KINDS)[number]))}
                            className="rounded-md border-0 bg-zinc-50 py-0.5 pl-2 pr-6 text-xs ring-1 ring-black/10"
                            aria-label="Prop"
                          >
                            {PROP_KINDS.map((k) => (
                              <option key={k}>{k}</option>
                            ))}
                          </select>
                          {t.members.length > 1 ? (
                            <button type="button" onClick={() => removeMember(pi, ti, mi)} className="text-xs text-zinc-400 hover:text-rose-600">
                              merge into teammate
                            </button>
                          ) : null}
                        </div>
                        <details className="text-xs text-zinc-500">
                          <summary className="cursor-pointer">
                            {mine.length} session{mine.length === 1 ? "" : "s"}
                            {waiting ? <span className="ml-1 font-bold text-rose-600">· needs you</span> : null}
                          </summary>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4">
                            {mine.slice(0, 12).map((a) => (
                              <li key={a.session_id} className={a.attention !== "none" ? "text-rose-700" : ""}>
                                {titles.get(a.session_id) ?? a.summary}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-3xl bg-ink p-4 text-paper shadow-xl">
        <p className="text-sm text-white/70">{error ?? "Nothing is saved until you hire the team."}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await applyProposalAction(proposal.id, JSON.stringify(org));
              if (r.ok) onDone();
              else setError(r.message);
            })
          }
          className="shrink-0 rounded-2xl bg-amber-400 px-5 py-3 font-display text-lg font-bold text-ink disabled:opacity-60"
        >
          {pending ? "Hiring…" : "Hire the team 🎉"}
        </button>
      </div>
    </div>
  );
}
