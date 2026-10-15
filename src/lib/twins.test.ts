import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, get, insert, openDatabase, run, scalar, update, useDatabase } from "./db";
import { ingestSessions } from "./ingest";
import { resumeFor } from "./links";
import { findSessions } from "./mcp/lookup";
import type { NormalizedSession, SessionRow } from "./types";

const AN_HOUR_AGO = new Date(Date.now() - 3600_000).toISOString();
const TWO_HOURS_AGO = new Date(Date.now() - 2 * 3600_000).toISOString();
const writes = () => scalar<number>("select total_changes()");

const CLOUD_ID = "session_01SunbeamSetup";
const TRANSCRIPT = "7d1e0c52-0000-4000-8000-000000000001";

const cloud = (over: Partial<NormalizedSession> = {}): NormalizedSession => ({
  source: "cloud",
  externalId: CLOUD_ID,
  title: "One-step setup and live sync",
  url: `https://claude.ai/code/${CLOUD_ID}`,
  repo: "sunbeam/web",
  branch: "claude/setup",
  status: "done",
  statusDetail: null,
  firstUserMessage: null,
  lastMessage: null,
  lastMessageRole: null,
  messageCount: 0,
  startedAt: TWO_HOURS_AGO,
  lastActivityAt: AN_HOUR_AGO,
  raw: { needs_action: null, artifacts: [] },
  ...over,
});

const transcript = (over: Partial<NormalizedSession> = {}): NormalizedSession => ({
  source: "local",
  externalId: TRANSCRIPT,
  title: "One-step setup and live sync",
  url: null,
  repo: "sunbeam-web",
  branch: "claude/setup",
  status: "idle",
  statusDetail: null,
  firstUserMessage: "Make Sunbeam Web install in one step",
  lastMessage: "Done: npm start installs and runs it.",
  lastMessageRole: "assistant",
  messageCount: 6,
  startedAt: TWO_HOURS_AGO,
  lastActivityAt: AN_HOUR_AGO,
  raw: { resume: `claude --resume ${TRANSCRIPT}`, artifacts: [] },
  cloudId: CLOUD_ID,
  ...over,
});

const rows = () => all<SessionRow>("select * from sessions order by source, external_id");

/** A project with a teammate to file sessions under. */
function sunbeamTeammate() {
  const [company] = insert<{ id: string }>("companies", { slug: "sunbeam-co", name: "Sunbeam Co" });
  const [project] = insert<{ id: string }>("projects", { slug: "sunbeam-web", name: "Sunbeam Web", company_id: company.id });
  const [team] = insert<{ id: string }>("teams", { project_id: project.id, name: "Web" });
  const [agent] = insert<{ id: string }>("agents", { team_id: team.id, name: "Maya", role: "Engineer" });
  return { projectId: project.id, teamId: team.id, agentId: agent.id };
}

describe("a terminal session that is also on claude.ai is one session", () => {
  beforeAll(() => {
    process.env.TIMU_TRIAGE_ENGINE = "status";
    useDatabase(openDatabase(":memory:"));
  });
  afterAll(() => {
    delete process.env.TIMU_TRIAGE_ENGINE;
    useDatabase(null);
  });
  beforeEach(() => {
    run("delete from tasks");
    run("delete from artifacts");
    run("delete from sessions");
    run("delete from agents");
    run("delete from teams");
    run("delete from projects");
    run("delete from companies");
  });

  it("folds the transcript into a cloud session Timu already has", async () => {
    await ingestSessions("cloud", [cloud()]);
    await ingestSessions("local", [transcript()]);

    const [only, ...rest] = rows();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ source: "cloud", external_id: CLOUD_ID, local_id: TRANSCRIPT });
    // Both ways to open it: the claude.ai link and the terminal.
    expect(only.url).toBe(`https://claude.ai/code/${CLOUD_ID}`);
    expect(resumeFor(only)).toBe(`claude --resume ${TRANSCRIPT}`);
  });

  it("is found by the transcript's id too (Claude in the terminal knows only that one)", async () => {
    await ingestSessions("cloud", [cloud()]);
    await ingestSessions("local", [transcript()]);
    const [s] = await findSessions([TRANSCRIPT]);
    expect(s).toMatchObject({ source: "cloud", external_id: CLOUD_ID });
  });

  it("changes nothing when an unchanged transcript or cloud session is read again", async () => {
    await ingestSessions("cloud", [cloud()]);
    await ingestSessions("local", [transcript()]);
    const before = writes();
    await ingestSessions("local", [transcript()]);
    await ingestSessions("cloud", [cloud()]);
    expect(writes()).toBe(before);
  });

  it("merges a transcript that arrived first, keeping where you filed it and your notes", async () => {
    const { projectId, agentId, teamId } = sunbeamTeammate();
    await ingestSessions("local", [transcript()]);
    const local = get<SessionRow>("select * from sessions where source = 'local'")!;
    expect(local.cloud_id).toBe(CLOUD_ID);
    update("sessions", { project_id: projectId, team_id: teamId, agent_id: agentId, title: "Setup wizard", title_locked: true }, "id = ?", local.id);
    insert("comments", { entity_type: "session", entity_id: local.id, body: "Ship before the Duckworks demo" });

    await ingestSessions("cloud", [cloud()]);

    const [only, ...rest] = rows();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ source: "cloud", local_id: TRANSCRIPT, project_id: projectId, agent_id: agentId, title: "Setup wizard", title_locked: true });
    expect(all("select body from comments where entity_type = 'session' and entity_id = ?", only.id)).toEqual([{ body: "Ship before the Duckworks demo" }]);
  });

  it("merges the duplicates already in the database once the transcript is read again", async () => {
    // Imported before Timu knew the two were one: a transcript with no cloud link, and the cloud session.
    await ingestSessions("local", [transcript({ cloudId: null })]);
    await ingestSessions("cloud", [cloud()]);
    expect(rows()).toHaveLength(2);
    // You had archived the terminal copy to hide the duplicate.
    run("update sessions set archived = 1 where source = 'local'");

    await ingestSessions("local", [transcript()]);

    const [only, ...rest] = rows();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ source: "cloud", local_id: TRANSCRIPT, archived: false });
  });

  it("keeps the cloud session's filing and open ask, and closes the duplicate ask", async () => {
    const maya = sunbeamTeammate();
    await ingestSessions("local", [transcript({ cloudId: null, status: "needs_you", statusDetail: "Should I publish it?" })]);
    await ingestSessions("cloud", [cloud({ status: "needs_you", statusDetail: "Should I publish it?" })]);
    const c = get<SessionRow>("select * from sessions where source = 'cloud'")!;
    update("sessions", { project_id: maya.projectId, team_id: maya.teamId, agent_id: maya.agentId }, "id = ?", c.id);
    expect(scalar("select count(*) from tasks where status <> 'done'")).toBe(2);

    await ingestSessions("local", [transcript({ status: "needs_you", statusDetail: "Should I publish it?" })]);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ agent_id: maya.agentId });
    // One open ask per session; the duplicate's is closed and kept with the session's history.
    expect(all("select session_id, status from tasks order by status")).toEqual([
      { session_id: c.id, status: "done" },
      { session_id: c.id, status: "open" },
    ]);
  });

  it("files the artifacts the transcript published under the session, and the cloud sync keeps them", async () => {
    const artifact = { id: "a1b2c3", url: "https://claude.ai/artifact/a1b2c3" };
    await ingestSessions("cloud", [cloud()]);
    await ingestSessions("local", [transcript({ raw: { artifacts: [artifact] } })]);
    const c = get<SessionRow>("select * from sessions")!;
    expect(all("select id, session_id from artifacts")).toEqual([{ id: artifact.id, session_id: c.id }]);

    // The cloud session moves on; its record lists no artifacts, the transcript's stay linked.
    await ingestSessions("cloud", [cloud({ status: "working", lastActivityAt: new Date().toISOString() })]);
    expect(all("select id, session_id from artifacts")).toEqual([{ id: artifact.id, session_id: c.id }]);
  });

  it("leaves a fork of the conversation as a session of its own", async () => {
    const FORK = "7d1e0c52-0000-4000-8000-000000000002";
    await ingestSessions("local", [
      transcript({ externalId: FORK, title: "Setup: try pnpm instead", startedAt: AN_HOUR_AGO }),
      transcript(),
    ]);
    await ingestSessions("cloud", [cloud()]);

    expect(rows().map((r) => [r.source, r.external_id, r.local_id])).toEqual([
      ["cloud", CLOUD_ID, TRANSCRIPT],
      ["local", FORK, null],
    ]);
  });

  it("keeps a transcript whose cloud session never arrives as a local session", async () => {
    await ingestSessions("local", [transcript()]);
    await ingestSessions("cloud", [cloud({ externalId: "session_01Other", url: "https://claude.ai/code/session_01Other" })]);
    expect(rows().map((r) => [r.source, r.external_id])).toEqual([
      ["cloud", "session_01Other"],
      ["local", TRANSCRIPT],
    ]);
  });
});
