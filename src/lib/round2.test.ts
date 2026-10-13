import { describe, expect, it } from "vitest";
import { busyPoseFor, isBusy } from "./avatar";
import { proposeHeuristically } from "./classify/heuristic";
import { PROP_KINDS } from "./classify/schema";
import { dueLabel, headline } from "./format";
import { goalProgress } from "./progress";
import { THEMES, themeById, themeForSlug } from "./themes";

describe("poses", () => {
  it("varies busy poses deterministically and only among busy ones", () => {
    expect(busyPoseFor("a:1")).toBe(busyPoseFor("a:1"));
    const seen = new Set(Array.from({ length: 60 }, (_, i) => busyPoseFor(`seed-${i}`)));
    for (const p of seen) expect(isBusy(p)).toBe(true);
    expect(seen.size).toBeGreaterThan(2);
    expect(isBusy("idle")).toBe(false);
  });
});

describe("themes", () => {
  it("assigns a known theme per slug and falls back for unknown ids", () => {
    expect(THEMES.map((t) => t.id)).toContain(themeForSlug("sunbeam-co"));
    expect(themeById("nope").id).toBe("sunny");
    expect(themeById("night").dark).toBe(true);
  });
});

describe("goal progress", () => {
  it("counts milestones, done sessions and done to-dos", () => {
    expect(goalProgress([], [], [])).toBe(0);
    expect(goalProgress([{ done: true }, { done: false }], [{ status: "done" }, { status: "working" }], [{ status: "open" }, { status: "done" }])).toBe(0.5);
  });
});

describe("due labels", () => {
  const now = new Date(2026, 9, 12, 15, 0);
  it("describes overdue, today, tomorrow and later", () => {
    expect(dueLabel(null, now)).toBeNull();
    expect(dueLabel("2026-10-10", now)!.text).toBe("2d overdue");
    expect(dueLabel("2026-10-12", now)!.text).toBe("today");
    expect(dueLabel("2026-10-13", now)!.text).toBe("tomorrow");
    expect(dueLabel("2026-10-20", now)!.tone).toContain("zinc");
  });
});

describe("digest headline", () => {
  it("summarises what happened, or says it was quiet", () => {
    expect(headline({ newAsks: [1, 2], shipped: [1], stuck: [], goalsAchieved: [1] })).toBe("1 goal achieved 🏆 · 1 session shipped · 2 new asks for you");
    expect(headline({ newAsks: [], shipped: [], stuck: [], goalsAchieved: [] })).toMatch(/quiet/);
  });
});

describe("new roles", () => {
  it("maps new disciplines to the new props", () => {
    const p = proposeHeuristically([
      { id: "a", source: "claude_ai", title: "Weekend hike packing list", repo: null, workspace: null, status: "idle", status_detail: null, first_user_message: null, last_message: null, last_message_role: null, last_activity_at: null },
      { id: "b", source: "cloud", title: "Shopify checkout bug", repo: "acme/store", workspace: null, status: "idle", status_detail: null, first_user_message: null, last_message: null, last_message_role: null, last_activity_at: null },
    ]);
    const props = p.projects.flatMap((x) => x.teams.flatMap((t) => t.members.map((m) => m.prop)));
    expect(props).toEqual(expect.arrayContaining(["map", "bag"]));
    for (const prop of props) expect(PROP_KINDS).toContain(prop);
  });
});
