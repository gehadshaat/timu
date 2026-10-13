import { describe, expect, it } from "vitest";
import { proposeHeuristically } from "./heuristic";
import { mergeProposals, repairProposal, type Proposal, type SessionDigest } from "./schema";
import { deriveTask } from "../tasks";
import { poseFor, traitsFor } from "../avatar";

const digest = (over: Partial<SessionDigest>): SessionDigest => ({
  id: "s1",
  source: "cloud",
  title: "Untitled",
  repo: null,
  workspace: null,
  status: "idle",
  status_detail: null,
  first_user_message: null,
  last_message: null,
  last_message_role: null,
  last_activity_at: null,
  ...over,
});

describe("heuristic organiser", () => {
  const p = proposeHeuristically([
    digest({ id: "a", title: "SEO meta tags", repo: "acme/web", status: "needs_you", status_detail: "Approve tags" }),
    digest({ id: "b", title: "PCB power regulator", repo: "acme/device" }),
    digest({ id: "c", title: "Refactor auth", repo: "acme/web" }),
    digest({ id: "d", title: "Trip packing list", source: "claude_ai", status: "needs_you", status_detail: "Long message…" }),
  ]);

  it("makes a project per repo under the org's company, and chats go to Personal", () => {
    expect(p.projects.map((x) => x.name).sort()).toEqual(["Device", "Personal", "Web"]);
    expect(p.projects.find((x) => x.name === "Web")!.company).toBe("Acme");
    expect(p.projects.find((x) => x.name === "Personal")!.company).toBeNull();
  });

  it("picks teams and roles from keywords", () => {
    const web = p.projects.find((x) => x.name === "Web")!;
    expect(web.teams.map((t) => t.name).sort()).toEqual(["Engineering", "Marketing"]);
    expect(web.teams.find((t) => t.name === "Marketing")!.members[0].prop).toBe("magnifier");
    expect(p.projects.find((x) => x.name === "Device")!.teams[0].name).toBe("Hardware");
  });

  it("assigns every session and flags attention", () => {
    expect(p.assignments).toHaveLength(4);
    const a = p.assignments.find((x) => x.session_id === "a")!;
    expect(a.attention).toBe("respond");
    expect(a.ask).toBe("Approve tags");
    expect(p.assignments.find((x) => x.session_id === "d")!.ask).toBeNull();
    expect(p.assignments.find((x) => x.session_id === "c")!.attention).toBe("none");
  });

  it("never reuses a first name", () => {
    const names = p.projects.flatMap((x) => x.teams.flatMap((t) => t.members.map((m) => m.name)));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("proposal helpers", () => {
  const base: Proposal = {
    projects: [{ key: "p", name: "P", company: null, description: "", emoji: "x", goals: [], teams: [{ key: "t", name: "T", description: "", members: [{ key: "m", name: "M", role: "R", persona: "", prop: "mug" }] }] }],
    assignments: [{ session_id: "1", project_key: "p", team_key: "t", member_key: "m", goal_key: null, summary: "", attention: "none", ask: null }],
  };

  it("merges new members and replaces assignments by session", () => {
    const next: Proposal = {
      projects: [{ ...base.projects[0], teams: [{ ...base.projects[0].teams[0], members: [{ key: "m2", name: "N", role: "R", persona: "", prop: "laptop" }] }] }],
      assignments: [{ ...base.assignments[0], member_key: "m2" }],
    };
    const merged = mergeProposals(base, next);
    expect(merged.projects[0].teams[0].members.map((m) => m.key)).toEqual(["m", "m2"]);
    expect(merged.assignments).toHaveLength(1);
    expect(merged.assignments[0].member_key).toBe("m2");
  });

  it("repairs dangling keys", () => {
    const broken = { ...base, assignments: [{ ...base.assignments[0], member_key: "ghost", goal_key: "nope" }, { ...base.assignments[0], session_id: "2", project_key: "missing" }] };
    const fixed = repairProposal(broken);
    expect(fixed.assignments).toHaveLength(1);
    expect(fixed.assignments[0].member_key).toBe("m");
    expect(fixed.assignments[0].goal_key).toBeNull();
  });
});

describe("tasks and avatars", () => {
  it("derives a task only when the user is needed", () => {
    expect(deriveTask({ status: "needs_you", title: "X", statusDetail: "Q?", lastMessage: null })).toMatchObject({ kind: "respond", detail: "Q?" });
    expect(deriveTask({ status: "review", title: "X", statusDetail: null, lastMessage: "PR ready" })!.kind).toBe("review");
    expect(deriveTask({ status: "failed", title: "X", statusDetail: null, lastMessage: null })!.kind).toBe("unblock");
    expect(deriveTask({ status: "working", title: "X", statusDetail: null, lastMessage: null })).toBeNull();
  });

  it("is deterministic per seed", () => {
    expect(traitsFor({ seed: "Maya:SEO" })).toEqual(traitsFor({ seed: "Maya:SEO" }));
    expect(traitsFor({ seed: "Maya:SEO", prop: "chip" }).prop).toBe("chip");
  });

  it("chooses the most urgent pose", () => {
    expect(poseFor({ openTaskKinds: ["review", "unblock"], working: true, recentlyDone: false })).toBe("failed");
    expect(poseFor({ openTaskKinds: ["review"], working: true, recentlyDone: false })).toBe("review");
    expect(poseFor({ openTaskKinds: [], working: true, recentlyDone: true })).toBe("working");
    expect(poseFor({ openTaskKinds: [], working: false, recentlyDone: false })).toBe("idle");
  });
});
