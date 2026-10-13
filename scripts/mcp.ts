/**
 * Timu's MCP server over stdio, for Claude Code or Claude Desktop on the same machine.
 * It opens the SQLite database directly, so `npm run dev` doesn't need to be running. Add it with:
 *
 *   claude mcp add timu -- npm --prefix /path/to/Timu run -s mcp
 *
 * stdout carries the protocol: nothing in here may print to it.
 */
import fs from "node:fs";
import path from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createTimuMcp } from "../src/lib/mcp/server";

// Same precedence as Next: the shell's env, then .env.local, then .env.
const root = path.resolve(__dirname, "..");
for (const file of [".env.local", ".env"]) {
  const p = path.join(root, file);
  if (fs.existsSync(p)) process.loadEnvFile(p);
}

serveStdio(() => createTimuMcp());
