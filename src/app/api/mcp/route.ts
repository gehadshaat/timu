import { createMcpHandler } from "@modelcontextprotocol/server";
import { checkMcpToken } from "@/lib/mcp/auth";
import { createTimuMcp } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stateless: every request gets a fresh server, so nothing is held between calls. */
const mcp = createMcpHandler(() => createTimuMcp());

/** Timu's MCP server over Streamable HTTP, for Claude Code, Claude Desktop and claude.ai connectors. */
async function handle(req: Request): Promise<Response> {
  return checkMcpToken(req) ?? mcp.fetch(req);
}

export { handle as DELETE, handle as GET, handle as POST };
