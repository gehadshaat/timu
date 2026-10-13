import { describe, expect, it } from "vitest";
import { ruleVerdict, statusVerdict, type TriageInput } from "./rules";
import { verdictToDraft } from "../tasks";

const base: TriageInput = {
  id: "s",
  title: "Landing pages",
  source: "cloud",
  status: "done",
  status_detail: null,
  needs_action: null,
  last_message: "x",
  last_message_role: "assistant",
  repo: "acme/web",
};
const now = new Date("2026-10-14T12:00:00Z");

describe("triage rules", () => {
  it("says a merged PR with no follow-ups needs nothing", () => {
    const v = ruleVerdict({ ...base, status_detail: "PR #204 merged; three pages on main" }, now)!;
    expect(v.needed).toBe(false);
    expect(v.engine).toBe("rules");
  });

  it("leaves merged-but-with-follow-up to the model", () => {
    expect(ruleVerdict({ ...base, status_detail: "PR #560 merged; run migration 2026_handoff.sql before handoffs work" }, now)).toBeNull();
    expect(ruleVerdict({ ...base, status_detail: "Merged; checkout untested" }, now)).toBeNull();
  });

  it("never interrupts a session that is still working (unless it asked)", () => {
    expect(ruleVerdict({ ...base, status: "working" }, now)!.needed).toBe(false);
    expect(ruleVerdict({ ...base, status: "working", needs_action: "Which tone?" }, now)).toBeNull();
  });

  it("ignores sessions idle for longer than the stale threshold, and can be turned off", () => {
    const old = { ...base, status: "needs_you", needs_action: "Approve?", last_activity_at: "2026-08-01T00:00:00Z" };
    const v = ruleVerdict(old, now, 30)!;
    expect(v.needed).toBe(false);
    expect(v.reason).toMatch(/Idle for \d+ days/);
    expect(ruleVerdict(old, now, 0)).toBeNull();
    expect(ruleVerdict({ ...old, last_activity_at: "2026-10-10T00:00:00Z" }, now, 30)).toBeNull();
  });

  it("falls back to the session's own status when no model is available", () => {
    expect(statusVerdict({ ...base, status: "needs_you", needs_action: "Approve tags" }, now)).toMatchObject({ needed: true, kind: "respond", ask: "Approve tags" });
    expect(statusVerdict({ ...base, status: "failed" }, now).kind).toBe("unblock");
    expect(statusVerdict({ ...base, status: "done" }, now).needed).toBe(false);
  });
});

describe("verdict → task", () => {
  const s = { title: "Supplier emails", statusDetail: "Which tone?", lastMessage: null };
  const v = { needed: true, kind: "decide" as const, confidence: 0.9, engine: "claude" as const, reason: "", at: "" };

  it("uses a crisp ask as the title", () => {
    expect(verdictToDraft({ ...v, ask: "Pick formal or friendly tone" }, s)).toMatchObject({ kind: "decide", title: "Pick formal or friendly tone" });
  });
  it("falls back to a prefixed session title for long or missing asks", () => {
    expect(verdictToDraft({ ...v, ask: "x".repeat(200) }, s)!.title).toBe("Decide: Supplier emails");
    expect(verdictToDraft({ ...v, ask: null }, s)!.title).toBe("Decide: Supplier emails");
  });
  it("returns nothing when not needed", () => {
    expect(verdictToDraft({ ...v, needed: false, kind: "none" }, s)).toBeNull();
  });
});
