import type { NormalizedSession } from "../types";
import { clip } from "../text";
import { looksLikeQuestion } from "./local";

/**
 * claude.ai chat conversations. Two inputs share this shape:
 *  - the official data export (Settings → Privacy → Export data → conversations.json)
 *  - the Timu Chrome extension, which reads the same records from claude.ai while you're signed in
 */
export interface ClaudeAiConversation {
  uuid: string;
  name?: string | null;
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
  project?: { uuid?: string; name?: string } | null;
  project_uuid?: string | null;
  chat_messages?: ClaudeAiMessage[];
}

export interface ClaudeAiMessage {
  uuid?: string;
  sender?: "human" | "assistant" | string;
  text?: string;
  content?: { type?: string; text?: string }[];
  created_at?: string;
}

function messageText(m: ClaudeAiMessage): string {
  const fromContent = (m.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
  return (fromContent || m.text || "").trim();
}

export function mapClaudeAiConversation(conv: ClaudeAiConversation): NormalizedSession | null {
  const messages = (conv.chat_messages ?? []).filter((m) => messageText(m));
  if (!conv.uuid || (messages.length === 0 && !conv.name)) return null;

  const first = messages.find((m) => m.sender === "human");
  const last = messages[messages.length - 1];
  const lastRole = last ? (last.sender === "human" ? "user" : "assistant") : null;
  const lastText = last ? messageText(last) : null;
  const asks = lastRole === "assistant" && !!lastText && looksLikeQuestion(lastText);

  return {
    source: "claude_ai",
    externalId: conv.uuid,
    title: clip(conv.name || (first ? messageText(first) : null), 120) ?? "Untitled chat",
    url: `https://claude.ai/chat/${conv.uuid}`,
    repo: null,
    branch: null,
    status: asks ? "needs_you" : "idle",
    statusDetail: asks ? clip(lastText, 300) : null,
    firstUserMessage: clip(first ? messageText(first) : null, 2000),
    lastMessage: clip(lastText, 2000),
    lastMessageRole: lastRole,
    messageCount: messages.length,
    startedAt: conv.created_at ?? messages[0]?.created_at ?? null,
    lastActivityAt: conv.updated_at ?? last?.created_at ?? null,
    raw: {
      summary: conv.summary ?? null,
      project: conv.project?.name ?? null,
    },
  };
}

/** Accepts conversations.json content, a single conversation, or `{conversations: [...]}`. */
export function extractConversations(payload: unknown): ClaudeAiConversation[] {
  if (Array.isArray(payload)) return payload.filter(isConversation);
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.conversations)) return obj.conversations.filter(isConversation);
    if (isConversation(obj)) return [obj];
  }
  return [];
}

function isConversation(v: unknown): v is ClaudeAiConversation {
  return !!v && typeof v === "object" && typeof (v as { uuid?: unknown }).uuid === "string";
}
