import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, insert, openDatabase, useDatabase } from "./db";
import { getRoutines, saveRoutines } from "./routines";
import { cronToText, extractRoutineRecords, mapRoutine, sessionExternalId } from "./sources/routines";

const daily = {
  id: "trig_daily",
  name: "Sunbeam: daily SEO",
  created_kind: "routine",
  enabled: true,
  cron_expression: "CRON_TZ=America/New_York 59 8 * * *",
  next_run_at: "2999-01-01T12:59:00Z",
  last_fired_at: "2026-10-13T12:59:00Z",
  derived_state: { prompt: "Daily SEO job" },
  last_run: { status: "ROUTINE_RUN_STATUS_SUCCEEDED", session_id: "cse_01RUN" },
};
const checkin = {
  id: "trig_checkin",
  name: "Re-check PR #40",
  created_kind: "reminder",
  enabled: true,
  run_once_at: "2999-01-01T00:00:00Z",
  next_run_at: "2999-01-01T00:00:00Z",
  persistent_session_id: "session_01HOME",
};
const fired = { ...checkin, id: "trig_fired", enabled: false, ended_reason: "run_once_fired", next_run_at: "2999-01-02T00:00:00Z" };

describe("routines from the API", () => {
  it("maps kinds, statuses and session ids", () => {
    const r = mapRoutine(daily);
    expect(r).toMatchObject({ kind: "routine", enabled: true, last_run_status: "succeeded", last_run_session: "session_01RUN", prompt: "Daily SEO job" });
    expect(mapRoutine(checkin)).toMatchObject({ kind: "reminder", home_session: "session_01HOME" });
    // A fired run-once routine reports a next run a day later; that's not a real next run.
    expect(mapRoutine(fired).next_run_at).toBeNull();
    expect(sessionExternalId("cse_01ABC")).toBe("session_01ABC");
    expect(sessionExternalId("session_01ABC")).toBe("session_01ABC");
  });

  it("reads an API page, a bare array, or the tool's 'HTTP 200' text", () => {
    expect(extractRoutineRecords({ data: [daily, checkin] })).toHaveLength(2);
    expect(extractRoutineRecords([daily, { id: "session_x" }])).toHaveLength(1);
    expect(extractRoutineRecords(`HTTP 200\n${JSON.stringify({ data: [daily] })}`)).toHaveLength(1);
    expect(extractRoutineRecords("not json")).toEqual([]);
  });

  it("puts common cron schedules into words", () => {
    expect(cronToText("CRON_TZ=America/New_York 54 8 * * *")).toBe("Daily 8:54 · New York");
    expect(cronToText("0 9 * * 1-5")).toBe("Weekdays 9:00");
    expect(cronToText("CRON_TZ=Asia/Riyadh 45 8 * * 0-4")).toBe("Sun–Thu 8:45 · Riyadh");
    expect(cronToText("30 10 * * 1")).toBe("Mondays 10:30");
    expect(cronToText("55 13 * * 0,3")).toBe("Sundays, Wednesdays 13:55");
    expect(cronToText("*/15 * * * *")).toBe("Every 15 min");
    expect(cronToText("5 * * * *")).toBe("Hourly at :05");
    expect(cronToText("0 7 1 * *")).toBe("Monthly on the 1st 7:00");
    expect(cronToText("0 7 1 1 *")).toBe("0 7 1 1 *");
  });
});

describe("stored routines", () => {
  beforeAll(() => useDatabase(openDatabase(":memory:")));
  afterAll(() => useDatabase(null));

  it("upserts by id and files each routine under its session's teammate and project", () => {
    expect(saveRoutines({ data: [daily, checkin, fired] })).toEqual({ imported: 3, updated: 0 });
    expect(saveRoutines({ data: [daily] })).toEqual({ imported: 0, updated: 0 }); // unchanged: nothing written
    expect(saveRoutines({ data: [{ ...daily, last_fired_at: "2026-10-14T12:59:00Z" }] })).toEqual({ imported: 0, updated: 1 });
    expect(all("select id from routines")).toHaveLength(3);

    const [company] = insert<{ id: string }>("companies", { slug: "acme", name: "Acme" });
    const [project] = insert<{ id: string }>("projects", { slug: "web", name: "Web", company_id: company.id });
    const [team] = insert<{ id: string }>("teams", { project_id: project.id, name: "Growth" });
    const [agent] = insert<{ id: string }>("agents", { team_id: team.id, name: "Maya", role: "SEO" });
    insert("sessions", { source: "cloud", external_id: "session_01HOME", title: "PR #40", agent_id: agent.id, team_id: team.id, project_id: project.id });

    const org = {
      companies: [],
      projects: [{ id: project.id, name: "Web", slug: "web" }],
      teams: [],
      agents: [{ id: agent.id, name: "Maya" }],
      goals: [],
    } as unknown as Parameters<typeof getRoutines>[0];
    const views = getRoutines(org);
    const byId = Object.fromEntries(views.map((v) => [v.routine.id, v]));
    expect(byId.trig_checkin).toMatchObject({ state: "scheduled", schedule: "Once" });
    expect(byId.trig_checkin.agent?.name).toBe("Maya");
    expect(byId.trig_checkin.session?.title).toBe("PR #40");
    expect(byId.trig_fired.state).toBe("done");
    expect(byId.trig_daily).toMatchObject({ state: "scheduled", schedule: "Daily 8:59 · New York", agent: null });
    expect(getRoutines(org, { projectId: project.id }).map((v) => v.routine.id).sort()).toEqual(["trig_checkin", "trig_fired"]);
  });
});
