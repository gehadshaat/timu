import "server-only";
import { all } from "./db";
import { companyHref, personHref, projectHref, teamHref } from "./links";
import { getOrg } from "./queries";
import type { Searchable } from "./search";

export const PAGES: Searchable[] = [
  { kind: "page", id: "home", label: "Home", href: "/", emoji: "🏠", keywords: "overview structure companies" },
  { kind: "page", id: "inbox", label: "Inbox — needs you", href: "/inbox", emoji: "🙋", keywords: "asks waiting" },
  { kind: "page", id: "todos", label: "To-dos", href: "/todos", emoji: "✅" },
  { kind: "page", id: "digest", label: "Daily digest", href: "/digest", emoji: "📰" },
  { kind: "page", id: "office", label: "Office", href: "/office", emoji: "🪑" },
  { kind: "page", id: "organize", label: "Organize (drag & drop)", href: "/organize", emoji: "🧩", keywords: "assign unfiled drag" },
  { kind: "page", id: "sessions", label: "All sessions", href: "/sessions", emoji: "🗂️" },
  { kind: "page", id: "companies", label: "Companies", href: "/companies", emoji: "🏢" },
  { kind: "page", id: "projects", label: "Projects & goals", href: "/projects", emoji: "🎯" },
  { kind: "page", id: "settings", label: "Sources & settings", href: "/settings", emoji: "⚙️", keywords: "triage memory sync import" },
];

/** Everything the command palette can jump to. Sessions are limited to the most recent ones. */
export async function buildSearchIndex(): Promise<Searchable[]> {
  const org = await getOrg();
  const sessions = all<{ id: string; title: string; repo: string | null; project_id: string | null }>(
    "select id, title, repo, project_id from sessions where archived = 0 order by last_activity_at desc nulls last limit 1000",
  );
  const todos = all<{ id: string; title: string; project_id: string | null }>(
    "select id, title, project_id, agent_id from tasks where origin = 'manual' and status <> 'done' limit 500",
  );
  const projectName = (id: string | null) => org.projects.find((p) => p.id === id)?.name ?? "";
  const items: Searchable[] = [...PAGES];
  for (const c of org.companies) items.push({ kind: "company", id: c.id, label: c.name, href: companyHref(c.slug), emoji: c.emoji, sublabel: "Company" });
  for (const p of org.projects) {
    const company = org.companies.find((c) => c.id === p.company_id);
    items.push({ kind: "project", id: p.id, label: p.name, href: projectHref(p.slug), emoji: p.emoji, sublabel: company ? `Project · ${company.name}` : "Project" });
  }
  for (const t of org.teams) items.push({ kind: "team", id: t.id, label: t.name, href: teamHref(t.id), emoji: "👥", sublabel: `Team · ${projectName(t.project_id)}` });
  for (const a of org.agents) {
    const team = org.teams.find((t) => t.id === a.team_id);
    items.push({ kind: "person", id: a.id, label: a.name, href: personHref(a.id), emoji: "🧑", sublabel: `${a.role} · ${projectName(team?.project_id ?? null)}`, keywords: a.role });
  }
  for (const g of org.goals) {
    const p = org.projects.find((x) => x.id === g.project_id);
    if (p) items.push({ kind: "goal", id: g.id, label: g.title, href: `${projectHref(p.slug)}#goal-${g.id}`, emoji: "🎯", sublabel: `Goal · ${p.name}` });
  }
  for (const s of sessions) {
    items.push({ kind: "session", id: s.id, label: s.title, href: `/sessions/${s.id}`, emoji: "💬", sublabel: `Session${s.project_id ? ` · ${projectName(s.project_id)}` : ""}`, keywords: s.repo ?? "" });
  }
  for (const t of todos) {
    items.push({ kind: "todo", id: t.id, label: t.title, href: "/todos", emoji: "✅", sublabel: `To-do${t.project_id ? ` · ${projectName(t.project_id)}` : ""}` });
  }
  return items;
}
