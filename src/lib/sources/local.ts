import type { NormalizedSession, SessionStatus } from "../types";
import { clip, stripHarnessTags } from "../text";
import { publishedArtifactLinks } from "./artifacts";

/**
 * Local Claude Code transcripts: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 * One JSON object per line. We only need the human prompts, the assistant's
 * visible text, and the session metadata (cwd, branch, AI title).
 */

interface Line {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  aiTitle?: string;
  summary?: string;
  message?: {
    role?: string;
    stop_reason?: string | null;
    content?: string | { type?: string; text?: string }[];
  };
}

/** Recently-written transcripts whose last turn is still mid-tool-loop are "working". */
const WORKING_WINDOW_MS = 3 * 60 * 1000;

export function parseTranscript(
  jsonl: string,
  opts: { fileId: string; mtimeMs?: number; now?: number },
): NormalizedSession | null {
  let sessionId = opts.fileId;
  let cwd: string | null = null;
  let branch: string | null = null;
  let aiTitle: string | null = null;
  let summaryTitle: string | null = null;
  let firstUser: string | null = null;
  let lastText: { role: "user" | "assistant"; text: string } | null = null;
  let lastAssistantStop: string | null = null;
  let lastRole: "user" | "assistant" | null = null;
  let messageCount = 0;
  let startedAt: string | null = null;
  let lastAt: string | null = null;

  for (const rawLine of jsonl.split("\n")) {
    if (!rawLine.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (line.type === "ai-title" && line.aiTitle) aiTitle = line.aiTitle;
    if (line.type === "summary" && line.summary) summaryTitle = line.summary;
    if (line.type !== "user" && line.type !== "assistant") continue;
    if (line.isSidechain) continue;
    if (line.sessionId) sessionId = line.sessionId;
    if (line.cwd) cwd = line.cwd;
    if (line.gitBranch && line.gitBranch !== "HEAD") branch = line.gitBranch;
    if (line.timestamp) {
      startedAt ??= line.timestamp;
      lastAt = line.timestamp;
    }

    const content = line.message?.content;
    if (line.type === "user") {
      if (line.isMeta) continue;
      const text = typeof content === "string"
        ? content
        : (content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      const isToolResult = Array.isArray(content) && content.some((b) => b.type === "tool_result");
      if (isToolResult) {
        lastRole = "user";
        continue;
      }
      const clean = stripHarnessTags(text);
      if (!clean) continue;
      messageCount++;
      firstUser ??= clean;
      lastText = { role: "user", text: clean };
      lastRole = "user";
    } else {
      lastRole = "assistant";
      lastAssistantStop = line.message?.stop_reason ?? lastAssistantStop;
      const blocks = Array.isArray(content) ? content : [];
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
      if (text) {
        messageCount++;
        lastText = { role: "assistant", text };
      }
    }
  }

  if (!firstUser && !lastText) return null;

  const now = opts.now ?? Date.now();
  const recentlyWritten = opts.mtimeMs != null && now - opts.mtimeMs < WORKING_WINDOW_MS;
  const endedTurn = lastRole === "assistant" && lastAssistantStop === "end_turn";

  let status: SessionStatus;
  if (!endedTurn && recentlyWritten) status = "working";
  else if (endedTurn && lastText?.role === "assistant" && looksLikeQuestion(lastText.text)) status = "needs_you";
  else status = "idle";

  const repo = cwd ? cwd.split("/").filter(Boolean).pop() ?? null : null;

  return {
    source: "local",
    externalId: sessionId,
    title: clip(aiTitle ?? summaryTitle ?? firstUser, 120) ?? "Local session",
    url: null,
    repo,
    branch,
    status,
    statusDetail: status === "needs_you" ? clip(lastQuestion(lastText!.text), 300) : null,
    firstUserMessage: clip(firstUser, 2000),
    lastMessage: clip(lastText?.text ?? null, 2000),
    lastMessageRole: lastText?.role ?? null,
    messageCount,
    startedAt,
    lastActivityAt: lastAt,
    // Artifacts this session published (see publishedArtifactLinks).
    raw: { cwd, resume: `claude --resume ${sessionId}`, artifacts: publishedArtifactLinks(jsonl) },
  };
}

/** Did the assistant end its turn by asking the user something? */
export function looksLikeQuestion(text: string): boolean {
  const tail = text.trim().split("\n").slice(-6).join("\n");
  if (/\?\s*\**\s*$/.test(tail)) return true;
  return /\b(should I|shall I|do you want|would you like|let me know|which (one|option)|confirm|say ["“]?go)\b/i.test(tail);
}

function lastQuestion(text: string): string {
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.?!])\s+/);
  const q = [...sentences].reverse().find((s) => s.includes("?"));
  return q ?? sentences.slice(-2).join(" ");
}
