/** Command-palette search: rank companies, projects, teams, people, goals, sessions and to-dos. */

export type SearchKind = "company" | "project" | "team" | "person" | "goal" | "session" | "todo" | "page";

export interface Searchable {
  kind: SearchKind;
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  /** Extra words that should match (role, repo, project name…). */
  keywords?: string;
  emoji?: string;
}

const KIND_ORDER: Record<SearchKind, number> = { page: 0, company: 1, project: 2, team: 3, person: 4, goal: 5, todo: 6, session: 7 };

export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** 0 = no match; higher is better. */
export function scoreMatch(query: string, item: Searchable): number {
  const q = fold(query);
  if (!q) return 0;
  const label = fold(item.label);
  const extra = fold(`${item.sublabel ?? ""} ${item.keywords ?? ""}`);
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.split(/[\s/·:—-]+/).some((w) => w.startsWith(q))) return 65;
  if (label.includes(q)) return 50;
  const terms = q.split(" ");
  if (terms.length > 1 && terms.every((t) => label.includes(t) || extra.includes(t))) return 40;
  if (extra.includes(q)) return 25;
  return 0;
}

export function rankSearch(query: string, items: Searchable[], limit = 24): Searchable[] {
  return items
    .map((item) => ({ item, score: scoreMatch(query, item) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.item.label.localeCompare(b.item.label))
    .slice(0, limit)
    .map((x) => x.item);
}
