import { describe, expect, it } from "vitest";
import { extractCloudRecords, mapCloudSession } from "./cloud";
import { looksLikeQuestion, parseTranscript } from "./local";
import { extractConversations, mapClaudeAiConversation } from "./claudeai";

describe("cloud sessions", () => {
  const base = {
    id: "session_01abc",
    title: "SEO meta tags",
    created_at: "2026-10-12T10:00:00Z",
    updated_at: "2026-10-12T11:00:00Z",
    session_context: {
      sources: [{ git_repository: { url: "https://github.com/acme/web" } }],
      outcomes: [{ git_repository: { git_info: { repo: "acme/web", branches: ["claude/seo"] } } }],
    },
  };

  it("maps status buckets", () => {
    expect(mapCloudSession({ ...base, status_bucket: "SESSION_STATUS_BUCKET_WORKING" }).status).toBe("working");
    expect(mapCloudSession({ ...base, status_bucket: "SESSION_STATUS_BUCKET_BLOCKED" }).status).toBe("needs_you");
    expect(mapCloudSession({ ...base, status_bucket: "SESSION_STATUS_BUCKET_REVIEW_READY" }).status).toBe("review");
    expect(mapCloudSession({ ...base, status_bucket: "SESSION_STATUS_BUCKET_COMPLETED" }).status).toBe("done");
    expect(mapCloudSession({ ...base, status_bucket: "SESSION_STATUS_BUCKET_FAILED" }).status).toBe("failed");
  });

  it("treats a pending needs_action as needing the user, except while working or failed", () => {
    const pts = { needs_action: "Approve the copy", status_detail: "waiting" };
    const done = mapCloudSession({ ...base, status_bucket: "SESSION_STATUS_BUCKET_COMPLETED", post_turn_summary: pts });
    expect(done.status).toBe("needs_you");
    expect(done.statusDetail).toBe("Approve the copy");
    expect(mapCloudSession({ ...base, status_bucket: "SESSION_STATUS_BUCKET_FAILED", post_turn_summary: pts }).status).toBe("failed");
    expect(mapCloudSession({ ...base, status_bucket: "SESSION_STATUS_BUCKET_WORKING", post_turn_summary: pts }).status).toBe("working");
  });

  it("reads repo, branch and url", () => {
    const s = mapCloudSession(base);
    expect(s.repo).toBe("acme/web");
    expect(s.branch).toBe("claude/seo");
    expect(s.url).toBe("https://claude.ai/code/session_01abc");
  });

  it("extracts records from the API page, a bare array, and the MCP wrapper", () => {
    expect(extractCloudRecords({ data: [base] })).toHaveLength(1);
    expect(extractCloudRecords([base, { id: "nope" }])).toHaveLength(1);
    expect(extractCloudRecords({ ccr: { data: [base] } })).toHaveLength(1);
  });
});

describe("local transcripts", () => {
  const lines = (...objs: object[]) => objs.map((o) => JSON.stringify(o)).join("\n");
  const meta = { sessionId: "abc-123", cwd: "/home/me/acme-web", gitBranch: "main", isSidechain: false };

  it("extracts title, first prompt, last message and a waiting-on-you status", () => {
    const text = lines(
      { type: "user", ...meta, timestamp: "2026-10-12T10:00:00Z", message: { role: "user", content: "<system-reminder>x</system-reminder>Build the landing page" } },
      { type: "assistant", ...meta, message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use" }] } },
      { type: "user", ...meta, message: { role: "user", content: [{ type: "tool_result" }] } },
      { type: "assistant", ...meta, timestamp: "2026-10-12T10:05:00Z", message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Done. Should I deploy it now?" }] } },
      { type: "ai-title", aiTitle: "Landing page build" },
    );
    const s = parseTranscript(text, { fileId: "abc-123", mtimeMs: 0, now: Date.parse("2026-10-13T00:00:00Z") })!;
    expect(s.title).toBe("Landing page build");
    expect(s.firstUserMessage).toBe("Build the landing page");
    expect(s.lastMessage).toBe("Done. Should I deploy it now?");
    expect(s.status).toBe("needs_you");
    expect(s.repo).toBe("acme-web");
    expect(s.messageCount).toBe(2);
    expect(s.lastActivityAt).toBe("2026-10-12T10:05:00Z");
  });

  it("is working when recently written mid tool-loop", () => {
    const text = lines(
      { type: "user", ...meta, message: { role: "user", content: "Fix the bug" } },
      { type: "assistant", ...meta, message: { role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use" }] } },
    );
    const now = Date.now();
    expect(parseTranscript(text, { fileId: "x", mtimeMs: now - 1000, now })!.status).toBe("working");
    expect(parseTranscript(text, { fileId: "x", mtimeMs: now - 3600_000, now })!.status).toBe("idle");
  });

  it("skips sidechains and empty transcripts", () => {
    expect(parseTranscript(lines({ type: "user", ...meta, isSidechain: true, message: { content: "sub" } }), { fileId: "x" })).toBeNull();
    expect(parseTranscript("", { fileId: "x" })).toBeNull();
  });

  it("detects questions", () => {
    expect(looksLikeQuestion("Here you go.\nWhich option do you prefer?")).toBe(true);
    expect(looksLikeQuestion("Let me know if you want changes.")).toBe(true);
    expect(looksLikeQuestion("All tests pass and the PR is merged.")).toBe(false);
  });
});

describe("claude.ai conversations", () => {
  const conv = {
    uuid: "c1",
    name: "Pricing",
    updated_at: "2026-10-10T00:00:00Z",
    chat_messages: [
      { sender: "human", text: "How should I price this?" },
      { sender: "assistant", content: [{ type: "text", text: "Three options. Which margin floor should I assume?" }] },
    ],
  };

  it("maps a conversation", () => {
    const s = mapClaudeAiConversation(conv)!;
    expect(s.url).toBe("https://claude.ai/chat/c1");
    expect(s.status).toBe("needs_you");
    expect(s.lastMessageRole).toBe("assistant");
    expect(s.firstUserMessage).toBe("How should I price this?");
  });

  it("extracts from export array and extension payload", () => {
    expect(extractConversations([conv])).toHaveLength(1);
    expect(extractConversations({ conversations: [conv, { nope: 1 }] })).toHaveLength(1);
  });
});
