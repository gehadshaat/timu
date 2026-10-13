import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listAccounts } from "./claude-accounts";
import { claudeOrgUuid, claudeTokens } from "./claude-auth";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "timu-home-"));
const put = (rel: string, json: unknown) => {
  const file = path.join(home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json));
};
// Default account: login in ~/.claude, account config next to it in ~/.claude.json.
put(".claude/.credentials.json", { claudeAiOauth: { accessToken: "tok-personal" } });
put(".claude.json", { oauthAccount: { emailAddress: "me@personal.dev", organizationUuid: "org-personal" } });
// A second account signed in with CLAUDE_CONFIG_DIR=~/.claude-work: everything inside its folder.
put(".claude-work/.credentials.json", { claudeAiOauth: { accessToken: "tok-work" } });
put(".claude-work/.claude.json", { oauthAccount: { emailAddress: "me@work.com", organizationUuid: "org-work" } });
// A folder that looks like an account but has no login: skipped.
fs.mkdirSync(path.join(home, ".claude-old"), { recursive: true });

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["CLAUDE_ACCOUNTS", "CLAUDE_SESSIONS_TOKEN", "CLAUDE_ORG_UUID", "CLAUDE_CREDENTIALS_PATH", "CLAUDE_CONFIG_PATH", "CLAUDE_PROJECTS_DIR"]) {
    process.env[k] = saved[k] ?? "";
  }
});

describe("several Claude accounts", () => {
  it("finds the default account and every other signed-in Claude Code folder", () => {
    process.env.CLAUDE_ACCOUNTS = "";
    process.env.CLAUDE_CREDENTIALS_PATH = "";
    process.env.CLAUDE_CONFIG_PATH = "";
    process.env.CLAUDE_PROJECTS_DIR = "";
    const accounts = listAccounts(home);
    expect(accounts.map((a) => [a.id, a.label, a.primary])).toEqual([
      ["claude", "me@personal.dev", true],
      ["claude-work", "me@work.com", false],
    ]);
    expect(accounts[0].configPath).toBe(path.join(home, ".claude.json"));
    expect(accounts[1].configPath).toBe(path.join(home, ".claude-work", ".claude.json"));
    expect(accounts[1].projectsDir).toBe(path.join(home, ".claude-work", "projects"));
  });

  it("uses each account's own login and organisation; .env.local settings only apply to the default", () => {
    process.env.CLAUDE_ACCOUNTS = "";
    process.env.CLAUDE_CREDENTIALS_PATH = "";
    process.env.CLAUDE_CONFIG_PATH = "";
    const [personal, work] = listAccounts(home);
    process.env.CLAUDE_SESSIONS_TOKEN = "tok-env";
    process.env.CLAUDE_ORG_UUID = "";
    expect(claudeTokens(personal).map((t) => t.token)).toEqual(["tok-env", "tok-personal"]);
    expect(claudeTokens(work).map((t) => t.token)).toEqual(["tok-work"]);
    expect(claudeOrgUuid(personal)).toBe("org-personal");
    expect(claudeOrgUuid(work)).toBe("org-work");
    process.env.CLAUDE_ORG_UUID = "org-env";
    expect(claudeOrgUuid(personal)).toBe("org-env");
    expect(claudeOrgUuid(work)).toBe("org-work");
  });

  it("takes an explicit list from CLAUDE_ACCOUNTS, in that order, without duplicates", () => {
    process.env.CLAUDE_ACCOUNTS = `${path.join(home, ".claude-work")}, ${path.join(home, ".claude")}, ${path.join(home, ".claude-work")}`;
    process.env.CLAUDE_CREDENTIALS_PATH = "";
    process.env.CLAUDE_CONFIG_PATH = "";
    const accounts = listAccounts(home);
    expect(accounts.map((a) => [a.id, a.primary])).toEqual([
      ["claude-work", true],
      ["claude", false],
    ]);
  });
});
