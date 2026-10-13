import "server-only";
import { get, getSetting, insert, now, setSetting, update } from "./db";
import { hasClaude, proposeWithClaude } from "./classify/claude";
import { proposeHeuristically } from "./classify/heuristic";
import { applyProposal, loadDigests, loadOrgAsProposal, markSetupComplete } from "./classify/apply";
import type { Proposal } from "./classify/schema";

/**
 * Organising runs in the background (it can take a few minutes with many sessions);
 * progress lives in the settings table so the UI can poll it.
 */
export interface OrganizeJob {
  state: "idle" | "running" | "ready" | "applied" | "error";
  mode: "setup" | "incremental";
  engine: "claude" | "heuristic";
  done: number;
  total: number;
  proposalId?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

const KEY = "organize_job";

export async function getOrganizeJob(): Promise<OrganizeJob | null> {
  return getSetting<OrganizeJob>(KEY);
}

async function save(job: OrganizeJob) {
  await setSetting(KEY, job);
}

/**
 * setup: classify everything into a fresh draft proposal for review.
 * incremental: classify unclassified sessions against the saved org and apply straight away.
 */
export async function startOrganize(mode: OrganizeJob["mode"], opts: { forceHeuristic?: boolean } = {}): Promise<OrganizeJob> {
  const current = await getOrganizeJob();
  if (current?.state === "running" && current.startedAt && Date.now() - Date.parse(current.startedAt) < 15 * 60_000) {
    return current;
  }
  const engine = hasClaude() && !opts.forceHeuristic ? "claude" : "heuristic";
  const job: OrganizeJob = { state: "running", mode, engine, done: 0, total: 0, startedAt: new Date().toISOString() };
  await save(job);
  // Deliberately not awaited: the Node server keeps running the promise after the response.
  void runOrganize(job).catch(async (err) => {
    await save({ ...job, state: "error", error: err instanceof Error ? err.message : String(err), finishedAt: new Date().toISOString() });
  });
  return job;
}

async function runOrganize(job: OrganizeJob): Promise<void> {
  const digests = await loadDigests(job.mode === "incremental");
  job.total = digests.length;
  await save(job);

  if (digests.length === 0) {
    await save({ ...job, state: job.mode === "setup" ? "ready" : "applied", finishedAt: new Date().toISOString() });
    return;
  }

  let proposal: Proposal;
  if (job.engine === "claude") {
    const existing = job.mode === "incremental" ? await loadOrgAsProposal() : [];
    proposal = await proposeWithClaude(digests, existing, (done) => save({ ...job, done }));
  } else {
    proposal = proposeHeuristically(digests);
    if (job.mode === "incremental") proposal = await reuseExistingByName(proposal);
  }

  if (job.mode === "incremental") {
    await applyProposal(proposal);
    await save({ ...job, done: job.total, state: "applied", finishedAt: new Date().toISOString() });
    return;
  }

  const [row] = insert<{ id: string }>("proposals", { engine: job.engine, body: proposal });
  await save({ ...job, done: job.total, state: "ready", proposalId: row.id, finishedAt: new Date().toISOString() });
}

/** Heuristic incremental runs: map freshly-invented keys onto existing rows with the same names. */
async function reuseExistingByName(p: Proposal): Promise<Proposal> {
  const org = await loadOrgAsProposal();
  const rename = new Map<string, string>();
  for (const np of p.projects) {
    const ep = org.find((o) => o.name === np.name);
    if (!ep) continue;
    rename.set(np.key, ep.key);
    np.key = ep.key;
    for (const nt of np.teams) {
      const et = ep.teams.find((t) => t.name === nt.name);
      if (!et) continue;
      rename.set(nt.key, et.key);
      nt.key = et.key;
      for (const nm of nt.members) {
        const em = et.members.find((m) => m.role === nm.role);
        if (em) {
          rename.set(nm.key, em.key);
          Object.assign(nm, { key: em.key, name: em.name });
        }
      }
    }
  }
  const r = (k: string | null) => (k ? rename.get(k) ?? k : k);
  return {
    projects: p.projects,
    assignments: p.assignments.map((a) => ({
      ...a,
      project_key: r(a.project_key)!,
      team_key: r(a.team_key)!,
      member_key: r(a.member_key)!,
      goal_key: r(a.goal_key),
    })),
  };
}

export async function loadProposal(id: string): Promise<{ id: string; engine: string; status: string; body: Proposal } | null> {
  return get<{ id: string; engine: string; status: string; body: Proposal }>("select id, engine, status, body from proposals where id = ?", id);
}

export async function applyDraft(id: string, body: Proposal): Promise<void> {
  await applyProposal(body);
  update("proposals", { status: "applied", body, applied_at: now() }, "id = ?", id);
  await markSetupComplete();
  const job = await getOrganizeJob();
  if (job) await save({ ...job, state: "applied" });
}

export async function isSetupComplete(): Promise<boolean> {
  return (await getSetting<boolean>("setup_complete")) === true;
}
