export type SessionSource = "cloud" | "local" | "claude_ai";

export type SessionStatus = "working" | "needs_you" | "review" | "idle" | "done" | "failed";

export type TaskKind = "respond" | "review" | "decide" | "unblock" | "run" | "todo";
export type Priority = "low" | "normal" | "high";
export type TaskStatus = "open" | "snoozed" | "done";

/** What every importer produces, before it is stored. */
export interface NormalizedSession {
  source: SessionSource;
  externalId: string;
  title: string;
  url: string | null;
  repo: string | null;
  branch: string | null;
  status: SessionStatus;
  statusDetail: string | null;
  firstUserMessage: string | null;
  lastMessage: string | null;
  lastMessageRole: "user" | "assistant" | null;
  messageCount: number;
  startedAt: string | null;
  lastActivityAt: string | null;
  raw: Record<string, unknown>;
  /** Local transcripts only: the claude.ai/code session (session_…) it mirrors (Remote Control, teleport). */
  cloudId?: string | null;
}

export interface AvatarSpec {
  seed: string;
  prop?: PropKind;
  skin?: number;
  hair?: number;
  hairColor?: number;
  outfit?: number;
  glasses?: boolean;
}

export type PropKind =
  | "magnifier"
  | "laptop"
  | "megaphone"
  | "palette"
  | "chart"
  | "calculator"
  | "wrench"
  | "headset"
  | "chip"
  | "notepad"
  | "phone"
  | "box"
  | "camera"
  | "stethoscope"
  | "map"
  | "bag"
  | "code"
  | "mug";

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  created_at: string;
}

/** Triage decision on whether a session genuinely needs the user. */
export interface Verdict {
  needed: boolean;
  kind: TaskKind | "none";
  /** 0..1 */
  confidence: number;
  engine: "rules" | "typesafe" | "claude" | "status" | "you";
  reason: string;
  ask?: string | null;
  at: string;
}

export interface ProjectRow {
  id: string;
  company_id: string | null;
  slug: string;
  name: string;
  description: string;
  emoji: string;
  color: string;
  theme: string;
  created_at: string;
}

export interface TeamRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  color: string;
}

export interface AgentRow {
  id: string;
  team_id: string;
  name: string;
  role: string;
  created_at?: string;
  persona: string;
  avatar: AvatarSpec;
}

export interface GoalRow {
  id: string;
  project_id: string;
  team_id: string | null;
  title: string;
  description: string;
  status: "active" | "achieved" | "dropped";
  due_date: string | null;
  priority: Priority;
  achieved_at: string | null;
  created_at: string;
}

export interface MilestoneRow {
  id: string;
  goal_id: string;
  title: string;
  done: boolean;
  done_at: string | null;
  position: number;
}

export interface SessionRow {
  id: string;
  source: SessionSource;
  external_id: string;
  title: string;
  url: string | null;
  repo: string | null;
  branch: string | null;
  status: SessionStatus;
  status_detail: string | null;
  first_user_message: string | null;
  last_message: string | null;
  last_message_role: "user" | "assistant" | null;
  message_count: number;
  started_at: string | null;
  last_activity_at: string | null;
  project_id: string | null;
  team_id: string | null;
  agent_id: string | null;
  goal_id: string | null;
  summary: string | null;
  classified_at: string | null;
  archived: boolean;
  title_locked: boolean;
  triage: Verdict | null;
  /** New activity waiting to be judged once the session has been quiet until then (see judgeOrDefer). */
  triage_due_at?: string | null;
  /** The status you set from a board; wins over `status` until the session has new activity. */
  status_override: SessionStatus | null;
  /** The Claude account it came from ("claude", "claude-work"…); accounts share one org. */
  account?: string | null;
  /** On a local row: the claude.ai/code session it mirrors, until that session is imported and absorbs it. */
  cloud_id?: string | null;
  /** On a cloud row: the local transcript folded into it, so it can also be resumed in the terminal. */
  local_id?: string | null;
  /** How many artifacts it made (list queries only). */
  artifact_count?: number;
}

export interface TaskRow {
  id: string;
  session_id: string | null;
  origin: "status" | "classifier" | "manual";
  agent_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  due_date: string | null;
  priority: Priority;
  kind: TaskKind;
  title: string;
  detail: string;
  status: TaskStatus;
  snoozed_until: string | null;
  raised_at: string;
  resolved_at: string | null;
  created_at: string;
  judge: Verdict | null;
}
