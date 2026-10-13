import { EntityDialog } from "@/components/EntityDialog";
import { GoalsOverview } from "@/components/goals/GoalsOverview";
import { resumeFor } from "@/lib/links";
import { getGoals, getOrg } from "@/lib/queries";

/** Every project's goals as one board: a group per project, a row per goal. */
export default async function ProjectsPage() {
  const org = await getOrg();
  const companyName = (id: string | null) => org.companies.find((c) => c.id === id)?.name ?? "";
  // Grouped by company; projects without one come last.
  const projects = [...org.projects].sort(
    (a, b) => Number(!a.company_id) - Number(!b.company_id) || companyName(a.company_id).localeCompare(companyName(b.company_id)) || a.name.localeCompare(b.name),
  );
  const views = await Promise.all(projects.map((p) => getGoals(p.id)));
  const groups = projects.map((p, i) => ({
    project: { id: p.id, name: p.name, emoji: p.emoji, slug: p.slug },
    goals: views[i].map((g) => ({
      goal: g.goal,
      team: g.team?.name ?? null,
      progress: g.progress,
      items: g.milestones.length + g.sessions.length + g.todos.length,
      sessions: g.sessions.map((x) => ({ id: x.id, title: x.title, status: x.status_override ?? x.status, url: x.url, resume: resumeFor(x) })),
      artifacts: g.sessions.reduce((n, x) => n + (x.artifact_count ?? 0), 0),
    })),
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Projects & goals</h1>
          <p className="text-zinc-600">Every project&apos;s goals in one board. Tick one to mark it achieved; open its sessions from the ⚡ column.</p>
        </div>
        <EntityDialog
          kind="project"
          initial={{ emoji: "📁" }}
          choices={org.companies.map((c) => ({ id: c.id, label: `${c.emoji} ${c.name}` }))}
          buttonClassName="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-paper"
          navigate
        />
      </header>
      <GoalsOverview groups={groups} />
    </div>
  );
}
