import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeAuthError, claudeOrgUuid, claudeTokens, readClaudeCodeToken, withClaudeToken } from "./claude-auth";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "timu-auth-"));
const file = path.join(dir, ".credentials.json");
const write = (token: string, expiresAt: number) => fs.writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt } }));
const saved = { token: process.env.CLAUDE_SESSIONS_TOKEN, path: process.env.CLAUDE_CREDENTIALS_PATH, org: process.env.CLAUDE_ORG_UUID };

afterEach(() => {
  process.env.CLAUDE_SESSIONS_TOKEN = saved.token ?? "";
  process.env.CLAUDE_CREDENTIALS_PATH = saved.path ?? "";
  process.env.CLAUDE_ORG_UUID = saved.org ?? "";
});

describe("signing in with Claude Code's login", () => {
  it("reads the token fresh from the credentials file each time", () => {
    write("tok-1", 2_000_000_000_000);
    expect(readClaudeCodeToken(file)).toEqual({ token: "tok-1", source: "claude-code", expiresAt: 2_000_000_000_000 });
    write("tok-2", 2_000_000_000_000);
    expect(readClaudeCodeToken(file)?.token).toBe("tok-2");
    expect(readClaudeCodeToken(path.join(dir, "missing.json"))).toBeNull();
  });

  it("tries the .env.local token first, then Claude Code's", () => {
    write("from-claude-code", 2_000_000_000_000);
    process.env.CLAUDE_CREDENTIALS_PATH = file;
    process.env.CLAUDE_SESSIONS_TOKEN = "from-env";
    expect(claudeTokens().map((t) => t.source)).toEqual(["env", "claude-code"]);
    process.env.CLAUDE_SESSIONS_TOKEN = "";
    expect(claudeTokens().map((t) => t.token)).toEqual(["from-claude-code"]);
  });

  it("falls back to the next token when Claude rejects one", async () => {
    const tried: string[] = [];
    const result = await withClaudeToken(
      async (t) => {
        tried.push(t);
        if (t === "stale") throw new ClaudeAuthError("401", 401);
        return "ok";
      },
      [
        { token: "stale", source: "env", expiresAt: null },
        { token: "fresh", source: "claude-code", expiresAt: null },
      ],
    );
    expect(result).toBe("ok");
    expect(tried).toEqual(["stale", "fresh"]);
  });

  it("says how to sign in again when every token is rejected, and doesn't swallow other errors", async () => {
    const reject = async () => {
      throw new ClaudeAuthError("401", 401);
    };
    await expect(withClaudeToken(reject, [{ token: "old", source: "claude-code", expiresAt: 1 }])).rejects.toThrow(/login has expired.*run `claude`/);
    await expect(withClaudeToken(reject, [])).rejects.toThrow(/Not signed in/);
    await expect(
      withClaudeToken(async () => {
        throw new Error("network down");
      }, [{ token: "a", source: "env", expiresAt: null }]),
    ).rejects.toThrow("network down");
  });

  it("finds your organisation from CLAUDE_ORG_UUID, else Claude Code's account", () => {
    const config = path.join(dir, ".claude.json");
    fs.writeFileSync(config, JSON.stringify({ oauthAccount: { organizationUuid: "org-from-claude-code" } }));
    process.env.CLAUDE_ORG_UUID = "";
    expect(claudeOrgUuid(config)).toBe("org-from-claude-code");
    process.env.CLAUDE_ORG_UUID = "org-from-env";
    expect(claudeOrgUuid(config)).toBe("org-from-env");
    process.env.CLAUDE_ORG_UUID = "";
    expect(claudeOrgUuid(path.join(dir, "nope.json"))).toBeNull();
  });
});
