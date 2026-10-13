import { CompanyBoard } from "@/components/CompanyBoard";
import { EntityDialog } from "@/components/EntityDialog";
import { getInbox, getOrg } from "@/lib/queries";

export default async function CompaniesPage() {
  const [org, inbox] = await Promise.all([getOrg(), getInbox()]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Companies</h1>
          <p className="text-zinc-600">Every company and its projects. Drag a project to another company or pick one in its row; click any name to open it.</p>
        </div>
        <EntityDialog
          kind="company"
          initial={{ emoji: "🏢" }}
          buttonClassName="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-paper"
          navigate
        />
      </header>

      <CompanyBoard
        companies={org.companies.map(({ id, slug, name, emoji }) => ({ id, slug, name, emoji }))}
        projects={org.projects.map((p) => {
          const teamIds = new Set(org.teams.filter((t) => t.project_id === p.id).map((t) => t.id));
          return {
            id: p.id,
            slug: p.slug,
            name: p.name,
            emoji: p.emoji,
            company_id: p.company_id,
            people: org.agents.filter((a) => teamIds.has(a.team_id)).map(({ id, name, role, avatar }) => ({ id, name, role, avatar })),
            waiting: inbox.filter((i) => i.project?.id === p.id).length,
          };
        })}
      />
    </div>
  );
}
