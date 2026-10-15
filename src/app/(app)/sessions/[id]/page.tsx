import Link from "next/link";
import { notFound } from "next/navigation";
import { AskList } from "@/components/asks/AskList";
import { ArtifactsBoard } from "@/components/artifacts/ArtifactsBoard";
import { getArtifacts } from "@/lib/artifacts";
import { OpenSession } from "@/components/asks/AskActions";
import { Character } from "@/components/Character";
import { CommentThread } from "@/components/comments/CommentThread";
import { Crumbs } from "@/components/Crumbs";
import { SessionControls } from "@/components/sessions/SessionControls";
import { SourceBadge } from "@/components/SourceBadge";
import { StatusPill } from "@/components/StatusPill";
import { Renameable } from "@/components/ui/Renameable";
import { toAskView } from "@/lib/ask-view";
import { getComments } from "@/lib/comments";
import { KIND_LABEL, timeAgo } from "@/lib/format";
import { isUuid } from "@/lib/db";
import { personHref, projectHref, resumeFor } from "@/lib/links";
import { getSessionDetail, orgOptions } from "@/lib/queries";

const ENGINE: Record<string, string> = { typesafe: "🧠 TypeSafe Jev", claude: "✨ Claude", rules: "📏 Rules", status: "📡 Session status", you: "👤 You" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [detail, comments] = await Promise.all([getSessionDetail(id), getComments("session", id)]);
  if (!detail) notFound();
  const { session: s, tasks, agent, team, project, company, goal, org } = detail;
  const options = orgOptions(org);
  const now = Date.now();
  const open = tasks.filter((t) => t.status === "open" || (t.status === "snoozed" && (!t.snoozed_until || Date.parse(t.snoozed_until) < now)));
  const snoozed = tasks.filter((t) => t.status === "snoozed" && t.snoozed_until && Date.parse(t.snoozed_until) >= now);
  const past = tasks.filter((t) => t.status === "done");
  const asks = open.map((task) => toAskView({ task, session: s, agent, team, project }, org));
  const resume = resumeFor(s);
  const v = s.triage;
  const artifacts = getArtifacts(org, { sessionId: s.id });

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/sessions" className="text-sm font-semibold text-zinc-500 hover:underline">
            ← All sessions
          </Link>
          <Crumbs company={company} project={project} team={team} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={s.source} />
          <StatusPill status={s.status} />
          {s.archived ? <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-bold text-white">Archived</span> : null}
          {s.title_locked ? <span className="text-[11px] font-semibold text-zinc-400">✏️ your title</span> : null}
        </div>
        <Renameable kind="session" id={s.id} value={s.title} as="h1" className="font-display text-3xl font-bold" label="Rename session" />
        {s.summary && s.summary !== s.title ? <p className="max-w-3xl text-zinc-600">{s.summary}</p> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
          {s.repo ? <span className="font-mono">{s.repo}</span> : null}
          {s.branch ? <span className="font-mono">⎇ {s.branch}</span> : null}
          <span>{s.message_count} messages</span>
          {s.started_at ? <span>started {timeAgo(s.started_at)}</span> : null}
          <span>last active {timeAgo(s.last_activity_at)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <OpenSession url={s.url} resume={resume} />
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {asks.length ? (
            <div className="space-y-2">
              <h2 className="font-display text-xl font-bold">🙋 Waiting on you</h2>
              <AskList asks={asks} />
            </div>
          ) : null}
          {snoozed.length ? (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
              ⏰ Snoozed: <b>{snoozed[0].title}</b> — back {timeAgo(snoozed[0].snoozed_until)}.
            </p>
          ) : null}

          <div className="space-y-3 rounded-3xl bg-white p-4 ring-1 ring-black/5 sm:p-5">
            <h2 className="font-display text-lg font-bold">What happened</h2>
            {s.first_user_message ? (
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">You asked</p>
                <blockquote className="line-clamp-6 whitespace-pre-wrap rounded-2xl bg-amber-50 px-3 py-2 text-sm text-zinc-700">{s.first_user_message}</blockquote>
              </div>
            ) : null}
            {s.status_detail ? (
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Where it stands</p>
                <p className="text-sm text-zinc-700">{s.status_detail}</p>
              </div>
            ) : null}
            {s.last_message ? (
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Last message · {s.last_message_role === "user" ? "you" : "Claude"}</p>
                <blockquote className="line-clamp-[12] whitespace-pre-wrap rounded-2xl bg-zinc-50 px-3 py-2 text-sm italic text-zinc-700 ring-1 ring-black/5">
                  {s.last_message}
                </blockquote>
              </div>
            ) : null}
            {!s.first_user_message && !s.status_detail && !s.last_message ? <p className="text-sm text-zinc-500">No transcript details were imported for this session.</p> : null}
          </div>

          {past.length ? (
            <div className="space-y-2">
              <h2 className="font-display text-lg font-bold">Past asks</h2>
              <ul className="space-y-1.5">
                {past.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 rounded-2xl bg-white/70 px-3 py-2 text-sm ring-1 ring-black/5">
                    <span className="mt-0.5 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-600">{KIND_LABEL[t.kind] ?? t.kind}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-zinc-700 line-through decoration-zinc-300">{t.title}</span>
                      <span className="block text-xs text-zinc-500">
                        {t.judge?.engine === "you" ? "You said it wasn't needed" : t.judge && !t.judge.needed ? `Closed by triage: ${t.judge.reason}` : "Handled"}
                        {t.resolved_at ? ` · ${timeAgo(t.resolved_at)}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="space-y-3 rounded-3xl bg-white p-4 ring-1 ring-black/5">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">On it</h2>
            {agent ? (
              <Link href={personHref(agent.id)} className="flex items-center gap-3 rounded-2xl p-1 hover:bg-zinc-50">
                <Character spec={agent.avatar} pose={s.status === "working" ? "working" : open.length ? "needs_you" : "idle"} desk={false} size={56} />
                <span className="min-w-0">
                  <span className="block font-bold">{agent.name}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {agent.role}
                    {team ? ` · ${team.name}` : ""}
                  </span>
                </span>
              </Link>
            ) : (
              <p className="rounded-2xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                Unfiled{project ? ` · in ${project.name}` : ""}.{" "}
                <Link href="/organize" className="underline">
                  Organize →
                </Link>
              </p>
            )}
            {goal && project ? (
              <Link href={`${projectHref(project.slug)}#goal-${goal.id}`} className="block rounded-xl bg-zinc-50 px-3 py-2 text-sm font-semibold hover:bg-zinc-100">
                🎯 {goal.title}
              </Link>
            ) : null}
            <SessionControls sessionId={s.id} options={options} archived={s.archived} hasOwner={!!agent} hasGoal={!!goal} hasProject={!!s.project_id} />
          </div>

          <div className="space-y-2 rounded-3xl bg-white p-4 ring-1 ring-black/5">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Does it need you?</h2>
            {v ? (
              <>
                <p className={`text-sm font-bold ${v.needed ? "text-rose-600" : "text-emerald-700"}`}>
                  {v.needed ? `Yes — ${KIND_LABEL[v.kind] ?? v.kind}` : "No action needed"}
                </p>
                <p className="text-sm text-zinc-600">{v.reason}</p>
                {v.ask && v.ask !== v.reason ? <p className="rounded-xl bg-zinc-50 px-2 py-1 text-xs text-zinc-600">“{v.ask}”</p> : null}
                <p className="text-[11px] font-semibold text-zinc-400">
                  {ENGINE[v.engine] ?? v.engine} · {Math.round(v.confidence * 100)}% sure · {timeAgo(v.at)}
                </p>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Not judged yet.</p>
            )}
          </div>
        </aside>
      </section>

      {artifacts.length ? (
        <section id="artifacts" className="scroll-mt-6 space-y-2">
          <h2 className="font-display text-xl font-bold">🖼️ Artifacts from this session</h2>
          <ArtifactsBoard items={artifacts} options={options} grouped={false} />
        </section>
      ) : null}

      <CommentThread entity="session" entityId={s.id} initial={comments} />
    </div>
  );
}
