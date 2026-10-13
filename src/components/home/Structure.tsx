import Link from "next/link";
import clsx from "clsx";
import { DismissAsks } from "../asks/DismissAsks";
import { Character } from "../Character";
import { HealthChip, HealthDot, ProgressBar, SignalRow, Sparkline } from "../Signals";
import { companyHref, personHref, projectHref, teamHref } from "@/lib/links";
import { timeAgo } from "@/lib/format";
import type { CompanyCard, DepartmentCard, ProjectCard } from "@/lib/home";
import type { AgentRow } from "@/lib/types";
import { HEALTH_LABEL, type Health } from "@/lib/signals";

/** A row of tiny teammates, overlapping, with "+N". */
export function PeopleStack({ people, max = 5, size = 30 }: { people: AgentRow[]; max?: number; size?: number }) {
  if (!people.length) return null;
  const more = people.length - max;
  return (
    <span className="flex items-center -space-x-2">
      {people.slice(0, max).map((a) => (
        <Link key={a.id} href={personHref(a.id)} title={`${a.name}, ${a.role}`} className="rounded-full bg-white ring-2 ring-white transition hover:z-10 hover:-translate-y-0.5">
          <Character spec={a.avatar} pose="idle" desk={false} size={size} />
        </Link>
      ))}
      {more > 0 ? (
        <span className="grid place-items-center rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-600 ring-2 ring-white" style={{ width: size, height: size }}>
          +{more}
        </span>
      ) : null}
    </span>
  );
}

/** Board-style status colours for a project's health. */
const HEALTH_CELL: Record<Health, string> = {
  stuck: "#bb3354",
  needs_you: "#e2445c",
  active: "#00c875",
  quiet: "#579bfc",
  dormant: "#c4c4c4",
  empty: "#c4c4c4",
};

/** The same colours as classes, for cells that are buttons (they can't take an inline style). */
const HEALTH_BG: Record<Health, string> = {
  stuck: "bg-[#bb3354]",
  needs_you: "bg-[#e2445c]",
  active: "bg-[#00c875]",
  quiet: "bg-[#579bfc]",
  dormant: "bg-[#c4c4c4]",
  empty: "bg-[#c4c4c4]",
};

/** Project · Status · Needs you · Goals · Last active (from md) · People (from 2xl). */
const PROJECT_COLS =
  "grid grid-cols-[minmax(0,1fr)_6.5rem_3.5rem] md:grid-cols-[minmax(10rem,1fr)_6.5rem_4.5rem_6.5rem_5rem] 2xl:grid-cols-[minmax(10rem,1fr)_6.5rem_4.5rem_6.5rem_5rem_7rem]";

function ProjectRowView({ card, now, askIds }: { card: ProjectCard; now: number; askIds: string[] }) {
  const { project, signals: s, people } = card;
  return (
    <div className={clsx(PROJECT_COLS, "group relative border-t border-zinc-100 bg-white text-sm hover:bg-zinc-50")}>
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-50 text-lg ring-1 ring-black/5" aria-hidden>
          {project.emoji}
        </span>
        <div className="min-w-0">
          <Link href={projectHref(project.slug)} className="block truncate font-bold after:absolute after:inset-0 hover:underline">
            {project.name}
          </Link>
          {project.description ? <p className="truncate text-xs text-zinc-500">{project.description}</p> : null}
        </div>
      </div>
      <div className="relative z-10 flex items-stretch border-l border-white [&>div]:flex [&>div]:w-full">
        {askIds.length ? (
          // Click "Needs you" to clear it: done, not needed, or snooze.
          <DismissAsks
            ids={askIds}
            scope={project.name}
            inboxHref={`/inbox?project=${project.id}`}
            label={HEALTH_LABEL[s.health]}
            className={`flex h-full w-full items-center justify-center px-1 text-center text-xs font-bold text-white transition hover:brightness-110 ${HEALTH_BG[s.health]}`}
            title="Clear what's waiting on you"
          />
        ) : (
          <span className="flex w-full items-center justify-center px-1 text-center text-xs font-bold text-white" style={{ background: HEALTH_CELL[s.health] }}>
            {HEALTH_LABEL[s.health]}
          </span>
        )}
      </div>
      <div className="relative z-10 flex items-center justify-center border-l border-zinc-100">
        {askIds.length ? (
          <DismissAsks
            ids={askIds}
            scope={project.name}
            inboxHref={`/inbox?project=${project.id}`}
            label={askIds.length}
            className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-black text-white hover:bg-rose-600"
          />
        ) : (
          <span className="text-xs text-zinc-300">—</span>
        )}
      </div>
      <div className="hidden items-center gap-2 border-l border-zinc-100 px-3 md:flex" title={s.goals ? `${s.goals} active goal${s.goals === 1 ? "" : "s"}` : "No active goals"}>
        {s.goalProgress !== null ? (
          <>
            <ProgressBar value={s.goalProgress} />
            <span className="shrink-0 text-[11px] font-bold text-zinc-500">{Math.round(s.goalProgress * 100)}%</span>
          </>
        ) : (
          <span className="w-full text-center text-xs text-zinc-300">—</span>
        )}
      </div>
      <div className="hidden items-center justify-center border-l border-zinc-100 text-xs text-zinc-500 md:flex">{s.lastActive ? timeAgo(s.lastActive, now) : "—"}</div>
      <div className="relative z-10 hidden items-center justify-center border-l border-zinc-100 2xl:flex">
        <PeopleStack people={people} max={4} size={24} />
      </div>
    </div>
  );
}

/** A company's projects as one board: a row per project, the same columns for all. */
export function ProjectsTable({ projects, now, asks }: { projects: ProjectCard[]; now: number; asks: Record<string, string[]> }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200">
      <div className={clsx(PROJECT_COLS, "bg-zinc-50 text-[11px] font-semibold text-zinc-500")}>
        <div className="px-3 py-1.5">Project</div>
        <div className="py-1.5 text-center">Status</div>
        <div className="py-1.5 text-center">Needs you</div>
        <div className="hidden py-1.5 text-center md:block">Goals</div>
        <div className="hidden py-1.5 text-center md:block">Last active</div>
        <div className="hidden py-1.5 text-center 2xl:block">People</div>
      </div>
      {projects.map((p) => (
        <ProjectRowView key={p.project.id} card={p} now={now} askIds={asks[p.project.id] ?? []} />
      ))}
    </div>
  );
}

export function DepartmentTile({ dept }: { dept: DepartmentCard }) {
  const s = dept.signals;
  const projects = new Set(dept.teams.map((t) => t.project.id)).size;
  return (
    <article className="flex flex-col gap-2 rounded-2xl bg-white/80 p-3 ring-1 ring-black/5">
      <div className="flex items-center gap-2">
        <HealthDot health={s.health} />
        <h4 className="min-w-0 flex-1 truncate font-display font-bold">{dept.name}</h4>
        {s.asks ? <span className="rounded-full bg-rose-100 px-2 text-[11px] font-black text-rose-700">🙋 {s.asks}</span> : null}
      </div>
      <p className="text-[11px] font-semibold text-zinc-500">
        {dept.teams.length} team{dept.teams.length === 1 ? "" : "s"} across {projects} project{projects === 1 ? "" : "s"} · {dept.people.length} people
      </p>
      <div className="flex items-center justify-between gap-2">
        <PeopleStack people={dept.people} max={4} size={26} />
        <Sparkline data={s.spark} className="h-[18px] w-[64px]" />
      </div>
      <div className="flex flex-wrap gap-1">
        {dept.teams.map((t) => (
          <Link key={t.id} href={teamHref(t.id)} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-200">
            {t.project.emoji} {t.project.name}
          </Link>
        ))}
      </div>
    </article>
  );
}

/** `asks` maps a project id to the ids of the asks waiting on you there. */
export function CompanySection({ card, now, asks }: { card: CompanyCard; now: number; asks: Record<string, string[]> }) {
  const { company, projects, departments, signals: s } = card;
  const dormant = projects.filter((p) => p.signals.health === "dormant" || p.signals.health === "empty");
  const lively = projects.filter((p) => !dormant.includes(p));
  const companyAsks = projects.flatMap((p) => asks[p.project.id] ?? []);
  return (
    <section className="space-y-3 rounded-[28px] bg-gradient-to-b from-white/90 to-white/40 p-4 ring-1 ring-black/5 sm:p-5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink text-2xl shadow-sm" aria-hidden>
          {company?.emoji ?? "📦"}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 font-display text-2xl font-bold leading-tight">
            {company ? (
              <Link href={companyHref(company.slug)} className="hover:underline">
                {company.name}
              </Link>
            ) : (
              <span>Not in a company</span>
            )}
            <HealthChip health={s.health} />
            {companyAsks.length ? (
              <DismissAsks
                ids={companyAsks}
                scope={company?.name ?? "Projects without a company"}
                inboxHref={company ? `/inbox?company=${company.id}` : "/inbox"}
                label={`Clear ${companyAsks.length}`}
                className="rounded-full px-2 py-0.5 font-sans text-[11px] font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50"
                title={`Clear everything waiting on you in ${company?.name ?? "these projects"}`}
              />
            ) : null}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs font-semibold text-zinc-500">
            <span>
              {projects.length} project{projects.length === 1 ? "" : "s"}
            </span>
            {departments ? <span>· {departments.length} departments</span> : null}
            <SignalRow s={s} compact />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {s.goalProgress !== null ? (
            <span className="hidden w-28 space-y-1 sm:block" title="Average progress of active goals">
              <span className="block text-right text-[11px] font-bold text-zinc-500">🎯 {Math.round(s.goalProgress * 100)}%</span>
              <ProgressBar value={s.goalProgress} />
            </span>
          ) : null}
          <Sparkline data={s.spark} />
        </div>
      </header>

      {!company ? (
        <p className="text-xs text-zinc-500">
          Tip: drag these onto a company on the{" "}
          <Link href="/companies" className="font-semibold text-orange-700 hover:underline">
            Companies
          </Link>{" "}
          page.
        </p>
      ) : null}

      {departments && departments.length > 1 ? (
        <details className="group rounded-2xl bg-black/[0.03] px-3 py-2">
          <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-500">
            <span className="mr-1 inline-block transition group-open:rotate-90">▸</span>
            {departments.length} departments across these projects
          </summary>
          <div className="mt-2 grid gap-2 pb-1 sm:grid-cols-2 2xl:grid-cols-3">
            {departments.map((d) => (
              <DepartmentTile key={d.key} dept={d} />
            ))}
          </div>
        </details>
      ) : null}

      {lively.length ? (
        <div className="space-y-2">
          <ProjectsTable projects={lively} now={now} asks={asks} />
        </div>
      ) : null}

      {dormant.length ? (
        <details className="group rounded-2xl bg-black/[0.03] px-3 py-2" open={!lively.length}>
          <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-500">
            <span className="mr-1 inline-block transition group-open:rotate-90">▸</span>
            {dormant.length} quiet project{dormant.length === 1 ? "" : "s"} (nothing in the last 2 weeks)
          </summary>
          <div className="mt-2 pb-1">
            <ProjectsTable projects={dormant} now={now} asks={asks} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
