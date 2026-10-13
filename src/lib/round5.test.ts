import { describe, expect, it } from "vitest";
import { parseDue, parseLines, parsePersonLine, parseQuickAdd, parseQuickAddLine } from "./quickadd";
import { computeSignals, departmentKey, groupDepartments, isBigCompany, sumSignals, SPARK_DAYS } from "./signals";
import { nextSelection, pruneSelection } from "./selection";
import { rankSearch, scoreMatch, type Searchable } from "./search";

// Tuesday 13 Oct 2026, local time
const today = new Date(2026, 9, 13, 10, 0);
const ctx = {
  agents: [
    { id: "a1", name: "Maya" },
    { id: "a2", name: "Mateo" },
    { id: "a3", name: "Omar" },
  ],
  projects: [
    { id: "p1", name: "Sunbeam Web", slug: "sunbeam-web" },
    { id: "p2", name: "Sunbeam Device", slug: "sunbeam-device" },
    { id: "p3", name: "Procurement App", slug: "procurement-app" },
  ],
};

describe("quick add", () => {
  it("parses assignee, project, priority and due date out of the title", () => {
    expect(parseQuickAddLine("Write FAQ @Maya #sunbeam-web !high due:fri", ctx, today)).toEqual({
      title: "Write FAQ",
      agentId: "a1",
      projectId: "p1",
      priority: "high",
      dueDate: "2026-10-16",
      unknown: [],
    });
  });

  it("accepts unambiguous prefixes and @me, and keeps unknown tokens in the title", () => {
    expect(parseQuickAddLine("Call supplier @om #procure", ctx, today)).toMatchObject({ agentId: "a3", projectId: "p3" });
    expect(parseQuickAddLine("Book flights @me", ctx, today)).toMatchObject({ title: "Book flights", agentId: null });
    // "@Ma" matches Maya and Mateo; "#sunbeam" matches two projects → both stay in the title.
    const x = parseQuickAddLine("Plan @Ma #sunbeam", ctx, today)!;
    expect(x.title).toBe("Plan @Ma #sunbeam");
    expect(x.unknown).toEqual(["@Ma", "#sunbeam"]);
    expect(x.agentId).toBeUndefined();
  });

  it("strips bullets, skips blank lines and handles low priority and bang shortcuts", () => {
    const items = parseQuickAdd("- [ ] First !\n\n2. Second !low\n* Third", ctx, today);
    expect(items.map((i) => [i.title, i.priority])).toEqual([
      ["First", "high"],
      ["Second", "low"],
      ["Third", undefined],
    ]);
  });

  it("understands due dates", () => {
    expect(parseDue("today", today)).toBe("2026-10-13");
    expect(parseDue("tomorrow", today)).toBe("2026-10-14");
    expect(parseDue("tue", today)).toBe("2026-10-13");
    expect(parseDue("monday", today)).toBe("2026-10-19");
    expect(parseDue("nextweek", today)).toBe("2026-10-19");
    expect(parseDue("+3d", today)).toBe("2026-10-16");
    expect(parseDue("+2w", today)).toBe("2026-10-27");
    expect(parseDue("2026-11-01", today)).toBe("2026-11-01");
    expect(parseDue("11/1", today)).toBe("2026-11-01");
    expect(parseDue("1/5", today)).toBe("2027-01-05");
    expect(parseDue("someday", today)).toBeNull();
  });

  it("parses plain lists and 'Name — Role' lines", () => {
    expect(parseLines("- Copy approved\n- Copy approved\n\n* Pages deployed")).toEqual(["Copy approved", "Pages deployed"]);
    expect(parsePersonLine("Noor — Marketing Manager")).toEqual({ name: "Noor", role: "Marketing Manager" });
    expect(parsePersonLine("Sam: QA")).toEqual({ name: "Sam", role: "QA" });
    expect(parsePersonLine("Lone")).toEqual({ name: "Lone", role: "Teammate" });
  });
});

describe("signals", () => {
  const now = new Date(2026, 9, 13, 12, 0).getTime();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

  it("counts asks, stuck, working and shipped, and builds a 14-day sparkline", () => {
    const s = computeSignals(
      {
        sessions: [
          { status: "working", last_activity_at: hoursAgo(1), started_at: hoursAgo(30) },
          { status: "failed", last_activity_at: hoursAgo(5), started_at: hoursAgo(5) },
          { status: "done", last_activity_at: hoursAgo(48), started_at: hoursAgo(50) },
          { status: "done", last_activity_at: hoursAgo(24 * 20), started_at: null },
        ],
        asks: 2,
        goals: [
          { status: "active", progress: 0.5 },
          { status: "active", progress: 1 },
          { status: "achieved", progress: 1 },
        ],
        people: 3,
      },
      now,
    );
    expect(s).toMatchObject({ sessions: 4, asks: 2, stuck: 1, working: 1, shipped7d: 1, goals: 2, goalProgress: 0.75, people: 3, health: "stuck" });
    expect(s.spark).toHaveLength(SPARK_DAYS);
    expect(s.spark[SPARK_DAYS - 1]).toBe(2); // today: the working session and the failed one
    // working: today + yesterday; failed: today; done: one day (started and finished the same day);
    // the 20-day-old session is outside the window.
    expect(s.spark.reduce((a, b) => a + b, 0)).toBe(4);
    expect(s.lastActive).toBe(hoursAgo(1));
  });

  it("derives health from the most urgent signal", () => {
    const base = { sessions: [{ status: "idle", last_activity_at: hoursAgo(24 * 5), started_at: null }], asks: 0 };
    expect(computeSignals(base, now).health).toBe("quiet");
    expect(computeSignals({ ...base, asks: 1 }, now).health).toBe("needs_you");
    expect(computeSignals({ sessions: [{ status: "idle", last_activity_at: hoursAgo(24 * 40), started_at: null }], asks: 0 }, now).health).toBe("dormant");
    expect(computeSignals({ sessions: [], asks: 0 }, now).health).toBe("empty");
    // An old failure doesn't make a project look stuck forever.
    expect(computeSignals({ sessions: [{ status: "failed", last_activity_at: hoursAgo(24 * 45), started_at: null }], asks: 0 }, now).health).toBe("dormant");
  });

  it("rolls signals up", () => {
    const a = computeSignals({ sessions: [{ status: "working", last_activity_at: hoursAgo(1), started_at: null }], asks: 1, goals: [{ status: "active", progress: 0.2 }] }, now);
    const b = computeSignals({ sessions: [{ status: "done", last_activity_at: hoursAgo(3), started_at: null }], asks: 0, goals: [{ status: "active", progress: 0.6 }] }, now);
    const sum = sumSignals([a, b], now);
    expect(sum).toMatchObject({ sessions: 2, asks: 1, working: 1, shipped7d: 1, goals: 2, health: "needs_you" });
    expect(sum.goalProgress).toBeCloseTo(0.4);
  });
});

describe("departments", () => {
  it("groups the same kind of team across projects", () => {
    expect(departmentKey("Marketing Team")).toBe("marketing");
    expect(departmentKey("R&D")).toBe("r and d");
    const deps = groupDepartments([
      { id: "t1", name: "Marketing", project_id: "p1" },
      { id: "t2", name: "Marketing Team", project_id: "p2" },
      { id: "t3", name: "Hardware", project_id: "p2" },
    ]);
    expect(deps.map((d) => [d.name, d.teams.length, d.projectIds.length])).toEqual([
      ["Marketing", 2, 2],
      ["Hardware", 1, 1],
    ]);
    expect(isBigCompany(3, 1)).toBe(true);
    expect(isBigCompany(2, 4)).toBe(false);
  });
});

describe("selection", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("toggles, and shift-click selects a range from the anchor", () => {
    let s = nextSelection(new Set(), order, "b");
    expect([...s.selected]).toEqual(["b"]);
    s = nextSelection(s.selected, order, "d", { shift: true, anchor: s.anchor });
    expect([...s.selected].sort()).toEqual(["b", "c", "d"]);
    // shift-click on a selected item clears the range back to the anchor
    s = nextSelection(s.selected, order, "c", { shift: true, anchor: "d" });
    expect([...s.selected]).toEqual(["b"]);
    expect([...pruneSelection(new Set(["a", "z"]), order)]).toEqual(["a"]);
  });
});

describe("search", () => {
  const items: Searchable[] = [
    { kind: "session", id: "s1", label: "Sunbeam landing pages", href: "/s/1" },
    { kind: "project", id: "p1", label: "Sunbeam Web", href: "/p/1" },
    { kind: "company", id: "c1", label: "Sunbeam Co", href: "/c/1" },
    { kind: "person", id: "a1", label: "Maya", sublabel: "SEO Lead", href: "/a/1" },
  ];
  it("ranks better matches and more structural kinds first", () => {
    expect(rankSearch("sunbeam", items).map((i) => i.id)).toEqual(["c1", "p1", "s1"]);
    expect(rankSearch("seo", items).map((i) => i.id)).toEqual(["a1"]);
    expect(scoreMatch("web", items[1])).toBeGreaterThan(0);
    expect(rankSearch("", items)).toEqual([]);
  });
});
