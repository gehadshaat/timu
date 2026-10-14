import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insert, openDatabase, tx, useDatabase } from "./db";
import { getHome, getNav } from "./home";
import { getGoals, getInbox, getOffice, getOrg, getSessions, getTodos } from "./queries";

/**
 * Speed budget: every read model a page loads stays under 20 ms on a workspace bigger than most
 * (2,000 sessions, 400 open asks, 60 teammates), with room for CI machines about twice as slow
 * as a laptop. A query that grows a scan or an N+1 fails here.
 */
const BUDGET_MS = 20;
const SESSIONS = 2000;

/**
 * The best of several timed runs, after two warm-ups (prepared statements, JIT). The best run is what
 * the code costs; slower ones measure the machine (GC, a busy CI runner), which would make this flaky.
 */
async function fastest(fn: () => unknown): Promise<number> {
  await fn();
  await fn();
  let best = Infinity;
  for (let i = 0; i < 9; i++) {
    const t = performance.now();
    await fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

describe("page queries stay fast", () => {
  let projectId = "";

  beforeAll(() => {
    useDatabase(openDatabase(":memory:"));
    const names = ["Maya", "Leo", "Iris", "Kai", "Nora", "Theo", "Omar", "Sam", "Lena", "Pip"];
    const statuses = ["working", "needs_you", "review", "idle", "done", "failed"];
    tx(() => {
      const agents: { id: string; team_id: string; project_id: string }[] = [];
      for (const [c, company] of ["Sunbeam Co", "Duckworks"].entries()) {
        const [co] = insert<{ id: string }>("companies", { slug: `co-${c}`, name: company });
        for (let p = 0; p < 3; p++) {
          const [project] = insert<{ id: string }>("projects", { slug: `p-${c}-${p}`, name: `${company} project ${p}`, company_id: co.id });
          projectId ||= project.id;
          for (let g = 0; g < 4; g++) insert("goals", { project_id: project.id, title: `Goal ${g}` });
          for (let t = 0; t < 2; t++) {
            const [team] = insert<{ id: string }>("teams", { project_id: project.id, name: `Team ${t}` });
            for (let a = 0; a < 5; a++) {
              const [agent] = insert<{ id: string }>("agents", { team_id: team.id, name: names[(p * 10 + t * 5 + a) % names.length], role: "Dev" });
              agents.push({ id: agent.id, team_id: team.id, project_id: project.id });
            }
          }
        }
      }
      const now = Date.now();
      for (let i = 0; i < SESSIONS; i++) {
        const a = agents[i % agents.length];
        const [s] = insert<{ id: string }>("sessions", {
          source: i % 3 ? "local" : "cloud",
          external_id: `session_${i}`,
          title: `Sunbeam session ${i}`,
          status: statuses[i % statuses.length],
          last_message: "Should I ship the pricing page now?",
          last_activity_at: new Date(now - i * 600_000).toISOString(),
          ...(i % 10 ? { agent_id: a.id, team_id: a.team_id, project_id: a.project_id } : {}),
        });
        if (i % 5 === 0) insert("tasks", { session_id: s.id, kind: "respond", title: `Reply to session ${i}`, status: "open", agent_id: a.id, project_id: a.project_id });
      }
    });
  });
  afterAll(() => useDatabase(null));

  const reads: [string, () => unknown][] = [
    ["getOrg", () => getOrg()],
    ["getNav (every page)", () => getNav()],
    ["getHome", () => getHome()],
    ["getInbox", () => getInbox()],
    ["getSessions", () => getSessions()],
    ["getOffice", () => getOffice()],
    ["getTodos", () => getTodos()],
    ["getGoals", () => getGoals(projectId)],
  ];
  for (const [name, fn] of reads) {
    it(`${name} under ${BUDGET_MS} ms`, async () => {
      expect(await fastest(fn)).toBeLessThan(BUDGET_MS);
    });
  }
});
