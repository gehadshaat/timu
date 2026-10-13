import { afterEach, describe, expect, it } from "vitest";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { Org } from "../queries";
import { checkMcpToken } from "./auth";
import { resolveCompany, resolveGoal, resolveProject, resolveTeam, resolveTeammate, sessionKey } from "./resolve";
import { createTimuMcp } from "./server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = { description: "", emoji: "", color: "", created_at: "" };

const org: Org = {
  companies: [{ ...base, id: id(1), slug: "sunbeam-co", name: "Sunbeam Co" }],
  projects: [
    { ...base, id: id(10), company_id: id(1), slug: "sunbeam-web", name: "Sunbeam Web", theme: "sunny" },
    { ...base, id: id(11), company_id: null, slug: "procurement", name: "Procurement App", theme: "mint" },
  ],
  teams: [
    { id: id(20), project_id: id(10), name: "Web Engineering", description: "", color: "" },
    { id: id(21), project_id: id(11), name: "Web Engineering", description: "", color: "" },
    { id: id(22), project_id: id(10), name: "Marketing", description: "", color: "" },
  ],
  agents: [
    { id: id(30), team_id: id(20), name: "Maya", role: "Frontend", persona: "", avatar: { seed: "m" } },
    { id: id(31), team_id: id(22), name: "Omar", role: "SEO", persona: "", avatar: { seed: "o" } },
    { id: id(32), team_id: id(21), name: "Omar", role: "Ops", persona: "", avatar: { seed: "o2" } },
  ],
  goals: [
    { id: id(40), project_id: id(10), team_id: null, title: "Launch v2", description: "", status: "active", due_date: null, priority: "normal", achieved_at: null, created_at: "" },
  ],
};

describe("MCP references", () => {
  it("finds rows by id, slug or case-insensitive name", () => {
    expect(resolveCompany(org, id(1)).name).toBe("Sunbeam Co");
    expect(resolveCompany(org, "sunbeam-co").id).toBe(id(1));
    expect(resolveProject(org, "  procurement app ").id).toBe(id(11));
    expect(resolveTeam(org, "marketing").id).toBe(id(22));
    expect(resolveGoal(org, "launch V2").id).toBe(id(40));
  });

  it("refuses ambiguous names, listing the candidates, and accepts a qualified path", () => {
    expect(() => resolveTeam(org, "Web Engineering")).toThrow(/matches 2 teams: Sunbeam Web \/ Web Engineering .*Procurement App \/ Web Engineering/);
    expect(resolveTeam(org, "Procurement App/Web Engineering").id).toBe(id(21));
    expect(resolveTeam(org, "sunbeam-web / web engineering").id).toBe(id(20));
    expect(() => resolveTeammate(org, "Omar")).toThrow(/matches 2 teammates/);
    expect(resolveTeammate(org, "Marketing / Omar").id).toBe(id(31));
    expect(resolveTeammate(org, "Procurement App / Web Engineering / Omar").id).toBe(id(32));
  });

  it("suggests near matches when nothing matches", () => {
    expect(() => resolveProject(org, "Sunbeam")).toThrow(/No project matches "Sunbeam". Did you mean: Sunbeam Web/);
    expect(() => resolveCompany(org, "Acme")).toThrow(/^No company matches "Acme".$/);
  });

  it("turns session URLs into ids", () => {
    expect(sessionKey("https://claude.ai/code/session_01ABC")).toBe("session_01ABC");
    expect(sessionKey("https://claude.ai/chat/abc-123/?x=1#y")).toBe("abc-123");
    expect(sessionKey(" session_01ABC ")).toBe("session_01ABC");
  });
});

describe("MCP token", () => {
  const saved = process.env.TIMU_MCP_TOKEN;
  afterEach(() => {
    process.env.TIMU_MCP_TOKEN = saved;
  });
  const req = (headers: Record<string, string> = {}, query = "") => new Request(`http://localhost/api/mcp${query}`, { method: "POST", headers });

  it("is closed until a token is configured", () => {
    delete process.env.TIMU_MCP_TOKEN;
    expect(checkMcpToken(req({ authorization: "Bearer anything" }))?.status).toBe(503);
  });

  it("accepts the bearer header or ?token=, and nothing else", () => {
    process.env.TIMU_MCP_TOKEN = "s3cret-token";
    expect(checkMcpToken(req({ authorization: "Bearer s3cret-token" }))).toBeNull();
    expect(checkMcpToken(req({}, "?token=s3cret-token"))).toBeNull();
    expect(checkMcpToken(req())?.status).toBe(401);
    expect(checkMcpToken(req({ authorization: "Bearer s3cret-tokeN" }))?.status).toBe(401);
    expect(checkMcpToken(req({}, "?token=s3cret"))?.status).toBe(401);
  });
});

describe("MCP server", () => {
  async function rpc(method: string, params: Record<string, unknown> = {}) {
    const handler = createMcpHandler(() => createTimuMcp());
    const res = await handler.fetch(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    const text = await res.text();
    const data = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(data ? data.slice(6) : text).result;
  }

  it("introduces itself with instructions", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(r.serverInfo.name).toBe("timu");
    expect(r.instructions).toMatch(/get_org/);
  });

  it("lists every tool with an object schema and the right safety hints", async () => {
    const { tools } = (await rpc("tools/list")) as {
      tools: { name: string; description: string; inputSchema: { type: string }; annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } }[];
    };
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ["get_org", "create_company", "update_project", "delete_team", "hire_teammate", "assign_sessions", "create_goal", "create_todo", "handle_ask", "sync_sessions"]) {
      expect(names).toContain(name);
    }
    // The bulk tools, comments, search and undo behind the UI's bulk bars, quick-add and threads.
    for (const name of [
      "handle_asks",
      "move_sessions",
      "archive_sessions",
      "refile_sessions",
      "add_todos",
      "update_todos",
      "delete_todos",
      "add_goals",
      "update_goals",
      "delete_goals",
      "add_milestones",
      "hire_teammates",
      "move_teammates",
      "remove_teammates",
      "move_projects",
      "delete_projects",
      "undo",
      "list_comments",
      "add_comment",
      "update_comment",
      "delete_comment",
      "search",
      "recheck_session",
    ]) {
      expect(names).toContain(name);
    }
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.annotations.readOnlyHint).toBe(t.name.startsWith("get_") || t.name.startsWith("list_") || t.name === "search");
      expect(t.annotations.destructiveHint === true).toBe(/^(delete|remove)_/.test(t.name));
    }
  });
});
