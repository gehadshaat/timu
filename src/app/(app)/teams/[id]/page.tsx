import Link from "next/link";
import { notFound } from "next/navigation";
import { PeopleWorkBoard } from "@/components/board/PeopleBoard";
import { CommentThread } from "@/components/comments/CommentThread";
import { Crumbs } from "@/components/Crumbs";
import { DeleteDialog } from "@/components/DeleteDialog";
import { EntityDialog } from "@/components/EntityDialog";
import { PeopleBoard } from "@/components/people/PeopleBoard";
import { SessionBoard } from "@/components/sessions/SessionBoard";
import { TeamRoom } from "@/components/TeamRoom";
import { QuickAdd } from "@/components/todos/QuickAdd";
import { TodoList } from "@/components/TodoList";
import { Renameable } from "@/components/ui/Renameable";
import { getComments } from "@/lib/comments";
import { getInbox, getOffice, getOrg, getRecentWins, getSessions, getTodos, orgOptions, teamTargets } from "@/lib/queries";
import { toSessionLite } from "@/lib/session-lite";

const VIEWS = [
  { key: "board", label: "Board", icon: "📋" },
  { key: "office", label: "Office", icon: "🪑" },
  { key: "notes", label: "Notes", icon: "💬" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function TeamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  const { view: rawView } = await searchParams;
  const tab: View = VIEWS.some((v) => v.key === rawView) ? (rawView as View) : "board";
  const org = await getOrg();
  const team = org.teams.find((t) => t.id === id);
  if (!team) notFound();
  const project = org.projects.find((p) => p.id === team.project_id)!;
  const company = org.companies.find((c) => c.id === project.company_id) ?? null;
  const [office, sessions, todos, wins, comments, inbox] = await Promise.all([
    getOffice(project.id),
    getSessions({ teamId: team.id }),
    getTodos({ projectId: project.id, includeDone: false }),
    getRecentWins(),
    getComments("team", team.id),
    getInbox(org),
  ]);
  const view = office.find((t) => t.team.id === team.id);
  const memberIds = new Set(org.agents.filter((a) => a.team_id === team.id).map((a) => a.id));
  const teamTodos = todos.filter((t) => t.task.agent_id && memberIds.has(t.task.agent_id));
  const options = orgOptions(org);
  const teamChoices = teamTargets(org).map(({ id, label }) => ({ id, label }));
  const people = (view?.members ?? []).map((m) => ({ agent: m.agent, pose: m.pose, sessions: m.sessions.length }));
  const moveTargets = org.agents.map((a) => ({ id: a.id, label: `${a.name} · ${a.role}` }));
  const members = org.agents.filter((a) => a.team_id === team.id);
  const groups = members.map((a) => ({
    agent: { id: a.id, name: a.name, role: a.role, avatar: a.avatar },
    sessions: sessions.filter((s) => s.agent_id === a.id),
    todos: teamTodos.filter((t) => t.task.agent_id === a.id),
  }));
  const asks = Object.fromEntries(inbox.filter((i) => i.team?.id === team.id).map((i) => [i.session.id, i.task.id]));
  const goalTitles = Object.fromEntries(org.goals.filter((g) => g.project_id === project.id).map((g) => [g.id, g.title]));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Crumbs company={company} project={project} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Team</p>
            <Renameable kind="team" id={team.id} value={team.name} as="h1" className="font-display text-3xl font-bold" label="Rename team" />
            {team.description ? <p className="text-zinc-600">{team.description}</p> : null}
          </div>
          <div className="flex gap-2">
            <EntityDialog kind="agent" initial={{ team_id: team.id, prop: "laptop" }} choices={teamChoices} buttonLabel="+ Hire teammate" buttonClassName="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-paper" />
            <EntityDialog kind="team" id={team.id} initial={{ name: team.name, description: team.description, project_id: team.project_id }} />
            <DeleteDialog
              kind="team"
              id={team.id}
              name={team.name}
              targets={teamTargets(org).filter((t) => t.id !== team.id)}
              impact={[`${memberIds.size} teammate${memberIds.size === 1 ? "" : "s"} leave the office`]}
              redirectTo={`/projects/${project.slug}`}
              buttonLabel="Delete team"
            />
          </div>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-black/10" aria-label="Team views">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "board" ? `/teams/${team.id}` : `/teams/${team.id}?view=${v.key}`}
            aria-current={tab === v.key ? "page" : undefined}
            className={
              tab === v.key
                ? "-mb-px border-b-2 border-ink px-3 py-2 text-sm font-bold text-ink"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-zinc-500 hover:text-ink"
            }
          >
            <span aria-hidden>{v.icon}</span> {v.label}
            {v.key === "notes" && comments.length ? <span className="ml-1 text-xs text-zinc-400">{comments.length}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "board" ? (
        <>
          <QuickAdd options={options} projectId={project.id} compact placeholder="Add a to-do for the team… (@who due:fri)" />
          <PeopleWorkBoard people={groups} options={options} asks={asks} goals={goalTitles} />
          {sessions.some((s) => !s.agent_id) ? (
            <details className="group rounded-2xl bg-white/60 p-3 ring-1 ring-black/5">
              <summary className="cursor-pointer list-none font-display text-lg font-bold">
                <span className="inline-block w-4 text-sm text-zinc-400 group-open:rotate-90">▸</span> All sessions{" "}
                <span className="text-sm font-semibold text-zinc-400">· {sessions.length}</span>
              </summary>
              <div className="mt-3">
                <SessionBoard sessions={sessions.map(toSessionLite)} options={options} scope="team" asks={asks} empty="No sessions on this team yet." />
              </div>
            </details>
          ) : null}
        </>
      ) : null}

      {tab === "office" ? (
        <>
          {view ? <TeamRoom view={view} showProject={false} wins={(wins.get(project.id) ?? []).filter((g) => !g.team_id || g.team_id === team.id)} /> : null}
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">People</h2>
            <PeopleBoard teamId={team.id} people={people} options={options} teamChoices={teamChoices} moveTargets={moveTargets} />
          </section>
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">Team to-dos · list</h2>
            <TodoList items={teamTodos} options={options} showProject={false} empty="Nothing assigned to this team." />
          </section>
        </>
      ) : null}

      {tab === "notes" ?       <CommentThread entity="team" entityId={team.id} initial={comments} /> : null}
    </div>
  );
}
