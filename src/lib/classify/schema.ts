import { z } from "zod";

export const PROP_KINDS = [
  "magnifier", "laptop", "megaphone", "palette", "chart", "calculator",
  "wrench", "headset", "chip", "notepad", "phone", "box", "camera",
  "stethoscope", "map", "bag", "code", "mug",
] as const;

export const ATTENTION = ["none", "respond", "review", "decide", "unblock"] as const;

/**
 * Keys are short stable handles the model invents ("sunbeam-web", "seo-manager").
 * When classifying against an existing org, existing entities are passed with
 * their database id as the key, and apply() reuses them.
 */
export const MemberSchema = z.object({
  key: z.string(),
  name: z.string().describe("A friendly first name for this team member, e.g. 'Maya'"),
  role: z.string().describe("Job title, e.g. 'SEO Manager'"),
  persona: z.string().describe("One sentence: what this member owns"),
  prop: z.enum(PROP_KINDS).describe("Object the cartoon character holds, matching the role"),
});

export const TeamSchema = z.object({
  key: z.string(),
  name: z.string().describe("Department-style name, e.g. 'Marketing', 'Web Engineering'"),
  description: z.string(),
  members: z.array(MemberSchema),
});

export const GoalSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  team_key: z.string().nullable(),
});

export const ProjectSchema = z.object({
  key: z.string(),
  name: z.string(),
  company: z.string().nullable().describe("The company or organisation this project belongs to, e.g. 'Sunbeam Co'; null for personal work"),
  description: z.string(),
  emoji: z.string(),
  teams: z.array(TeamSchema),
  goals: z.array(GoalSchema),
});

export const AssignmentSchema = z.object({
  session_id: z.string(),
  project_key: z.string(),
  team_key: z.string(),
  member_key: z.string(),
  goal_key: z.string().nullable(),
  summary: z.string().describe("One line: what this session is doing"),
  attention: z.enum(ATTENTION).describe("Does the user need to act on this session now?"),
  ask: z.string().nullable().describe("When attention != none: the specific thing the user must do, as a short imperative"),
});

export const ProposalSchema = z.object({
  projects: z.array(ProjectSchema),
  assignments: z.array(AssignmentSchema),
});

export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalProject = z.infer<typeof ProjectSchema>;
export type ProposalAssignment = z.infer<typeof AssignmentSchema>;
export type PropKindName = (typeof PROP_KINDS)[number];

/** Compact view of a session sent to the classifier. */
export interface SessionDigest {
  id: string;
  source: string;
  title: string;
  repo: string | null;
  workspace: string | null;
  status: string;
  status_detail: string | null;
  first_user_message: string | null;
  last_message: string | null;
  last_message_role: string | null;
  last_activity_at: string | null;
  /** Set on incremental runs: the member that already owns this session. */
  current_member_key?: string | null;
}

/** Merge a batch result into the running proposal (later batches may extend the tree). */
export function mergeProposals(base: Proposal, next: Proposal): Proposal {
  const projects = base.projects.map((p) => structuredClone(p));
  for (const np of next.projects) {
    const p = projects.find((x) => x.key === np.key);
    if (!p) {
      projects.push(np);
      continue;
    }
    for (const nt of np.teams) {
      const t = p.teams.find((x) => x.key === nt.key);
      if (!t) p.teams.push(nt);
      else for (const nm of nt.members) if (!t.members.some((m) => m.key === nm.key)) t.members.push(nm);
    }
    for (const ng of np.goals) if (!p.goals.some((g) => g.key === ng.key)) p.goals.push(ng);
  }
  const assignments = [...base.assignments];
  for (const a of next.assignments) {
    const i = assignments.findIndex((x) => x.session_id === a.session_id);
    if (i >= 0) assignments[i] = a;
    else assignments.push(a);
  }
  return { projects, assignments };
}

/** Drop assignments that point at keys the tree doesn't contain, and fill obvious gaps. */
export function repairProposal(p: Proposal): Proposal {
  const assignments = p.assignments.flatMap((a) => {
    const project = p.projects.find((x) => x.key === a.project_key);
    if (!project) return [];
    const team = project.teams.find((t) => t.key === a.team_key) ?? project.teams[0];
    if (!team) return [];
    const member = team.members.find((m) => m.key === a.member_key) ?? team.members[0];
    if (!member) return [];
    const goal = project.goals.find((g) => g.key === a.goal_key);
    return [{ ...a, team_key: team.key, member_key: member.key, goal_key: goal ? goal.key : null }];
  });
  return { projects: p.projects, assignments };
}
