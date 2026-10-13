import { resumeFor } from "./links";
import type { InboxItem, Org } from "./queries";
import type { AvatarSpec, SessionSource, SessionStatus, TaskKind } from "./types";

/** What the client needs to show one ask — kept lean so hundreds of them stay light. */
export interface AskView {
  id: string;
  kind: TaskKind;
  title: string;
  detail: string | null;
  quote: string | null;
  raisedAt: string;
  judge: { engine: string; confidence: number; reason: string } | null;
  session: {
    id: string;
    title: string;
    source: SessionSource;
    status: SessionStatus;
    url: string | null;
    /** `claude --resume …` for local sessions. */
    resume: string | null;
    repo: string | null;
    lastActivityAt: string | null;
  };
  agent: { id: string; name: string; role: string; avatar: AvatarSpec } | null;
  team: { id: string; name: string } | null;
  project: { id: string; name: string; emoji: string; slug: string } | null;
  company: { id: string; name: string; emoji: string; slug: string } | null;
}

const clip = (t: string | null | undefined, n: number) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : (t ?? null));

export function toAskView(item: InboxItem, org: Pick<Org, "companies">): AskView {
  const { task, session, agent, team, project } = item;
  const quote = session.last_message_role === "assistant" ? session.last_message : session.status_detail;
  const company = project?.company_id ? (org.companies.find((c) => c.id === project.company_id) ?? null) : null;
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    detail: task.detail && task.detail !== task.title ? clip(task.detail, 600) : null,
    quote: quote && quote !== task.title && quote !== task.detail ? clip(quote, 420) : null,
    raisedAt: task.raised_at,
    judge: task.judge ? { engine: task.judge.engine, confidence: task.judge.confidence, reason: task.judge.reason } : null,
    session: {
      id: session.id,
      title: session.title,
      source: session.source,
      status: session.status,
      url: session.url,
      resume: resumeFor(session),
      repo: session.repo,
      lastActivityAt: session.last_activity_at,
    },
    agent: agent ? { id: agent.id, name: agent.name, role: agent.role, avatar: agent.avatar } : null,
    team: team ? { id: team.id, name: team.name } : null,
    project: project ? { id: project.id, name: project.name, emoji: project.emoji, slug: project.slug } : null,
    company: company ? { id: company.id, name: company.name, emoji: company.emoji, slug: company.slug } : null,
  };
}

export const KIND_URGENCY: Record<string, number> = { unblock: 0, decide: 1, respond: 2, review: 3, run: 4, todo: 5 };
