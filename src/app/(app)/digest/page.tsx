import Link from "next/link";
import { markDigestSeenAction } from "@/app/actions";
import { Character } from "@/components/Character";
import { StatusPill } from "@/components/StatusPill";
import { TodoList } from "@/components/TodoList";
import { commentTargets, getRecentComments } from "@/lib/comments";
import { digestSince, getDigest } from "@/lib/digest";
import { KIND_LABEL, headline, timeAgo } from "@/lib/format";
import { orgOptions } from "@/lib/queries";
import { personHref, projectHref } from "@/lib/links";
import type { SessionRow } from "@/lib/types";

function Section({ icon, title, count, children }: { icon: string; title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section className="space-y-2 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="font-display text-lg font-bold">
        {icon} {title} <span className="text-sm font-semibold text-zinc-400">· {count}</span>
      </h2>
      {children}
    </section>
  );
}

export default async function DigestPage({ searchParams }: { searchParams: Promise<{ since?: string }> }) {
  const { since: sinceParam } = await searchParams;
  const since = await digestSince(sinceParam);
  const [d, notes] = await Promise.all([getDigest(since), getRecentComments(since, 20)]);
  const noteTargets = await commentTargets(notes, d.org);
  const agentOf = (s: SessionRow | null) => d.org.agents.find((a) => a.id === s?.agent_id) ?? null;
  const projectOf = (id: string | null) => d.org.projects.find((p) => p.id === id) ?? null;

  const SessionLine = ({ s, note }: { s: SessionRow; note?: string | null }) => {
    const agent = agentOf(s);
    return (
      <li className="flex items-center gap-3 py-1.5">
        {agent ? <Character spec={agent.avatar} pose={s.status === "done" ? "done" : s.status === "failed" ? "failed" : "working"} desk={false} size={40} /> : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                {s.title}
              </a>
            ) : (
              s.title
            )}
          </div>
          <div className="truncate text-xs text-zinc-500">
            {agent ? (
              <Link href={personHref(agent.id)} className="font-semibold hover:underline">
                {agent.name}
              </Link>
            ) : null}
            {projectOf(s.project_id) ? (
              <Link href={projectHref(projectOf(s.project_id)!.slug)} className="hover:underline">
                {" "}
                · {projectOf(s.project_id)!.emoji} {projectOf(s.project_id)!.name}
              </Link>
            ) : null}
            {agent || s.project_id ? " · " : ""}
            {note ?? s.status_detail ?? s.summary ?? ""}
          </div>
        </div>
        <span className="shrink-0 text-xs text-zinc-400">{timeAgo(s.last_activity_at)}</span>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <header className="overflow-hidden rounded-[32px] bg-gradient-to-br from-sky-100 via-white to-emerald-100 p-6 ring-1 ring-black/5 sm:p-8">
        <p className="text-sm font-bold uppercase tracking-widest text-sky-700/70">
          Since {sinceParam === "7d" ? "last week" : sinceParam === "24h" ? "yesterday" : `you were last here · ${timeAgo(since)}`}
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">{headline(d)}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {[
            ["", "Since last visit"],
            ["24h", "Last 24h"],
            ["7d", "Last 7 days"],
          ].map(([v, label]) => (
            <Link
              key={label}
              href={v ? `/digest?since=${v}` : "/digest"}
              className={`rounded-full px-3 py-1 font-semibold ring-1 ring-black/10 ${(sinceParam ?? "") === v ? "bg-ink text-paper" : "bg-white/70"}`}
            >
              {label}
            </Link>
          ))}
          <form action={markDigestSeenAction} className="ml-auto">
            <button className="rounded-full bg-emerald-500 px-4 py-1.5 font-bold text-white shadow-sm hover:bg-emerald-600">✓ Mark all as read</button>
          </form>
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section icon="🏆" title="Goals achieved" count={d.goalsAchieved.length}>
          <ul className="space-y-1 text-sm">
            {d.goalsAchieved.map((g) => (
              <li key={g.id}>
                <b>{g.title}</b> <span className="text-zinc-500">· {projectOf(g.project_id)?.name}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon="🙋" title="New asks for you" count={d.newAsks.length}>
          <ul className="divide-y divide-zinc-50">
            {d.newAsks.map(({ task, session }) => (
              <li key={task.id} className="flex items-center gap-3 py-1.5">
                <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">{KIND_LABEL[task.kind]}</span>
                {session ? (
                  <Link href={`/sessions/${session.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">
                    {task.title}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{task.title}</span>
                )}
                <span className="shrink-0 text-xs text-zinc-400">{agentOf(session)?.name ?? ""}</span>
              </li>
            ))}
          </ul>
          <Link href="/inbox" className="text-sm font-semibold text-rose-700 hover:underline">
            Answer them →
          </Link>
        </Section>

        <Section icon="🚀" title="Shipped" count={d.shipped.length}>
          <ul className="divide-y divide-zinc-50">
            {d.shipped.map((s) => (
              <SessionLine key={s.id} s={s} />
            ))}
          </ul>
        </Section>

        <Section icon="🧯" title="Got stuck" count={d.stuck.length}>
          <ul className="divide-y divide-zinc-50">
            {d.stuck.map((s) => (
              <SessionLine key={s.id} s={s} />
            ))}
          </ul>
        </Section>

        <Section icon="📈" title="Goals that moved" count={d.goalsMoving.length}>
          <ul className="space-y-2">
            {d.goalsMoving.map((g) => (
              <li key={g.goal.id} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <b>🎯 {g.goal.title}</b>
                  <span className="text-zinc-500">{Math.round(g.progress * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.round(g.progress * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon="⏰" title="Your to-dos due soon" count={d.dueSoon.length}>
          <TodoList items={d.dueSoon} options={orgOptions(d.org)} />
        </Section>

        <Section icon="🔨" title="Still in progress" count={d.working.length}>
          <ul className="divide-y divide-zinc-50">
            {d.working.map((s) => (
              <SessionLine key={s.id} s={s} />
            ))}
          </ul>
        </Section>

        <Section icon="✅" title="You handled" count={d.handled.length}>
          <ul className="space-y-1 text-sm text-zinc-600">
            {d.handled.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="truncate line-through decoration-zinc-300">{t.title}</span>
                <span className="shrink-0 text-xs text-zinc-400">{timeAgo(t.resolved_at)}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon="💬" title="Notes and comments" count={notes.length}>
          <ul className="space-y-2">
            {notes.map((n) => {
              const t = noteTargets.get(n.id);
              return (
                <li key={n.id} className="text-sm">
                  {t ? (
                    <Link href={t.href} className="block truncate text-xs font-bold text-zinc-500 hover:underline">
                      {t.label}
                    </Link>
                  ) : null}
                  <p className="line-clamp-3 whitespace-pre-wrap text-zinc-700">{n.body}</p>
                  <span className="text-[11px] text-zinc-400">{timeAgo(n.created_at)}</span>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section icon="🆕" title="New sessions" count={d.newSessions.length}>
          <ul className="space-y-1 text-sm">
            {d.newSessions.slice(0, 12).map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <StatusPill status={s.status} />
                <span className="truncate">{s.title}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon="👋" title="New teammates" count={d.newTeammates.length}>
          <div className="flex flex-wrap gap-3">
            {d.newTeammates.map((a) => (
              <div key={a.id} className="flex flex-col items-center text-center">
                <Character spec={a.avatar} pose="done" desk={false} size={64} />
                <span className="text-xs font-bold">{a.name}</span>
                <span className="text-[10px] text-zinc-500">{a.role}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
