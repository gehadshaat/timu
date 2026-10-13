import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileArtifacts, getArtifacts, importArtifacts, linkSessionArtifacts, matchByTitle, moveArtifact } from "./artifacts";
import { get, insert, openDatabase, useDatabase } from "./db";
import { artifactIdFromUrl, extractArtifactLinks, parseArtifactList, publishedArtifactLinks } from "./sources/artifacts";
import { chatArtifacts } from "./sources/claudeai";

const LIST = `Showing 3 of 3 artifacts, published by you or shared with you:
- (mine) Sunbeam SEO Audit — https://claude.ai/artifact/SeoAudit123 — updated 2026-10-13
- (mine) Duckworks bid calculator — https://claude.ai/code/artifact/0b5e7c2a-1111-4c3d-9e8f-aaaaaaaaaaaa — updated 2026-10-01
- (shared) Holiday gift guide — https://claude.ai/artifact/GiftGuide99 — updated 2026-09-20
(Artifacts shared from another organization are not listed here yet.)`;

describe("reading artifacts", () => {
  it("parses the list Claude prints, line by line", () => {
    const rows = parseArtifactList(LIST);
    expect(rows.map((r) => [r.id, r.title, r.owner, r.updated_at])).toEqual([
      ["SeoAudit123", "Sunbeam SEO Audit", "mine", "2026-10-13"],
      ["0b5e7c2a-1111-4c3d-9e8f-aaaaaaaaaaaa", "Duckworks bid calculator", "mine", "2026-10-01"],
      ["GiftGuide99", "Holiday gift guide", "shared", "2026-09-20"],
    ]);
  });

  it("parses JSON too, and ignores things that aren't artifacts", () => {
    expect(parseArtifactList({ data: [{ url: "https://claude.ai/artifact/AbC123x", title: "Plan" }, { url: "https://example.com" }] })).toEqual([
      { id: "AbC123x", url: "https://claude.ai/artifact/AbC123x", title: "Plan", owner: null, updated_at: null },
    ]);
    expect(parseArtifactList("no links here")).toEqual([]);
  });

  it("finds every artifact link in a transcript, once each", () => {
    const text = 'Published! https://claude.ai/artifact/SeoAudit123 … again https://claude.ai/artifact/SeoAudit123 and "https://claude.ai/code/artifact/abcdef12"';
    expect(extractArtifactLinks(text).map((l) => l.id)).toEqual(["SeoAudit123", "abcdef12"]);
    expect(artifactIdFromUrl("https://claude.ai/artifact/SeoAudit123")).toBe("SeoAudit123");
    expect(artifactIdFromUrl("https://claude.ai/chat/123")).toBeNull();
  });

  it("matches a title to the longest project name, else a company", () => {
    const projects = [
      { id: "web", name: "Sunbeam Web", company_id: "sun" },
      { id: "dev", name: "Sunbeam Device", company_id: "sun" },
      { id: "app", name: "Procurement App", company_id: "duck" },
    ];
    const companies = [
      { id: "sun", name: "Sunbeam Co" },
      { id: "duck", name: "Duckworks" },
    ];
    expect(matchByTitle("Sunbeam Web — SEO audit", projects, companies)).toEqual({ projectId: "web", companyId: "sun" });
    // Company only: its single project.
    expect(matchByTitle("Duckworks bid calculator", projects, companies)).toEqual({ projectId: "app", companyId: "duck" });
    expect(matchByTitle("Weekend packing list", projects, companies)).toBeNull();
  });
});

describe("which session made an artifact", () => {
  const line = (o: unknown) => JSON.stringify(o);
  const transcript = [
    // Listing the gallery mentions every artifact — that must not count.
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Artifact", input: { action: "list" } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "- (mine) Old — https://claude.ai/artifact/ListedOnly1" }] } }),
    // Publishing one does.
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Artifact", input: { file_path: "report.html" } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "Published: https://claude.ai/artifact/Published1" }] }] } }),
    // So does mentioning it in plain text? No.
    line({ type: "assistant", message: { content: [{ type: "text", text: "see https://claude.ai/artifact/Mentioned1" }] } }),
  ].join("\n");

  it("counts only links that come back from publishing", () => {
    expect(publishedArtifactLinks(transcript).map((l) => l.id)).toEqual(["Published1"]);
  });

  it("finds the artifacts Claude made inside a claude.ai chat, with their titles", () => {
    const conv = {
      uuid: "conv-1",
      chat_messages: [
        { sender: "assistant", content: [{ type: "tool_use", name: "artifacts", input: { id: "lunchbox-plan", type: "text/markdown", title: "Lunchbox launch plan", command: "create" } }] },
        { sender: "assistant", content: [{ type: "tool_use", name: "artifacts", input: { id: "lunchbox-plan", command: "update" } }] },
      ],
    };
    expect(chatArtifacts(conv)).toEqual([{ id: "chat-conv-1-lunchbox-plan", url: "https://claude.ai/chat/conv-1", title: "Lunchbox launch plan" }]);
  });
});

describe("filing artifacts", () => {
  beforeAll(() => useDatabase(openDatabase(":memory:")));
  afterAll(() => useDatabase(null));

  it("files by the linked session's project first, then by title, and never moves yours", () => {
    const [company] = insert<{ id: string }>("companies", { slug: "sunbeam-co", name: "Sunbeam Co" });
    const [web] = insert<{ id: string }>("projects", { slug: "sunbeam-web", name: "Sunbeam Web", company_id: company.id });
    const [ops] = insert<{ id: string }>("projects", { slug: "ops", name: "Ops", company_id: company.id });
    const [session] = insert<{ id: string }>("sessions", { source: "local", external_id: "s1", title: "Holiday campaign", project_id: ops.id });

    importArtifacts(LIST);
    linkSessionArtifacts([{ sessionId: session.id, artifacts: [{ id: "GiftGuide99", url: "https://claude.ai/artifact/GiftGuide99" }] }]);
    fileArtifacts();
    const where = (id: string) => get<{ project_id: string | null; filed_by: string | null }>("select project_id, filed_by from artifacts where id = ?", id);
    // Linked from a session in Ops: goes to Ops, even though nothing in its title says so.
    expect(where("GiftGuide99")).toEqual({ project_id: ops.id, filed_by: "session" });
    // No session: by title. "Sunbeam SEO Audit" names the company (minus "Co"), which has two
    // projects, so it's filed to the company and the project is left for you to pick.
    expect(where("SeoAudit123")).toEqual({ project_id: null, filed_by: "title" });
    expect(get<{ company_id: string }>("select company_id from artifacts where id = ?", "SeoAudit123")?.company_id).toBe(company.id);

    // Filed by you: stays put on later passes.
    moveArtifact("SeoAudit123", ops.id);
    fileArtifacts();
    expect(where("SeoAudit123")).toEqual({ project_id: ops.id, filed_by: "you" });

    // A session that stops claiming an artifact lets it go; link-only ones nobody claims disappear.
    linkSessionArtifacts([{ sessionId: session.id, artifacts: [{ id: "LinkOnly1", url: "https://claude.ai/artifact/LinkOnly1" }] }]);
    expect(get("select id from artifacts where id = ?", "LinkOnly1")).toBeTruthy();
    expect(get<{ session_id: string | null }>("select session_id from artifacts where id = ?", "GiftGuide99")?.session_id).toBeNull();
    linkSessionArtifacts([{ sessionId: session.id, artifacts: [{ id: "GiftGuide99", url: "https://claude.ai/artifact/GiftGuide99" }] }]);
    expect(get("select id from artifacts where id = ?", "LinkOnly1")).toBeNull();
    fileArtifacts();

    const org = { companies: [{ id: company.id, name: "Sunbeam Co", emoji: "🌞" }], projects: [{ id: web.id, name: "Sunbeam Web", emoji: "🛒", slug: "sunbeam-web" }, { id: ops.id, name: "Ops", emoji: "📦", slug: "ops" }] } as unknown as Parameters<typeof getArtifacts>[0];
    const views = getArtifacts(org, { projectId: ops.id });
    expect(views.map((v) => v.id).sort()).toEqual(["GiftGuide99", "SeoAudit123"]);
    expect(views.find((v) => v.id === "GiftGuide99")?.session?.title).toBe("Holiday campaign");
  });
});
