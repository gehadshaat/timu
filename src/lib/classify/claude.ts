import "server-only";
import { anthropic } from "../anthropic";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ProposalSchema, mergeProposals, repairProposal, type Proposal, type SessionDigest } from "./schema";

const MODEL = "claude-opus-5-5";
const BATCH_SIZE = 60;

const SYSTEM = `You organise a person's AI work sessions into a small virtual company.

Each session is a conversation the person has with Claude (coding sessions in a git repo, or chats).
Build an org chart that makes their work legible at a glance:

- COMPANY: the business or organisation a project belongs to, usually the GitHub org (sunbeam-co → "Sunbeam Co",
  duckworks → "Duckworks"). Personal or one-off work has no company (null). Reuse the same company name across its projects.
- PROJECT: a product or area inside a company. Usually one per repository or product
  (sunbeam-co/sunbeam-web → "Sunbeam Web", sunbeam-co/sunbeam-device → "Smart Lunchbox"), then by topic.
  Prefer few, meaningful projects over many tiny ones. Put scattered one-off chats in a "Personal" or "Misc" project.
- TEAM: a department inside the project, named like a real company team (Marketing, Web Engineering, Hardware, Finance, Ops).
- MEMBER: a cartoon team member who "owns" a stream of related sessions. Give them a friendly first name and a real job title
  that fits the work (an SEO landing-page session → "Marketing Manager" or "SEO Lead"; a PCB session → "Hardware Engineer").
  One member can own many sessions. Use varied, inclusive first names; never reuse a name within a project.
- GOAL: an outcome the project is working toward that several sessions contribute to (e.g. "Launch ad landing pages").
  Goals are optional on an assignment; only link when it genuinely fits.

For every session, also judge whether the person must act on it now:
- respond: Claude asked a question or is waiting for an answer or approval
- review: work is ready for the person to look at (PR ready, draft to read, results to check)
- decide: Claude laid out options and needs a choice
- unblock: the session failed or is stuck on something only the person can fix (credentials, access, a migration to run)
- none: nothing pending — work finished cleanly or is still running.
Sessions with status "working" are almost always "none". Merged/finished work with no follow-up is "none".
When a finished session mentions a manual follow-up (e.g. "run migration X", "checkout untested"), that is "unblock" or "review".
The "ask" is a short imperative the person can act on, e.g. "Approve the landing page copy" or "Run the whatsapp handoff migration".

A session with current_member_key already belongs to that member: keep it there unless it clearly no longer fits,
and focus on re-judging attention for it.

Every session id you are given must appear exactly once in assignments, and every key you reference must exist in projects.`;

export { hasClaudeKey } from "../anthropic";

/**
 * Classify sessions in batches. The first batch drafts the org; later batches see the
 * org so far and extend it. `existing` (the saved org) is passed in for incremental runs.
 */
export async function proposeWithClaude(
  sessions: SessionDigest[],
  existing: Proposal["projects"] = [],
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<Proposal> {
  let acc: Proposal = { projects: existing, assignments: [] };
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);
    const result = await classifyBatch(batch, acc.projects);
    acc = mergeProposals(acc, result);
    await onProgress?.(Math.min(i + BATCH_SIZE, sessions.length), sessions.length);
  }
  return repairProposal(acc);
}

async function classifyBatch(batch: SessionDigest[], org: Proposal["projects"]): Promise<Proposal> {
  const orgBlock = org.length
    ? `Current org (reuse these keys; add new projects/teams/members/goals only when nothing fits):\n${JSON.stringify(org)}`
    : "There is no org yet. Create it from these sessions.";

  // Streamed: a large org with many assignments can take a while to write out.
  const stream = anthropic().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    output_config: { effort: "medium", format: betaZodOutputFormat(ProposalSchema) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [
      {
        role: "user",
        content: `${orgBlock}\n\nToday is ${new Date().toISOString().slice(0, 10)}.\n\nSessions:\n${JSON.stringify(batch)}\n\nReturn the full org (existing plus anything new) and one assignment per session.`,
      },
    ],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to classify this batch.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error(`Claude returned no usable proposal (stop_reason: ${response.stop_reason}).`);
  }
  return response.parsed_output;
}
