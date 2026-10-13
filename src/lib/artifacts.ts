import "server-only";
import { all, get, insert, run, tx, update } from "./db";
import type { Org } from "./queries";
import { parseArtifactList, type ArtifactIn } from "./sources/artifacts";
import type { CompanyRow, ProjectRow, SessionSource } from "./types";

export interface ArtifactRow {
  id: string;
  url: string;
  title: string | null;
  owner: "mine" | "shared" | null;
  updated_at: string | null;
  session_id: string | null;
  project_id: string | null;
  company_id: string | null;
  filed_by: "session" | "title" | "you" | null;
  account: string | null;
}

export interface ArtifactsResult {
  imported: number;
  updated: number;
}

/** Save an artifacts list (pasted, or sent by Claude); titles and dates refresh, filing is kept. */
export function saveArtifacts(rows: ArtifactIn[], account?: string): ArtifactsResult {
  if (!rows.length) return { imported: 0, updated: 0 };
  const known = new Set(all<{ id: string }>("select id from artifacts where id in (select value from json_each(?))", rows.map((r) => r.id)).map((r) => r.id));
  insert(
    "artifacts",
    rows.map((r) => ({ id: r.id, url: r.url, title: r.title ?? undefined, owner: r.owner ?? undefined, updated_at: r.updated_at ?? undefined, ...(account ? { account } : {}) })),
    { on: "id", do: "update" },
  );
  return { imported: rows.filter((r) => !known.has(r.id)).length, updated: rows.filter((r) => known.has(r.id)).length };
}

export function importArtifacts(payload: unknown, account?: string): ArtifactsResult {
  const rows = parseArtifactList(payload);
  if (!rows.length) throw new Error("No artifacts found there (expected claude.ai/artifact/… links, one per line, or JSON with url and title).");
  const r = saveArtifacts(rows, account);
  fileArtifacts();
  return r;
}

export function describeArtifacts(r: ArtifactsResult): string {
  return `Artifacts: ${r.imported} new, ${r.updated} updated`;
}

/**
 * Remember which session links to each artifact (from its transcript or summary). An artifact
 * Timu hadn't seen yet is added with just its link; its title arrives with the next list import.
 */
export function linkSessionArtifacts(links: { sessionId: string; artifacts: { id: string; url: string; title?: string | null }[] }[]): void {
  if (!links.length) return;
  tx(() => {
    // Each session's links are replaced, not added to: one it no longer claims is let go.
    for (const l of links) {
      run(
        "update artifacts set session_id = null where session_id = ? and id not in (select value from json_each(?))",
        l.sessionId,
        l.artifacts.map((a) => a.id),
      );
    }
    // Chat artifacts arrive with their title; published ones get theirs from the imported list.
    const rows = links.flatMap((l) => l.artifacts.map((a) => ({ id: a.id, url: a.url, session_id: l.sessionId, ...(a.title ? { title: a.title } : {}) })));
    if (rows.length) insert("artifacts", rows, { on: "id", do: "update" });
    // Rows known only from a link (never in an imported list) go once no session links them.
    run("delete from artifacts where session_id is null and title is null and owner is null and filed_by is not 'you'");
  });
}

/** Lowercase letters and digits only, with "&" read as "and": "Sunbeam & Co." → "sunbeamandco". */
const squash = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

/** The project (or failing that, company) whose name appears in a title, longest name first. */
export function matchByTitle(title: string, projects: Pick<ProjectRow, "id" | "name" | "company_id">[], companies: Pick<CompanyRow, "id" | "name">[]) {
  const t = squash(title);
  const hit = <T extends { name: string }>(rows: T[]) =>
    rows
      .filter((r) => squash(r.name).length >= 3 && t.includes(squash(r.name)))
      .sort((a, b) => squash(b.name).length - squash(a.name).length)[0] ?? null;
  const project = hit(projects);
  if (project) return { projectId: project.id, companyId: project.company_id };
  // Titles say "Sunbeam", not "Sunbeam Co": ignore the usual company endings.
  const company = hit(companies.map((c) => ({ ...c, name: c.name.replace(/[\s,.]+(co|inc|llc|ltd|gmbh|company|corp)\.?$/i, "") })));
  if (!company) return null;
  // A company with a single project: that's where it goes.
  const only = projects.filter((p) => p.company_id === company.id);
  return { projectId: only.length === 1 ? only[0].id : null, companyId: company.id };
}

/**
 * File every artifact you haven't placed yourself: under its linked session's project, else by
 * matching its title against project and company names. Yours ("you") are never moved.
 */
export function fileArtifacts(): number {
  const projects = all<Pick<ProjectRow, "id" | "name" | "company_id">>("select id, name, company_id from projects");
  const companies = all<Pick<CompanyRow, "id" | "name">>("select id, name from companies");
  const rows = all<ArtifactRow & { session_project: string | null }>(
    `select a.*, s.project_id as session_project from artifacts a left join sessions s on s.id = a.session_id
     where a.filed_by is null or a.filed_by <> 'you'`,
  );
  let moved = 0;
  for (const a of rows) {
    let next: Pick<ArtifactRow, "project_id" | "company_id" | "filed_by"> = { project_id: null, company_id: null, filed_by: null };
    if (a.session_project) {
      const p = projects.find((x) => x.id === a.session_project);
      next = { project_id: a.session_project, company_id: p?.company_id ?? null, filed_by: "session" };
    } else if (a.title) {
      const m = matchByTitle(a.title, projects, companies);
      if (m) next = { project_id: m.projectId, company_id: m.companyId, filed_by: "title" };
    }
    if (next.project_id !== a.project_id || next.company_id !== a.company_id || next.filed_by !== a.filed_by) {
      update("artifacts", next, "id = ?", a.id);
      moved++;
    }
  }
  return moved;
}

/** Put an artifact in a project yourself (null takes it out); Timu won't move it again. */
export function moveArtifact(id: string, projectId: string | null): void {
  const project = projectId ? get<{ id: string; company_id: string | null }>("select id, company_id from projects where id = ?", projectId) : null;
  if (projectId && !project) throw new Error("No such project.");
  update("artifacts", { project_id: project?.id ?? null, company_id: project?.company_id ?? null, filed_by: "you" }, "id = ?", id);
}

export interface ArtifactView {
  id: string;
  url: string;
  title: string;
  owner: ArtifactRow["owner"];
  updatedAt: string | null;
  filedBy: ArtifactRow["filed_by"];
  project: { id: string; name: string; emoji: string; slug: string } | null;
  company: { id: string; name: string; emoji: string } | null;
  session: { id: string; title: string; url: string | null; source: SessionSource } | null;
}

/**
 * Artifacts, newest first, with the project, company and session they're filed under. Files them
 * first, so one whose session was just moved or filed by the organiser follows it.
 */
export interface ArtifactFilter {
  companyId?: string;
  projectId?: string;
  /** Made by a session that works on this goal. */
  goalId?: string;
  /** Made by a session this teammate owns. */
  agentId?: string;
  /** Made by a session on this team. */
  teamId?: string;
  sessionId?: string;
}

export function getArtifacts(org: Org, filter: ArtifactFilter = {}): ArtifactView[] {
  fileArtifacts();
  const rows = all<ArtifactRow & { s_title: string | null; s_url: string | null; s_source: SessionSource | null; s_goal: string | null; s_agent: string | null; s_team: string | null }>(
    `select a.*, s.title as s_title, s.url as s_url, s.source as s_source, s.goal_id as s_goal, s.agent_id as s_agent, s.team_id as s_team
     from artifacts a left join sessions s on s.id = a.session_id
     order by coalesce(a.updated_at, a.imported_at) desc`,
  );
  const companyOf = (a: ArtifactRow) => a.company_id ?? org.projects.find((x) => x.id === a.project_id)?.company_id ?? null;
  return rows
    .filter(
      (a) =>
        (!filter.projectId || a.project_id === filter.projectId) &&
        (!filter.companyId || companyOf(a) === filter.companyId) &&
        (!filter.goalId || a.s_goal === filter.goalId) &&
        (!filter.agentId || a.s_agent === filter.agentId) &&
        (!filter.teamId || a.s_team === filter.teamId) &&
        (!filter.sessionId || a.session_id === filter.sessionId),
    )
    .map((a) => {
      const p = org.projects.find((x) => x.id === a.project_id) ?? null;
      const c = org.companies.find((x) => x.id === (a.company_id ?? p?.company_id)) ?? null;
      return {
        id: a.id,
        url: a.url,
        title: a.title ?? `Artifact ${a.id.slice(0, 8)}`,
        owner: a.owner,
        updatedAt: a.updated_at,
        filedBy: a.filed_by,
        project: p ? { id: p.id, name: p.name, emoji: p.emoji, slug: p.slug } : null,
        company: c ? { id: c.id, name: c.name, emoji: c.emoji } : null,
        session: a.session_id && a.s_title ? { id: a.session_id, title: a.s_title, url: a.s_url, source: a.s_source! } : null,
      };
    });
}

/** How many artifacts each session made, for the 🖼️ chips on board rows. */
export function artifactCountsBySession(): Record<string, number> {
  return Object.fromEntries(
    all<{ session_id: string; n: number }>("select session_id, count(*) as n from artifacts where session_id is not null group by session_id").map((r) => [r.session_id, r.n]),
  );
}
