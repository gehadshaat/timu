import type { Org } from "../queries";
import type { AgentRow, CompanyRow, GoalRow, ProjectRow, TeamRow } from "../types";

/**
 * MCP tools take references the way a person would give them: an id, a slug, or a name.
 * Names that repeat can be qualified with a path, e.g. "Sunbeam Web / Marketing" for a team.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s.trim());

/** Case-insensitive, whitespace- and slash-spacing-insensitive. */
export const normalize = (s: string) => s.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");

/**
 * Find exactly one row whose id is `ref` or one of whose `keys` equals it (normalised).
 * Throws with the candidates when nothing or more than one row matches.
 */
export function pick<T extends { id: string }>(
  rows: T[],
  ref: string,
  what: string,
  keys: (row: T) => string[],
  label: (row: T) => string,
): T {
  const r = ref.trim();
  const byId = rows.find((x) => x.id === r);
  if (byId) return byId;
  const n = normalize(r);
  const hits = rows.filter((x) => keys(x).some((k) => normalize(k) === n));
  if (hits.length === 1) return hits[0];
  const list = (xs: T[]) => xs.map((x) => `${label(x)} (id ${x.id})`).join("; ");
  if (hits.length > 1) throw new Error(`"${ref}" matches ${hits.length} ${what}s: ${list(hits)}. Pass the id instead.`);
  const near = rows.filter((x) => keys(x).some((k) => normalize(k).includes(n))).slice(0, 5);
  throw new Error(`No ${what} matches "${ref}".${near.length ? ` Did you mean: ${list(near)}?` : ""}`);
}

export function placeOfTeam(org: Org, team: TeamRow) {
  return org.projects.find((p) => p.id === team.project_id) ?? null;
}

export function resolveCompany(org: Org, ref: string): CompanyRow {
  return pick(org.companies, ref, "company", (c) => [c.slug, c.name], (c) => c.name);
}

export function resolveProject(org: Org, ref: string): ProjectRow {
  return pick(org.projects, ref, "project", (p) => [p.slug, p.name], (p) => p.name);
}

export function resolveTeam(org: Org, ref: string): TeamRow {
  return pick(
    org.teams,
    ref,
    "team",
    (t) => {
      const p = placeOfTeam(org, t);
      return [t.name, ...(p ? [`${p.name}/${t.name}`, `${p.slug}/${t.name}`] : [])];
    },
    (t) => `${placeOfTeam(org, t)?.name ?? "?"} / ${t.name}`,
  );
}

export function resolveTeammate(org: Org, ref: string): AgentRow {
  const teamOf = (a: AgentRow) => org.teams.find((t) => t.id === a.team_id);
  return pick(
    org.agents,
    ref,
    "teammate",
    (a) => {
      const t = teamOf(a);
      const p = t ? placeOfTeam(org, t) : null;
      return [a.name, ...(t ? [`${t.name}/${a.name}`] : []), ...(t && p ? [`${p.name}/${t.name}/${a.name}`] : [])];
    },
    (a) => `${a.name}, ${a.role} on ${teamOf(a)?.name ?? "?"}`,
  );
}

export function resolveGoal(org: Org, ref: string): GoalRow {
  const projectOf = (g: GoalRow) => org.projects.find((p) => p.id === g.project_id);
  return pick(
    org.goals,
    ref,
    "goal",
    (g) => [g.title, ...(projectOf(g) ? [`${projectOf(g)!.name}/${g.title}`] : [])],
    (g) => `${projectOf(g)?.name ?? "?"} / ${g.title}`,
  );
}

/**
 * A session can be named by its Timu id, its source's own id (a Claude Code `session_…` id or a
 * claude.ai conversation uuid), or its URL. Returns the bare id to look up.
 */
export function sessionKey(ref: string): string {
  const r = ref.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  return /^https?:\/\//i.test(r) ? r.slice(r.lastIndexOf("/") + 1) : r;
}
