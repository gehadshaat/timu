import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyUndo, bulkSessions } from "./bulk";
import { all, get, insert, openDatabase, useDatabase } from "./db";

beforeAll(() => useDatabase(openDatabase(":memory:")));
afterAll(() => useDatabase(null));

const session = (title: string) =>
  insert<{ id: string }>("sessions", { source: "local", external_id: title, title, status: "idle" })[0].id;
const openAsks = (id: string) => all<{ id: string }>("select id from tasks where session_id = ? and status <> 'done'", id);
const override = (id: string) => get<{ status_override: string | null }>("select status_override from sessions where id = ?", id)!.status_override;

describe("setting a session's status from a board", () => {
  it("flags an idle session as needing you, and undo takes it back", async () => {
    const id = session("Idle one");
    const r = await bulkSessions([id], { type: "status", status: "needs_you" });
    expect(r.ok).toBe(true);
    expect(openAsks(id)).toHaveLength(1);
    expect(override(id)).toBe("needs_you");

    await applyUndo(r.undo!);
    expect(openAsks(id)).toHaveLength(0);
    expect(override(id)).toBeNull();
  });

  it("doesn't raise a second ask when one is already open", async () => {
    const id = session("Already asking");
    insert("tasks", { session_id: id, kind: "review", title: "Review it" });
    await bulkSessions([id], { type: "status", status: "needs_you" });
    expect(openAsks(id)).toHaveLength(1);
  });

  it("marking done closes its ask; going back to Claude's status clears the override", async () => {
    const id = session("Finished");
    await bulkSessions([id], { type: "status", status: "needs_you" });
    const r = await bulkSessions([id], { type: "status", status: "done" });
    expect(openAsks(id)).toHaveLength(0);
    expect(override(id)).toBe("done");

    await bulkSessions([id], { type: "status", status: null });
    expect(override(id)).toBeNull();

    // Undoing "done" reopens the ask it closed.
    await applyUndo(r.undo!);
    expect(openAsks(id)).toHaveLength(1);
    expect(override(id)).toBe("needs_you");
  });
});
