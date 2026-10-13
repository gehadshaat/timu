import "server-only";
import { all, get, insert, now, setSetting, update } from "../db";
import { likePrefix } from "../slugs";
import { hash, slugify } from "../text";
import { themeForSlug } from "../themes";
import type { AgentRow, GoalRow, ProjectRow, TeamRow, TaskKind } from "../types";
import type { Proposal, ProposalProject, SessionDigest } from "./schema";

const PROJECT_COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9", "#22c55e"];
const TEAM_COLORS = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe", "#fed7aa", "#a5f3fc", "#e9d5ff"];

/** Load sessions in the compact shape the classifiers read. */
export async function loadDigests(onlyUnclassified: boolean): Promise<SessionDigest[]> {
  const rows = all<Omit<SessionDigest, "workspace"> & { raw: Record<string, unknown>; agent_id: string | null }>(
    `select id, source, title, repo, raw, agent_id, status, status_detail, first_user_message, last_message, last_message_role, last_activity_at
     from sessions where archived = 0${onlyUnclassified ? " and classified_at is null" : ""}
     order by last_activity_at desc nulls last`,
  );
  return rows.map(({ raw, agent_id, ...r }) => ({
    ...r,
    current_member_key: agent_id,
    workspace: (raw?.project as string) ?? (raw?.cwd as string) ?? null,
    first_user_message: r.first_user_message?.slice(0, 600) ?? null,
    last_message: r.last_message?.slice(0, 600) ?? null,
  }));
}

/** The saved org, in proposal shape with database ids as keys (for incremental classification). */
export async function loadOrgAsProposal(): Promise<ProposalProject[]> {
  const Co = all<{ id: string; name: string }>("select id, name from companies");
  const P = all<ProjectRow>("select * from projects");
  const T = all<TeamRow>("select * from teams");
  const A = all<AgentRow>("select * from agents");
  const G = all<GoalRow>("select * from goals where status = 'active'");
  return P.map((p) => ({
    key: p.id,
    name: p.name,
    company: Co.find((c) => c.id === p.company_id)?.name ?? null,
    description: p.description,
    emoji: p.emoji,
    teams: T.filter((t) => t.project_id === p.id).map((t) => ({
      key: t.id,
      name: t.name,
      description: t.description,
      members: A.filter((a) => a.team_id === t.id).map((a) => ({
        key: a.id,
        name: a.name,
        role: a.role,
        persona: a.persona,
        prop: (a.avatar?.prop ?? "mug") as ProposalProject["teams"][number]["members"][number]["prop"],
      })),
    })),
    goals: G.filter((g) => g.project_id === p.id).map((g) => ({
      key: g.id,
      title: g.title,
      description: g.description,
      team_key: g.team_id,
    })),
  }));
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Write a proposal: create or reuse projects/teams/agents/goals, assign sessions,
 * and open tasks for sessions Claude judged as needing the user.
 */
export async function applyProposal(proposal: Proposal): Promise<void> {
  const ids = new Map<string, string>(); // proposal key -> db id
  const companyIds = new Map<string, string>(); // lower-cased name -> db id
  const companyFor = async (name: string | null | undefined): Promise<string | null> => {
    const clean = name?.trim();
    if (!clean) return null;
    const k = clean.toLowerCase();
    if (companyIds.has(k)) return companyIds.get(k)!;
    const existing = get<{ id: string }>("select id from companies where name like ? escape '\\' limit 1", likePrefix(clean));
    let id = existing?.id;
    if (!id) {
      const base = slugify(clean);
      const taken = new Set(all<{ slug: string }>("select slug from companies where slug like ? escape '\\'", `${likePrefix(base)}%`).map((r) => r.slug));
      let slug = base;
      for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
      id = insert<{ id: string }>("companies", { slug, name: clean })[0].id;
    }
    companyIds.set(k, id);
    return id;
  };

  for (const p of proposal.projects) {
    let projectId: string;
    if (UUID.test(p.key)) {
      projectId = p.key;
      const companyId = await companyFor(p.company);
      update("projects", { name: p.name, description: p.description, emoji: p.emoji, ...(companyId ? { company_id: companyId } : {}) }, "id = ?", p.key);
    } else {
      const slug = await uniqueSlug(p.name);
      const [row] = insert<{ id: string }>("projects", {
        slug,
        name: p.name,
        description: p.description,
        emoji: p.emoji,
        color: PROJECT_COLORS[hash(slug) % PROJECT_COLORS.length],
        theme: themeForSlug(slug),
        company_id: await companyFor(p.company),
      });
      projectId = row.id;
    }
    ids.set(p.key, projectId);

    for (const t of p.teams) {
      let teamId: string;
      if (UUID.test(t.key)) teamId = t.key;
      else {
        const [row] = insert<{ id: string }>(
          "teams",
          { project_id: projectId, name: t.name, description: t.description, color: TEAM_COLORS[hash(t.name) % TEAM_COLORS.length] },
          { on: "project_id, name", do: "update" },
        );
        teamId = row.id;
      }
      ids.set(t.key, teamId);

      for (const m of t.members) {
        if (UUID.test(m.key)) {
          ids.set(m.key, m.key);
          continue;
        }
        const [row] = insert<{ id: string }>(
          "agents",
          {
            team_id: teamId,
            name: m.name,
            role: m.role,
            persona: m.persona,
            avatar: { seed: `${m.name}:${m.role}`, prop: m.prop },
          },
          { on: "team_id, name", do: "update" },
        );
        ids.set(m.key, row.id);
      }
    }

    for (const g of p.goals) {
      if (UUID.test(g.key)) {
        ids.set(g.key, g.key);
        continue;
      }
      const [row] = insert<{ id: string }>("goals", {
        project_id: projectId,
        team_id: g.team_key ? ids.get(g.team_key) ?? null : null,
        title: g.title,
        description: g.description,
      });
      ids.set(g.key, row.id);
    }
  }

  const at = now();
  for (const a of proposal.assignments) {
    const values = {
      project_id: ids.get(a.project_key) ?? null,
      team_id: ids.get(a.team_key) ?? null,
      agent_id: ids.get(a.member_key) ?? null,
      goal_id: a.goal_key ? ids.get(a.goal_key) ?? null : null,
      summary: a.summary,
      classified_at: at,
    };
    update("sessions", values, "id = ?", a.session_id);

    if (a.attention !== "none") await raiseTask(a.session_id, a.attention, a.ask);
  }
}

/** Open (or sharpen) the task for a session the classifier flagged. */
async function raiseTask(sessionId: string, kind: TaskKind, ask: string | null): Promise<void> {
  const session = get<{ title: string; status_detail: string | null; last_activity_at: string | null; triage: { needed: boolean } | null; archived: boolean }>(
    "select title, status_detail, last_activity_at, triage, archived from sessions where id = ?",
    sessionId,
  );
  if (!session || session.archived) return;
  // The triage judge (rules + a cheap model + your memory) has the final say on whether you're needed.
  if (session.triage && session.triage.needed === false) return;
  const fallback = `${kind[0].toUpperCase()}${kind.slice(1)}: ${session.title}`;
  const active = get<{ id: string; title: string }>("select id, title from tasks where session_id = ? and status <> 'done'", sessionId);
  if (active) {
    const title = ask?.trim() || active.title;
    update("tasks", { kind, title, origin: "classifier" }, "id = ?", active.id);
    return;
  }
  const title = ask?.trim() || fallback;
  // Respect a task the user already closed for this same activity.
  const closed = all<{ id: string; raised_at: string }>(
    "select id, raised_at from tasks where session_id = ? and status = 'done' order by raised_at desc limit 1",
    sessionId,
  );
  if (closed[0] && session.last_activity_at && closed[0].raised_at >= session.last_activity_at) return;
  insert("tasks", {
    session_id: sessionId,
    kind,
    title,
    origin: "classifier",
    detail: session.status_detail ?? "",
    raised_at: session.last_activity_at ?? now(),
  });
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  const existing = all<{ slug: string }>("select slug from projects where slug like ? escape '\\'", `${likePrefix(base)}%`);
  const taken = new Set(existing.map((e) => e.slug));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export async function markSetupComplete(): Promise<void> {
  await setSetting("setup_complete", true);
}
