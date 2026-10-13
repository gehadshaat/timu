import Link from "next/link";
import { Character } from "./Character";
import { DeleteDialog, type MoveTarget } from "./DeleteDialog";
import { WorksOn } from "./Crumbs";
import { personHref, teamHref } from "@/lib/links";
import { POSE_LABEL, type Pose } from "@/lib/avatar";
import type { MemberView, TeamView } from "@/lib/queries";
import { hash } from "@/lib/text";
import { themeById, wallStyle } from "@/lib/themes";
import type { GoalRow } from "@/lib/types";

const DOT: Record<Pose, string> = {
  working: "bg-sky-500",
  thinking: "bg-sky-500",
  reading: "bg-sky-500",
  call: "bg-sky-500",
  walking: "bg-zinc-400",
  needs_you: "bg-rose-500 animate-pulse",
  review: "bg-amber-500",
  idle: "bg-zinc-400",
  done: "bg-emerald-500",
  failed: "bg-orange-500 animate-pulse",
};

const BUBBLE: Record<Pose, string> = {
  working: "bg-white border-sky-200",
  thinking: "bg-white border-sky-200",
  reading: "bg-white border-sky-200",
  call: "bg-white border-sky-200",
  walking: "bg-white border-zinc-200",
  needs_you: "bg-rose-50 border-rose-300",
  review: "bg-amber-50 border-amber-300",
  idle: "bg-white border-zinc-200",
  done: "bg-emerald-50 border-emerald-300",
  failed: "bg-orange-50 border-orange-300",
};

export const WAITING: Pose[] = ["needs_you", "review", "failed"];

/**
 * One idle teammate per room takes a coffee break; who it is rotates every hour so
 * the office changes between visits without needing client-side state.
 */
function coffeeBreaker(members: MemberView[], teamId: string): string | null {
  const idle = members.filter((m) => m.pose === "idle");
  if (!idle.length) return null;
  const slot = Math.floor(Date.now() / 3_600_000);
  if (hash(`${teamId}:${slot}`) % 3 === 0) return null;
  return idle[hash(`${teamId}:${slot}:who`) % idle.length].agent.id;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function teamImpact(view: TeamView): string[] {
  const sessions = view.members.reduce((n, m) => n + m.sessions.length, 0);
  const todos = view.members.reduce((n, m) => n + m.todos.length, 0);
  const lines = [`${plural(view.members.length, "teammate")} leave${view.members.length === 1 ? "s" : ""} the office`];
  if (todos) lines.push(`${plural(todos, "to-do")} assigned to them come back to you`);
  if (sessions) lines.push(`${plural(sessions, "session")} need${sessions === 1 ? "s" : ""} a new home (below)`);
  lines.push("Goals for this team are kept and become project-wide");
  return lines;
}

/** A team drawn as a little office room with each member at their desk. */
export function TeamRoom({
  view,
  showProject = true,
  wins = [],
  queueAtDesk = false,
  deleteTargets,
}: {
  view: TeamView;
  showProject?: boolean;
  /** Goals achieved recently — the room celebrates. */
  wins?: GoalRow[];
  /** When the manager's desk is on the same page, waiting teammates are shown there instead. */
  queueAtDesk?: boolean;
  /** When given, the room offers "Delete team"; these are the teams its sessions can move to. */
  deleteTargets?: MoveTarget[];
}) {
  const { team, project, members } = view;
  const theme = themeById(project.theme);
  const needs = members.filter((m) => WAITING.includes(m.pose)).length;
  const breaker = coffeeBreaker(members, team.id);
  const strolling = members.find((m) => m.agent.id === breaker);

  return (
    <section className="overflow-hidden rounded-[28px] shadow-sm ring-1 ring-black/10">
      <header className="flex items-center justify-between gap-3 px-5 py-3" style={{ background: team.color }}>
        <div className="min-w-0">
          <h3 className="font-display text-xl font-bold">
            <Link href={teamHref(team.id)} className="hover:underline">
              {team.name}
            </Link>
          </h3>
          {showProject ? (
            <Link href={`/projects/${project.slug}`} className="text-sm font-semibold text-black/60 hover:underline">
              {project.emoji} {project.name}
            </Link>
          ) : (
            <p className="line-clamp-1 text-sm text-black/60">{team.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {needs > 0 ? (
            <span className="rounded-full bg-rose-500 px-3 py-1 text-xs font-bold text-white">{needs} waiting on you</span>
          ) : (
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold text-black/60">all clear</span>
          )}
          {deleteTargets ? (
            <DeleteDialog
              kind="team"
              id={team.id}
              name={team.name}
              targets={deleteTargets.filter((t) => t.id !== team.id)}
              impact={teamImpact(view)}
              buttonLabel="🗑"
              buttonClassName="grid h-7 w-7 place-items-center rounded-full bg-white/70 text-sm hover:bg-rose-100"
            />
          ) : null}
        </div>
      </header>

      <div className="relative px-3 pb-16 pt-2" style={wallStyle(theme)}>
        {/* decor */}
        <div className="pointer-events-none absolute right-6 top-3 hidden h-14 w-20 rounded-md border-4 border-white/80 bg-sky-200/70 sm:block">
          <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 bg-white/80" />
          <div className="absolute left-0 top-1/2 h-1 w-full -translate-y-1/2 bg-white/80" />
        </div>
        <div className="pointer-events-none absolute left-4 top-3 flex gap-2 text-2xl opacity-90" aria-hidden>
          {theme.decor.slice(1).map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        {wins.length ? (
          <>
            <div className="confetti-rain pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              {Array.from({ length: 18 }, (_, i) => (
                <span
                  key={i}
                  style={{
                    left: `${(i * 37) % 100}%`,
                    background: ["#f472b6", "#60a5fa", "#facc15", "#34d399", "#a78bfa"][i % 5],
                    animationDelay: `${(i % 6) * 0.45}s`,
                  }}
                />
              ))}
            </div>
            <div className="relative mx-auto mt-1 w-fit rounded-full bg-white/90 px-3 py-1 text-xs font-bold text-emerald-700 shadow-sm">
              🎉 Goal achieved: {wins[0].title}
            </div>
          </>
        ) : null}

        <div className="relative grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-x-2 gap-y-4 pt-10">
          {members.map((m) => {
            const away = (queueAtDesk && WAITING.includes(m.pose)) || m.agent.id === breaker;
            const note = m.agent.id === breaker ? "☕ On a coffee break" : "🚶 At your desk";
            return (
              <div key={m.agent.id} className="flex flex-col items-center">
                <div
                  className={`bubble mb-2 w-full max-w-[200px] rounded-2xl border-2 px-3 py-2 text-center text-xs font-semibold leading-snug shadow-sm ${
                    away ? "border-dashed border-zinc-300 bg-white/70 text-zinc-500" : `text-zinc-700 ${BUBBLE[m.pose]}`
                  }`}
                >
                  <span className="line-clamp-3">{away ? note : m.line}</span>
                </div>
                <Character
                  spec={m.agent.avatar}
                  pose={m.pose}
                  size={170}
                  absent={away}
                  title={`${m.agent.name}, ${m.agent.role}: ${away ? note : POSE_LABEL[m.pose]}`}
                />
                <div className="-mt-1 w-full max-w-[200px] rounded-xl bg-white/90 px-3 py-1.5 text-center shadow-sm ring-1 ring-black/5">
                  <div className="flex items-center justify-center gap-1.5 text-sm font-bold">
                    <span className={`h-2 w-2 rounded-full ${DOT[m.pose]}`} />
                    <Link href={personHref(m.agent.id)} className="hover:underline">
                      {m.agent.name}
                    </Link>
                  </div>
                  <div className="truncate text-[11px] font-semibold text-zinc-500">{m.agent.role}</div>
                  <WorksOn project={project} className="my-0.5" />
                  <div className="text-[10px] text-zinc-400">
                    {m.sessions.length} session{m.sessions.length === 1 ? "" : "s"}
                    {m.todos.length ? ` · ${m.todos.length} to-do${m.todos.length === 1 ? "" : "s"}` : ""} · {POSE_LABEL[m.pose]}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* the floor, with the coffee machine and whoever is on a break */}
        <div className="absolute inset-x-0 bottom-0 h-14" style={{ background: theme.floor }}>
          <div className="absolute bottom-2 right-3 text-3xl" aria-hidden title="Coffee machine">
            ☕
          </div>
          <div className="absolute bottom-1 left-3 text-3xl" aria-hidden>
            {theme.decor[0]}
          </div>
        </div>
        {strolling ? (
          <div
            className="stroller pointer-events-none absolute -bottom-1 left-12"
            style={{ ["--walk" as string]: "calc(100% - 140px)", ["--dur" as string]: "18s", width: "calc(100% - 60px)" }}
          >
            <Character spec={strolling.agent.avatar} pose="walking" stance="standing" carry="mug" size={66} title={`${strolling.agent.name} on a coffee run`} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
