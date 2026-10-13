import { notFound } from "next/navigation";
import Link from "next/link";
import { CommentThread } from "@/components/comments/CommentThread";
import { GoalsTable } from "@/components/goals/GoalsTable";
import { RoutinesBoard } from "@/components/routines/RoutinesBoard";
import { ArtifactsBoard } from "@/components/artifacts/ArtifactsBoard";
import { getArtifacts } from "@/lib/artifacts";
import { getRoutines, toRoutineItem } from "@/lib/routines";
import { Renameable } from "@/components/ui/Renameable";
import { getComments, getCommentsMap } from "@/lib/comments";
import { ManagerDesk } from "@/components/ManagerDesk";
import { SessionBoard } from "@/components/sessions/SessionBoard";
import { toSessionLite } from "@/lib/session-lite";
import { TeamRoom } from "@/components/TeamRoom";
import { ThemePicker } from "@/components/ThemePicker";
import { DismissAsks } from "@/components/asks/DismissAsks";
import { PeopleWorkBoard } from "@/components/board/PeopleBoard";
import { DeleteDialog } from "@/components/DeleteDialog";
import { Crumbs } from "@/components/Crumbs";
import { EntityDialog } from "@/components/EntityDialog";
import type { GoalRow } from "@/lib/types";
import { getGoals, getInbox, getOffice, getOrg, getProjectBySlug, getRecentWins, getSessions, getTodos, orgOptions, teamTargets } from "@/lib/queries";

const VIEWS = [
  { key: "board", label: "Board", icon: "📋" },
  { key: "team", label: "Team", icon: "🪑" },
  { key: "notes", label: "Notes", icon: "💬" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const { view: rawView } = await searchParams;
  const view: View = VIEWS.some((v) => v.key === rawView) ? (rawView as View) : "board";
  const project = await getProjectBySlug(slug);
  if (!project) notFound();
  const [org, office, sessions, goals, todos, inbox, wins, comments] = await Promise.all([
    getOrg(),
    view === "team" ? getOffice(project.id) : Promise.resolve([]),
    getSessions({ projectId: project.id }),
    getGoals(project.id),
    getTodos({ projectId: project.id, includeDone: true }),
    getInbox(),
    view === "team" ? getRecentWins() : Promise.resolve(new Map<string, GoalRow[]>()),
    getComments("project", project.id),
  ]);
  const goalComments = await getCommentsMap("goal", goals.map((g) => g.goal.id));
  const asks = inbox.filter((i) => i.project?.id === project.id);
  const routines = view === "board" ? getRoutines(org, { projectId: project.id }).map(toRoutineItem) : [];
  const artifacts = view === "board" ? getArtifacts(org, { projectId: project.id }) : [];
  const options = orgOptions(org);
  const sessionOptions = sessions.map(({ id, title, goal_id }) => ({ id, title, goal_id }));
  const projectWins = wins.get(project.id) ?? [];
  const targets = teamTargets(org);
  const teams = org.teams.filter((t) => t.project_id === project.id);
  const teamIds = new Set(teams.map((t) => t.id));
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const agentCount = org.agents.filter((a) => teamIds.has(a.team_id)).length;
  const impact = [
    teams.length ? `${n(teams.length, "team")} and ${n(agentCount, "teammate")} will be removed` : null,
    goals.length ? `${n(goals.length, "goal")} and ${goals.length === 1 ? "its" : "their"} milestones will be deleted` : null,
    todos.length ? `${n(todos.length, "to-do")} will be kept, just without a project` : null,
    sessions.length ? `${n(sessions.length, "session")} need${sessions.length === 1 ? "s" : ""} a new home (below)` : null,
  ].filter((line): line is string => !!line);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-3xl" style={{ background: `${project.color}22` }}>
            {project.emoji}
          </span>
          <div className="min-w-0">
            <Crumbs company={org.companies.find((c) => c.id === project.company_id)} />
            <Renameable kind="project" id={project.id} value={project.name} as="h1" className="font-display text-3xl font-bold" label="Rename project" />
            {project.description ? <p className="text-sm text-zinc-600">{project.description}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DismissAsks
            ids={asks.map((a) => a.task.id)}
            scope={project.name}
            inboxHref={`/inbox?project=${project.id}`}
            label={`🙋 ${asks.length} need${asks.length === 1 ? "s" : ""} you ▾`}
            className="rounded-xl bg-rose-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm hover:bg-rose-600"
            align="right"
          />
          <EntityDialog
            kind="project"
            id={project.id}
            initial={{ name: project.name, emoji: project.emoji, description: project.description, company_id: project.company_id ?? "" }}
            choices={org.companies.map((c) => ({ id: c.id, label: `${c.emoji} ${c.name}` }))}
            navigate
            currentSlug={project.slug}
          />
          <DeleteDialog
            kind="project"
            id={project.id}
            name={project.name}
            impact={impact}
            targets={targets.filter((t) => t.project_id !== project.id)}
            redirectTo="/projects"
          />
        </div>
      </header>

      <nav className="flex gap-1 border-b border-black/10" aria-label="Project views">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "board" ? `/projects/${project.slug}` : `/projects/${project.slug}?view=${v.key}`}
            aria-current={view === v.key ? "page" : undefined}
            className={
              view === v.key
                ? "-mb-px border-b-2 border-ink px-3 py-2 text-sm font-bold text-ink"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-zinc-500 hover:text-ink"
            }
          >
            <span aria-hidden>{v.icon}</span> {v.label}
            {v.key === "team" ? <span className="ml-1 text-xs text-zinc-400">{agentCount}</span> : null}
            {v.key === "notes" && comments.length ? <span className="ml-1 text-xs text-zinc-400">{comments.length}</span> : null}
          </Link>
        ))}
      </nav>

      {view === "board" ? (
        <>
          <GoalsTable
            projectId={project.id}
            goals={goals}
            todos={todos}
            sessionOptions={sessionOptions}
            options={options}
            comments={goalComments}
            asks={Object.fromEntries(asks.map((a) => [a.session.id, a.task.id]))}
          />
          {artifacts.length ? (
            <section className="space-y-2">
              <h2 className="font-display text-lg font-bold">🖼️ Artifacts</h2>
              <ArtifactsBoard items={artifacts} options={options} grouped={false} />
            </section>
          ) : null}
          {routines.length ? (
            <section className="space-y-2">
              <h2 className="font-display text-lg font-bold">⏰ Scheduled</h2>
              <RoutinesBoard items={routines} empty={null} />
            </section>
          ) : null}
          <details className="group rounded-2xl bg-white/60 p-3 ring-1 ring-black/5" open={!goals.length}>
            <summary className="cursor-pointer list-none font-display text-lg font-bold">
              <span className="inline-block w-4 text-sm text-zinc-400 group-open:rotate-90">▸</span> All sessions{" "}
              <span className="text-sm font-semibold text-zinc-400">· {sessions.length}</span>
            </summary>
            <div className="mt-3">
              <SessionBoard sessions={sessions.map(toSessionLite)} options={options} asks={Object.fromEntries(asks.map((a) => [a.session.id, a.task.id]))} scope="project" empty="No sessions in this project yet." />
            </div>
          </details>
        </>
      ) : null}

      {view === "team" ? (
        <>
          <PeopleWorkBoard
            people={org.agents
              .filter((a) => teamIds.has(a.team_id))
              .map((a) => ({
                agent: { id: a.id, name: a.name, role: `${a.role} · ${teams.find((t) => t.id === a.team_id)?.name ?? ""}`, avatar: a.avatar },
                sessions: sessions.filter((x) => x.agent_id === a.id),
                todos: todos.filter((t) => t.task.agent_id === a.id && t.task.status !== "done"),
              }))}
            options={options}
            asks={Object.fromEntries(asks.map((a) => [a.session.id, a.task.id]))}
            goals={Object.fromEntries(goals.map((g) => [g.goal.id, g.goal.title]))}
          />
          <details className="group rounded-2xl bg-white/60 p-3 ring-1 ring-black/5">
            <summary className="cursor-pointer list-none font-display text-lg font-bold">
              <span className="inline-block w-4 text-sm text-zinc-400 group-open:rotate-90">▸</span> 🪑 The office
            </summary>
            <div className="mt-3 space-y-4">
              <ManagerDesk items={asks} title={`Your desk · ${project.name}`} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ThemePicker projectId={project.id} current={project.theme} />
                <EntityDialog kind="team" initial={{ project_id: project.id }} choices={[{ id: project.id, label: `${project.emoji} ${project.name}` }]} navigate />
              </div>
              <div className="grid gap-6 xl:grid-cols-2">
                {office.map((t) => (
                  <TeamRoom key={t.team.id} view={t} showProject={false} queueAtDesk deleteTargets={targets} wins={projectWins.filter((g) => !g.team_id || g.team_id === t.team.id)} />
                ))}
              </div>
            </div>
          </details>
        </>
      ) : null}

      {view === "notes" ? <CommentThread entity="project" entityId={project.id} initial={comments} /> : null}
    </div>
  );
}
