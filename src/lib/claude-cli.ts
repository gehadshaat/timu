import "server-only";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { primaryAccount } from "./claude-accounts";

/**
 * Timu's own model calls (the organiser and triage) go through Claude Code's headless mode,
 * `claude -p`, so they run on the Claude login you already have — no API key. Each call is a
 * single turn with no tools, no MCP servers, no settings or CLAUDE.md, and nothing saved to disk;
 * the answer comes back as JSON that matches a Zod schema.
 *
 * CLAUDE_CLI: the path to the `claude` binary when it isn't on PATH, or "off" for rules only.
 */

const bin = () => process.env.CLAUDE_CLI?.trim() || "claude";

let available: boolean | null = null;

/** Can Timu use Claude? True when the `claude` CLI runs here (checked once per process). */
export function hasClaude(): boolean {
  if (bin() === "off") return false;
  if (available === null) {
    const r = spawnSync(bin(), ["--version"], { stdio: "ignore", timeout: 10_000 });
    available = r.status === 0;
  }
  return available;
}

export interface ClaudeCall<T extends z.ZodType> {
  model: string;
  system: string;
  prompt: string;
  schema: T;
  effort?: "low" | "medium" | "high";
  /** Default 10 minutes: a big organiser batch takes a while to write out. */
  timeoutMs?: number;
}

/** The environment for `claude -p`: your login, never an API key that happens to be set. */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  // The same account Timu syncs first (CLAUDE_CONFIG_DIR=… claude logins live in their own folder).
  const account = primaryAccount();
  if (path.resolve(account.dir) !== path.join(os.homedir(), ".claude")) env.CLAUDE_CONFIG_DIR = account.dir;
  return env;
}

/** Ask Claude once and get back an object matching `schema`. Throws with Claude's message on failure. */
export async function askClaude<T extends z.ZodType>(call: ClaudeCall<T>): Promise<z.infer<T>> {
  // The CLI's validator doesn't load the draft 2020-12 meta-schema, so drop the $schema pointer.
  const jsonSchema = z.toJSONSchema(call.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const args = [
    "-p",
    "--output-format", "json",
    "--model", call.model,
    "--effort", call.effort ?? "medium",
    "--system-prompt", call.system,
    "--json-schema", JSON.stringify(jsonSchema),
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--no-session-persistence",
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin(), args, { cwd: os.tmpdir(), env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude took longer than ${Math.round((call.timeoutMs ?? 600_000) / 60_000)} minutes.`));
    }, call.timeoutMs ?? 600_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't run the Claude CLI (${bin()}): ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // A failed turn still prints its JSON result; let the parser below report it.
      if (code !== 0 && !out.trim()) reject(new Error(err.trim() || `claude exited with code ${code}`));
      else resolve(out);
    });
    child.stdin.end(call.prompt);
  });

  let result: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown };
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(`Claude CLI printed something other than JSON: ${stdout.slice(0, 200)}`);
  }
  if (result.is_error || result.subtype !== "success" || result.structured_output == null) {
    throw new Error(`Claude returned no usable answer (${result.subtype ?? "error"}): ${String(result.result ?? "").slice(0, 300)}`);
  }
  return call.schema.parse(result.structured_output);
}
