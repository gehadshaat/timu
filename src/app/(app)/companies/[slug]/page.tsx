import { ArtifactsBoard } from "@/components/artifacts/ArtifactsBoard";
import { getArtifacts } from "@/lib/artifacts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Character } from "@/components/Character";
import { WorksOn } from "@/components/Crumbs";
import { DeleteDialog } from "@/components/DeleteDialog";
import { EntityDialog } from "@/components/EntityDialog";
import { ManagerDesk } from "@/components/ManagerDesk";
import { DismissAsks } from "@/components/asks/DismissAsks";
import { GoalsOverview } from "@/components/goals/GoalsOverview";
import { CommentThread } from "@/components/comments/CommentThread";
import { Renameable } from "@/components/ui/Renameable";
import { getComments } from "@/lib/comments";
import { personHref, projectHref, resumeFor, teamHref } from "@/lib/links";
import { getCompanyBySlug, getGoals, getInbox, getOffice, getOrg, orgOptions } from "@/lib/queries";

const VIEWS = [
  { key: "board", label: "Board", icon: "📋" },
  { key: "artifacts", label: "Artifacts", icon: "🖼️" },
  { key: "people", label: "People", icon: "🧑‍🤝‍🧑" },
  { key: "notes", label: "Notes", icon: "💬" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const { view: rawView } = await searchParams;
  const view: View = VIEWS.some((v) => v.key === rawView) ? (rawView as View) : "board";
  const company = await getCompanyBySlug(slug);
  if (!company) notFound();
  const org = await getOrg();
  const projects = org.projects.filter((p) => p.company_id === company.id);
  const projectIds = new Set(projects.map((p) => p.id));
  const [inbox, office, comments, goalViews] = await Promise.all([
    getInbox(org),
    view === "people" ? getOffice() : Promise.resolve([]),
    getComments("company", company.id),
    view === "board" ? Promise.all(projects.map((p) => getGoals(p.id))) : Promise.resolve([]),
  ]);
  const members = office.filter((t) => projectIds.has(t.project.id)).flatMap((t) => t.members.map((m) => ({ ...m, team: t.team, project: t.project })));
  const asks = inbox.filter((i) => i.project && projectIds.has(i.project.id));
  const groups = projects.map((p, i) => ({
    project: { id: p.id, name: p.name, emoji: p.emoji, slug: p.slug },
    goals: (goalViews[i] ?? []).map((g) => ({
      goal: g.goal,
      team: g.team?.name ?? null,
      progress: g.progress,
      items: g.milestones.length + g.sessions.length + g.todos.length,
      sessions: g.sessions.map((x) => ({ id: x.id, title: x.title, status: x.status_override ?? x.status, url: x.url, resume: resumeFor(x) })),
      artifacts: g.sessions.reduce((n, x) => n + (x.artifact_count ?? 0), 0),
    })),
  }));
  const artifacts = getArtifacts(org, { companyId: company.id });
  const tabHref = (key: View) => (key === "board" ? `/companies/${company.slug}` : `/companies/${company.slug}?view=${key}`);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid h-16 w-16 place-items-center rounded-3xl bg-sky-50 text-4xl">{company.emoji}</span>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-sky-700/70">Company</p>
            <Renameable kind="company" id={company.id} value={company.name} as="h1" className="font-display text-3xl font-bold" label="Rename company" />
            {company.description ? <p className="text-zinc-600">{company.description}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DismissAsks
            ids={asks.map((a) => a.task.id)}
            scope={company.name}
            inboxHref={`/inbox?company=${company.id}`}
            label={`🙋 ${asks.length} need${asks.length === 1 ? "s" : ""} you ▾`}
            className="rounded-xl bg-rose-500 px-3 py-1.5 text-sm font-bold text-white shadow-sm hover:bg-rose-600"
            align="right"
          />
          <EntityDialog kind="company" id={company.id} initial={{ name: company.name, emoji: company.emoji, description: company.description }} />
          <DeleteDialog
            kind="company"
            id={company.id}
            name={company.name}
            targets={[]}
            impact={[`Its ${projects.length} project${projects.length === 1 ? "" : "s"} are kept, just without a company`]}
            redirectTo="/companies"
          />
        </div>
      </header>

      <nav className="flex gap-1 border-b border-black/10" aria-label="Company views">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={tabHref(v.key)}
            aria-current={view === v.key ? "page" : undefined}
            className={
              view === v.key
                ? "-mb-px border-b-2 border-ink px-3 py-2 text-sm font-bold text-ink"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-zinc-500 hover:text-ink"
            }
          >
            <span aria-hidden>{v.icon}</span> {v.label}
            {v.key === "notes" && comments.length ? <span className="ml-1 text-xs text-zinc-400">{comments.length}</span> : null}
            {v.key === "artifacts" && artifacts.length ? <span className="ml-1 text-xs text-zinc-400">{artifacts.length}</span> : null}
          </Link>
        ))}
      </nav>

      {view === "board" ? (
        <>
          <GoalsOverview groups={groups} />
          <div className="flex justify-end">
            <EntityDialog kind="project" initial={{ company_id: company.id, emoji: "📁" }} choices={org.companies.map((c) => ({ id: c.id, label: `${c.emoji} ${c.name}` }))} navigate />
          </div>
        </>
      ) : null}

      {view === "artifacts" ? <ArtifactsBoard items={artifacts} options={orgOptions(org)} grouped empty={<>No artifacts here yet. Import your gallery on the Artifacts page (or ask Claude to), or file one here from its project cell.</>} /> : null}

      {view === "people" ? (
        <>
          <ManagerDesk items={asks} title={`Your desk · ${company.name}`} />
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">Teams</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((p) => {
                const teams = org.teams.filter((t) => t.project_id === p.id);
                return (
                  <div key={p.id} className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-black/5">
                    <Link href={projectHref(p.slug)} className="font-display text-lg font-bold hover:underline">
                      {p.emoji} {p.name}
                    </Link>
                    <div className="flex flex-wrap gap-1.5">
                      {teams.map((t) => (
                        <Link key={t.id} href={teamHref(t.id)} className="rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-black/10 hover:bg-zinc-50" style={{ background: t.color }}>
                          {t.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">People</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {members.map((m) => (
                <Link key={m.agent.id} href={personHref(m.agent.id)} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-black/5 hover:shadow-md">
                  <Character spec={m.agent.avatar} pose={m.pose} desk={false} size={56} />
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{m.agent.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {m.agent.role} · {m.team.name}
                    </span>
                    <WorksOn project={m.project} company={company} className="mt-0.5" link={false} />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {view === "notes" ?       <CommentThread entity="company" entityId={company.id} initial={comments} /> : null}
    </div>
  );
}
