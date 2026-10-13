import Link from "next/link";
import { companyHref, projectHref, teamHref } from "@/lib/links";
import type { CompanyRow, ProjectRow, TeamRow } from "@/lib/types";

/** Company › Project › Team trail; each part links to its page. */
export function Crumbs({ company, project, team }: { company?: CompanyRow | null; project?: ProjectRow | null; team?: TeamRow | null }) {
  const parts: { href: string; label: string }[] = [];
  if (company) parts.push({ href: companyHref(company.slug), label: `${company.emoji} ${company.name}` });
  if (project) parts.push({ href: projectHref(project.slug), label: `${project.emoji} ${project.name}` });
  if (team) parts.push({ href: teamHref(team.id), label: team.name });
  if (!parts.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm font-semibold text-zinc-500">
      {parts.map((p, i) => (
        <span key={p.href} className="flex items-center gap-1">
          {i ? <span aria-hidden>›</span> : null}
          <Link href={p.href} className="hover:text-ink hover:underline">
            {p.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}

/** A small "works on" chip: the project (and company) a teammate belongs to. */
export function WorksOn({
  project,
  company,
  className = "",
  link = true,
}: {
  project?: ProjectRow | null;
  company?: CompanyRow | null;
  className?: string;
  /** Set false when already inside another link. */
  link?: boolean;
}) {
  if (!project) return null;
  const cls = `inline-flex max-w-full items-center gap-1 truncate rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 ${link ? "hover:bg-zinc-200" : ""} ${className}`;
  const title = company ? `${company.name} › ${project.name}` : project.name;
  const body = (
    <>
      {project.emoji} <span className="truncate">{project.name}</span>
    </>
  );
  return link ? (
    <Link href={projectHref(project.slug)} className={cls} title={title}>
      {body}
    </Link>
  ) : (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}
