import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs } from "@/components/Crumbs";
import { DismissAsks } from "@/components/asks/DismissAsks";
import { GoalDoneButton, GoalStatusCell } from "@/components/goals/GoalsOverview";
import { GoalsTable } from "@/components/goals/GoalsTable";
import { getCommentsMap } from "@/lib/comments";
import { dueLabel } from "@/lib/format";
import { projectHref } from "@/lib/links";
import { getGoals, getInbox, getOrg, getSessions, getTodos, orgOptions } from "@/lib/queries";

/** One goal as its own board: its milestones, to-dos and sessions, with a big "done" button. */
export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getOrg();
  const row = org.goals.find((g) => g.id === id);
  if (!row) notFound();
  const project = org.projects.find((p) => p.id === row.project_id)!;
  const company = org.companies.find((c) => c.id === project.company_id) ?? null;
  const [views, todos, sessions, inbox, comments] = await Promise.all([
    getGoals(project.id),
    getTodos({ projectId: project.id, includeDone: true }),
    getSessions({ projectId: project.id }),
    getInbox(org),
    getCommentsMap("goal", [id]),
  ]);
  const view = views.find((v) => v.goal.id === id)!;
  const sessionIds = new Set(view.sessions.map((s) => s.id));
  const asks = inbox.filter((i) => sessionIds.has(i.session.id));
  const pct = Math.round(view.progress * 100);
  const due = row.status === "active" ? dueLabel(row.due_date) : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Crumbs company={company} project={project} />
          <h1 className="font-display text-3xl font-bold">🎯 {row.title}</h1>
          {row.description ? <p className="text-sm text-zinc-600">{row.description}</p> : null}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-semibold text-zinc-500">
            <span className="flex h-6 w-24 overflow-hidden rounded-md [&>div]:h-full [&>div]:w-full">
              <GoalStatusCell goal={row} className="rounded-md" />
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-28 overflow-hidden rounded-full bg-zinc-100">
                <span className="block h-full rounded-full bg-[#00c875]" style={{ width: `${pct}%` }} />
              </span>
              {pct}% done
            </span>
            {view.team ? <span>· {view.team.name}</span> : <span>· Whole project</span>}
            {due ? <span className={`rounded-full px-2 py-0.5 font-bold ${due.tone}`}>due {due.text}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DismissAsks
            ids={asks.map((a) => a.task.id)}
            scope={row.title}
            label={`🙋 ${asks.length} need${asks.length === 1 ? "s" : ""} you ▾`}
            className="rounded-xl bg-rose-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm hover:bg-rose-600"
            align="right"
          />
          <GoalDoneButton goal={row} />
        </div>
      </header>

      <GoalsTable
        projectId={project.id}
        goals={[view]}
        todos={todos}
        sessionOptions={sessions.map(({ id: sid, title, goal_id }) => ({ id: sid, title, goal_id }))}
        options={orgOptions(org)}
        comments={comments}
        asks={Object.fromEntries(asks.map((a) => [a.session.id, a.task.id]))}
        single
      />

      <p className="text-sm">
        <Link href={projectHref(project.slug)} className="font-semibold text-orange-700 hover:underline">
          ← All goals in {project.name}
        </Link>
      </p>
    </div>
  );
}
