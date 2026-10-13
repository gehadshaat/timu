import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { all, get, getSetting, insert, openDatabase, run, scalar, setSetting, update, useDatabase } from "./db";

beforeAll(() => useDatabase(openDatabase(":memory:")));
afterAll(() => useDatabase(null));

describe("sqlite db", () => {
  it("round-trips json and booleans, generates uuids and timestamps", () => {
    const [c] = insert<{ id: string; created_at: string }>("companies", { slug: "acme", name: "Acme" });
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.created_at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    const [p] = insert<{ id: string }>("projects", { slug: "p", name: "P", company_id: c.id });
    const [t] = insert<{ id: string }>("teams", { project_id: p.id, name: "T" });
    const [a] = insert<{ avatar: { seed: number } }>("agents", { team_id: t.id, name: "Noor", role: "PM", avatar: { seed: 3 } });
    expect(a.avatar).toEqual({ seed: 3 });
    const [s] = insert<{ id: string; archived: boolean }>("sessions", { source: "local", external_id: "x", raw: {} });
    expect(s.archived).toBe(false);
    update("sessions", { archived: true }, "id = ?", s.id);
    expect(get<{ archived: boolean }>("select archived from sessions where id = ?", s.id)?.archived).toBe(true);
    expect(all("select id from sessions where id in (select value from json_each(?))", [s.id])).toHaveLength(1);
  });

  it("upserts and cascades, and cleans up comments", () => {
    const p = get<{ id: string }>("select id from projects where slug = 'p'")!;
    expect(insert("teams", { project_id: p.id, name: "T" }, { on: "project_id, name", do: "nothing" })).toHaveLength(0);
    insert("comments", { entity_type: "project", entity_id: p.id, body: "hi" });
    run("delete from projects where id = ?", p.id);
    expect(scalar("select count(*) from teams")).toBe(0);
    expect(scalar("select count(*) from comments")).toBe(0);
  });

  it("stores settings as json", () => {
    setSetting("k", [1, 2]);
    setSetting("k", { a: 1 });
    expect(getSetting("k")).toEqual({ a: 1 });
    expect(getSetting("missing")).toBeNull();
  });
});
