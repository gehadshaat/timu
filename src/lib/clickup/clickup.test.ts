import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, insert, openDatabase, run, scalar, update, useDatabase } from "../db";
import { ClickUpClient, ClickUpError } from "./client";
import { FakeClickUp } from "./fake-clickup";
import { clickupConfigFromEnv, clickupLink, loadSnapshot, mirrorStatus, pushToClickUp, type ClickUpConfig } from "./mirror";
import { planMirror } from "./plan";
import { pickStatus } from "./statuses";

const writes = () => scalar<number>("select total_changes()");
const HOUR = 3600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

const config: ClickUpConfig = { token: "pk_test", spaceId: null, spaceName: "Timu", workspaceId: null, baseUrl: "https://clickup.test/api/v2" };

describe("pickStatus", () => {
  const defaults = [
    { status: "to do", type: "open", orderindex: 0 },
    { status: "in progress", type: "custom", orderindex: 1 },
    { status: "complete", type: "closed", orderindex: 2 },
  ];
  it("matches the suggested status names exactly, case-insensitively", () => {
    const timu = [
      { status: "Idle", type: "open" },
      { status: "WORKING", type: "custom" },
      { status: "needs you", type: "custom" },
      { status: "review", type: "custom" },
      { status: "done", type: "closed" },
    ];
    expect(pickStatus("needs_you", timu)).toBe("needs you");
    expect(pickStatus("working", timu)).toBe("WORKING");
    expect(pickStatus("idle", timu)).toBe("Idle");
    expect(pickStatus("done", timu)).toBe("done");
  });
  it("falls back by type on ClickUp's default statuses", () => {
    expect(pickStatus("working", defaults)).toBe("in progress");
    expect(pickStatus("needs_you", defaults)).toBe("to do");
    expect(pickStatus("done", defaults)).toBe("complete");
    expect(pickStatus("dropped", defaults)).toBe("complete");
    expect(pickStatus("working", [defaults[0], defaults[2]])).toBe("to do");
  });
  it("gives null for a list without statuses", () => {
    expect(pickStatus("idle", [])).toBeNull();
  });
});

describe("ClickUpClient", () => {
  it("sends the personal token as-is and waits out a 429 until the reset", async () => {
    const fake = new FakeClickUp();
    let clock = 1_000_000;
    const slept: number[] = [];
    fake.failures.push({ match: /^GET \/team$/, status: 429, headers: { "x-ratelimit-reset": String(Math.floor((clock + 30_000) / 1000)) }, times: 1 });
    const seen: string[] = [];
    const client = new ClickUpClient({
      token: "pk_test",
      baseUrl: config.baseUrl,
      fetch: async (url, init) => {
        seen.push(String((init?.headers as Record<string, string>).Authorization));
        return fake.fetch(url, init);
      },
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
    expect(await client.workspaces()).toEqual([{ id: "9001", name: "Sunbeam workspace" }]);
    expect(seen).toEqual(["pk_test", "pk_test"]);
    expect(slept).toEqual([30_000]);
  });

  it("waits before the next request once a window is used up, and gives up past the deadline", async () => {
    const fake = new FakeClickUp();
    let clock = 1_800_000_000_000;
    fake.rateHeaders = { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String((clock + 20_000) / 1000) };
    const slept: number[] = [];
    const client = new ClickUpClient({ token: "pk_test", baseUrl: config.baseUrl, fetch: fake.fetch, sleep: async (ms) => void slept.push(ms), now: () => clock });
    await client.workspaces();
    client.deadline = clock + 60_000;
    await client.workspaces();
    expect(slept).toEqual([20_000]);
    clock += 1; // still blocked, but now the reset is past the deadline
    client.deadline = clock + 1_000;
    await expect(client.workspaces()).rejects.toMatchObject({ status: 429 });
  });

  it("turns error bodies into ClickUpErrors", async () => {
    const fake = new FakeClickUp();
    fake.failures.push({ match: /GET \/team/, status: 401, times: 1 });
    const client = new ClickUpClient({ token: "pk_bad", baseUrl: config.baseUrl, fetch: fake.fetch });
    const err = await client.workspaces().catch((e) => e);
    expect(err).toBeInstanceOf(ClickUpError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/rejected the token/);
  });
});

describe("clickupConfigFromEnv", () => {
  it("is off without a token, and reads the rest", () => {
    expect(clickupConfigFromEnv({})).toBeNull();
    expect(clickupConfigFromEnv({ CLICKUP_API_TOKEN: " pk_1 ", CLICKUP_SPACE_ID: "77" })).toMatchObject({ token: "pk_1", spaceId: "77", spaceName: "Timu", workspaceId: null });
  });
});

// ---------- the demo workspace ----------

let ids: Record<string, string>;

function seed() {
  for (const t of ["clickup_links", "artifacts", "goal_milestones", "tasks", "sessions", "goals", "agents", "teams", "projects", "companies"]) run(`delete from ${t}`);
  const [sunbeam] = insert<{ id: string }>("companies", { slug: "sunbeam-co", name: "Sunbeam Co", emoji: "🌞" });
  const [web] = insert<{ id: string }>("projects", { slug: "sunbeam-web", name: "Sunbeam Web", emoji: "🌞", company_id: sunbeam.id });
  const [duck] = insert<{ id: string }>("projects", { slug: "procurement-app", name: "Procurement App", emoji: "🦆" });
  const [frontend] = insert<{ id: string }>("teams", { project_id: web.id, name: "Frontend" });
  const [backend] = insert<{ id: string }>("teams", { project_id: web.id, name: "Backend" });
  const [maya] = insert<{ id: string }>("agents", { team_id: frontend.id, name: "Maya", role: "Frontend engineer" });
  const [leo] = insert<{ id: string }>("agents", { team_id: backend.id, name: "Leo", role: "API engineer" });
  const [goal] = insert<{ id: string }>("goals", { project_id: web.id, title: "Ship checkout v2", priority: "high", due_date: "2026-11-01" });
  insert("goal_milestones", [
    { goal_id: goal.id, title: "Design review", position: 0, done: true, done_at: ago(24) },
    { goal_id: goal.id, title: "Payment form", position: 1 },
  ]);
  const session = (title: string, over: Record<string, unknown>) =>
    insert<{ id: string }>("sessions", { source: "cloud", external_id: `session_${title.replace(/\W/g, "")}`, title, url: `https://claude.ai/code/session_${title.replace(/\W/g, "")}`, status: "idle", ...over })[0].id;
  const login = session("Fix login redirect", { agent_id: maya.id, team_id: frontend.id, project_id: web.id, status: "working", last_activity_at: ago(1), started_at: ago(3), goal_id: goal.id });
  const rates = session("Rate limit the API", { agent_id: leo.id, team_id: backend.id, project_id: web.id, status: "needs_you", last_activity_at: ago(2) });
  const loose = session("Tidy the README", { project_id: duck.id, status: "done", last_activity_at: ago(5) });
  const stray = session("Quick question", { source: "claude_ai", url: null, last_activity_at: ago(6) });
  const old = session("Old experiment", { archived: true, last_activity_at: ago(500) });
  insert("tasks", { session_id: rates, kind: "decide", title: "Pick a rate limit", detail: "100 or 1,000 a minute?", origin: "classifier" });
  const [todo] = insert<{ id: string }>("tasks", { kind: "todo", origin: "manual", title: "Order test cards", project_id: web.id, agent_id: maya.id, priority: "low" });
  const [mine] = insert<{ id: string }>("tasks", { kind: "todo", origin: "manual", title: "Renew the domain" });
  insert("tasks", { kind: "todo", origin: "manual", title: "Already done", status: "done" });
  insert("artifacts", { id: "art_checkout", url: "https://claude.ai/artifact/art_checkout", title: "Checkout [draft]", session_id: login });
  ids = { sunbeam: sunbeam.id, web: web.id, duck: duck.id, frontend: frontend.id, backend: backend.id, maya: maya.id, leo: leo.id, goal: goal.id, login, rates, loose, stray, old, todo: todo.id, mine: mine.id };
}

describe("planMirror", () => {
  beforeAll(() => useDatabase(openDatabase(":memory:")));
  afterAll(() => useDatabase(null));
  beforeEach(seed);

  it("lays the org out in one space: a folder per project, a list per team, goals and to-dos lists", () => {
    const plan = planMirror(loadSnapshot());
    expect(plan.folders.map((f) => f.name).sort()).toEqual(["Sunbeam Co · 🌞 Sunbeam Web", "🦆 Procurement App"]);
    const lists = Object.fromEntries(plan.lists.map((l) => [l.key, [l.name, l.folder]]));
    expect(lists[`list:team:${ids.frontend}`]).toEqual(["Frontend", `folder:${ids.web}`]);
    expect(lists[`list:goals:${ids.web}`]).toEqual(["🎯 Goals", `folder:${ids.web}`]);
    expect(lists[`list:todos:${ids.web}`]).toEqual(["✅ To-dos", `folder:${ids.web}`]);
    expect(lists[`list:loose:${ids.duck}`]).toEqual(["No team", `folder:${ids.duck}`]);
    expect(lists["list:unfiled"]).toEqual(["📥 Unfiled sessions", null]);
    expect(lists["list:todos:none"]).toEqual(["✅ To-dos", null]);
  });

  it("puts each thing in its list with the board's status, teammate tags and the ask up top", () => {
    const tasks = Object.fromEntries(planMirror(loadSnapshot()).tasks.map((t) => [t.key, t]));
    const login = tasks[`session:${ids.login}`];
    expect(login).toMatchObject({ list: `list:team:${ids.frontend}`, status: "working", tags: ["maya"], archived: false, skipIfNew: false });
    expect(login.markdown).toContain("[Open the session ↗](https://claude.ai/code/session_Fixloginredirect)");
    expect(login.markdown).toContain("**Goal:** Ship checkout v2");
    expect(login.markdown).toContain("[Checkout (draft)](https://claude.ai/artifact/art_checkout)");
    const rates = tasks[`session:${ids.rates}`];
    expect(rates.status).toBe("needs_you");
    expect(rates.markdown.startsWith("> 🙋 **Needs you (decide):** Pick a rate limit\n> 100 or 1,000 a minute?")).toBe(true);
    expect(tasks[`session:${ids.loose}`]).toMatchObject({ list: `list:loose:${ids.duck}`, status: "done" });
    expect(tasks[`session:${ids.stray}`]).toMatchObject({ list: "list:unfiled", status: "idle" });
    // Archived sessions and finished to-dos aren't loaded until they're in ClickUp.
    expect(tasks[`session:${ids.old}`]).toBeUndefined();
    expect(Object.values(tasks).some((t) => t.name === "Already done")).toBe(false);
    expect(tasks[`todo:${ids.todo}`]).toMatchObject({ list: `list:todos:${ids.web}`, priority: 4, tags: ["maya"], status: "idle" });
    expect(tasks[`todo:${ids.mine}`]).toMatchObject({ list: "list:todos:none", tags: [] });
    expect(tasks[`goal:${ids.goal}`]).toMatchObject({ status: "working", priority: 2, dueDate: Date.UTC(2026, 10, 1, 12) });
  });

  it("orders goals before their milestones, and sessions most recent first", () => {
    const keys = planMirror(loadSnapshot()).tasks.map((t) => t.key);
    expect(keys.indexOf(`goal:${ids.goal}`)).toBeLessThan(keys.findIndex((k) => k.startsWith("milestone:")));
    const sessions = keys.filter((k) => k.startsWith("session:"));
    expect(sessions).toEqual([`session:${ids.login}`, `session:${ids.rates}`, `session:${ids.loose}`, `session:${ids.stray}`]);
  });
});

describe("pushToClickUp", () => {
  let fake: FakeClickUp;
  const client = () => new ClickUpClient({ token: "pk_test", baseUrl: config.baseUrl, fetch: fake.fetch, sleep: async () => undefined });
  const pushOnce = (budgetMs = 60_000) => pushToClickUp({ config, client: client(), budgetMs });
  const taskOf = (key: string) => fake.tasks.get(all<{ clickup_id: string }>("select clickup_id from clickup_links where key = ?", key)[0]?.clickup_id ?? "");
  const listNamed = (name: string, folder?: string) => fake.lists.find((l) => l.name === name && (folder === undefined || fake.folders.find((f) => f.id === l.folder)?.name === folder));

  beforeAll(() => useDatabase(openDatabase(":memory:")));
  afterAll(() => useDatabase(null));
  beforeEach(() => {
    seed();
    fake = new FakeClickUp();
    fake.newSpaceStatuses = [
      { status: "idle", type: "open", orderindex: 0 },
      { status: "working", type: "custom", orderindex: 1 },
      { status: "needs you", type: "custom", orderindex: 2 },
      { status: "review", type: "custom", orderindex: 3 },
      { status: "done", type: "closed", orderindex: 4 },
    ];
  });

  it("makes the Timu space, its folders and lists, and a task for everything", async () => {
    const r = await pushOnce();
    expect(r.ok).toBe(true);
    expect(fake.spaces.map((s) => s.name)).toEqual(["Timu"]);
    expect(fake.folders.map((f) => f.name).sort()).toEqual(["Sunbeam Co · 🌞 Sunbeam Web", "🦆 Procurement App"]);
    const frontend = listNamed("Frontend", "Sunbeam Co · 🌞 Sunbeam Web")!;
    const login = taskOf(`session:${ids.login}`)!;
    expect(login).toMatchObject({ list: frontend.id, name: "Fix login redirect", status: "working", tags: ["maya"] });
    expect(taskOf(`session:${ids.rates}`)).toMatchObject({ status: "needs you", tags: ["leo"] });
    expect(taskOf(`session:${ids.loose}`)).toMatchObject({ list: listNamed("No team")!.id, status: "done" });
    expect(taskOf(`session:${ids.stray}`)!.list).toBe(listNamed("📥 Unfiled sessions")!.id);
    const goal = taskOf(`goal:${ids.goal}`)!;
    const milestones = [...fake.tasks.values()].filter((t) => t.parent === goal.id);
    expect(milestones.map((m) => [m.name, m.status])).toEqual([["Design review", "done"], ["Payment form", "idle"]]);
    expect(fake.spaces[0].tags.sort()).toEqual(["leo", "maya"]);
    expect([...fake.tasks.values()].some((t) => t.name === "Old experiment" || t.name === "Already done")).toBe(false);
    expect(r.message).toBe("ClickUp: 9 created");
    expect(clickupLink("session", ids.login)?.url).toBe(`https://app.clickup.com/t/${login.id}`);
    expect(mirrorStatus().mirrored).toMatchObject({ sessions: 4, goals: 1, milestones: 2, todos: 2, folders: 2 });
  });

  it("costs no requests and writes nothing when nothing changed", async () => {
    await pushOnce();
    fake.log = [];
    const before = writes();
    const r = await pushOnce();
    expect(r.message).toBe("ClickUp: up to date");
    expect(fake.log).toEqual([]);
    expect(writes()).toBe(before);
  });

  it("updates only what changed, and swaps the teammate tag", async () => {
    await pushOnce();
    fake.log = [];
    update("sessions", { status: "done", title: "Fix login redirect loop", agent_id: ids.leo, team_id: ids.frontend }, "id = ?", ids.login);
    const r = await pushOnce();
    expect(r.updated).toBe(1);
    const login = taskOf(`session:${ids.login}`)!;
    expect(login).toMatchObject({ name: "Fix login redirect loop", status: "done", tags: ["leo"] });
    expect(fake.writes().filter((l) => l.startsWith("PUT /task/"))).toHaveLength(1);
  });

  it("moves a session's task when it's filed to another team", async () => {
    await pushOnce();
    const before = taskOf(`session:${ids.login}`)!.id;
    update("sessions", { agent_id: ids.leo, team_id: ids.backend }, "id = ?", ids.login);
    const r = await pushOnce();
    expect(r.moved).toBe(1);
    const after = taskOf(`session:${ids.login}`)!;
    expect(after.id).toBe(before);
    expect(after.list).toBe(listNamed("Backend")!.id);
  });

  it("starts the task over in the new list when ClickUp won't move it", async () => {
    await pushOnce();
    const before = taskOf(`session:${ids.login}`)!;
    // The Backend list has statuses of its own, without the task's "working".
    listNamed("Backend")!.statuses = [
      { status: "backlog", type: "open", orderindex: 0 },
      { status: "shipped", type: "closed", orderindex: 1 },
    ];
    update("sessions", { agent_id: ids.leo, team_id: ids.backend }, "id = ?", ids.login);
    const r = await pushOnce();
    expect(r).toMatchObject({ ok: true, moved: 0, created: 1 });
    expect(before.archived).toBe(true);
    expect(taskOf(`session:${ids.login}`)).toMatchObject({ list: listNamed("Backend")!.id, status: "backlog", archived: false });
  });

  it("archives what was archived or deleted in Timu, and renames folders", async () => {
    await pushOnce();
    const todoTask = taskOf(`todo:${ids.mine}`)!;
    run("delete from tasks where id = ?", ids.mine);
    update("sessions", { archived: true }, "id = ?", ids.stray);
    update("projects", { name: "Sunbeam Website" }, "id = ?", ids.web);
    const r = await pushOnce();
    expect(r.archived).toBe(1);
    expect(todoTask.archived).toBe(true);
    expect(all("select key from clickup_links where key = ?", `todo:${ids.mine}`)).toEqual([]);
    expect(taskOf(`session:${ids.stray}`)!.archived).toBe(true);
    expect(fake.folders.map((f) => f.name)).toContain("Sunbeam Co · 🌞 Sunbeam Website");
  });

  it("makes a task again when it was deleted in ClickUp", async () => {
    await pushOnce();
    const gone = taskOf(`session:${ids.login}`)!.id;
    fake.tasks.delete(gone);
    update("sessions", { status: "done" }, "id = ?", ids.login);
    await pushOnce();
    const again = taskOf(`session:${ids.login}`)!;
    expect(again.id).not.toBe(gone);
    expect(again.status).toBe("done");
  });

  it("falls back to ClickUp's default statuses when the space has its own", async () => {
    fake.newSpaceStatuses = [
      { status: "to do", type: "open", orderindex: 0 },
      { status: "in progress", type: "custom", orderindex: 1 },
      { status: "complete", type: "closed", orderindex: 2 },
    ];
    await pushOnce();
    expect(taskOf(`session:${ids.login}`)!.status).toBe("in progress");
    expect(taskOf(`session:${ids.rates}`)!.status).toBe("to do");
    expect(taskOf(`session:${ids.loose}`)!.status).toBe("complete");
  });

  it("stops at its time budget and carries on at the next push", async () => {
    const first = await pushOnce(0);
    expect(first.ok).toBe(true);
    expect(first.created).toBe(0);
    expect(first.left).toBeGreaterThan(0);
    const second = await pushOnce();
    expect(second.created).toBe(9);
    expect(second.left).toBe(0);
  });

  it("uses an existing space with the same name and adopts its folders", async () => {
    fake.spaces.push({ id: "s1", workspace: "9001", name: "timu", statuses: fake.newSpaceStatuses, tags: [] });
    fake.folders.push({ id: "f1", space: "s1", name: "🦆 Procurement App" });
    await pushOnce();
    expect(fake.spaces).toHaveLength(1);
    expect(fake.folders.filter((f) => f.name === "🦆 Procurement App")).toHaveLength(1);
    expect(listNamed("No team")!.folder).toBe("f1");
  });

  it("reports a rejected token without throwing", async () => {
    fake.failures.push({ match: /GET \/team$/, status: 401, times: 1 });
    const r = await pushOnce();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/rejected the token/);
  });
});
