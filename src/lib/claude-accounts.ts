import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Several Claude accounts, the way Claude Code keeps them: each account is a config folder — the
 * default ~/.claude, plus any you sign in with via `CLAUDE_CONFIG_DIR=~/.claude-work claude`. Each
 * folder holds that account's login (.credentials.json), its account config (.claude.json) and its
 * local transcripts (projects/). Timu syncs every account and tags what it imports with its id.
 *
 * Timu finds them by itself: ~/.claude, and any ~/.claude-* / ~/.claude_* folder with a login in it.
 * Set CLAUDE_ACCOUNTS (comma-separated folders) to choose them explicitly instead.
 */

export interface ClaudeAccount {
  /** Stable id from the folder name: "claude", "claude-work". */
  id: string;
  /** What to call it: the account's email when Claude Code recorded one, else the id. */
  label: string;
  dir: string;
  credentialsPath: string;
  configPath: string;
  projectsDir: string;
  /** The first account; the CLAUDE_* settings in .env.local apply to it. */
  primary: boolean;
}

const expand = (p: string) => (p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The account config sits next to the folder for the default account, inside it for the others. */
function configFor(dir: string, home: string): string {
  const inside = path.join(dir, ".claude.json");
  if (fs.existsSync(inside)) return inside;
  return path.resolve(dir) === path.join(home, ".claude") ? path.join(home, ".claude.json") : inside;
}

function accountFor(dir: string, primary: boolean, home: string): ClaudeAccount {
  const id = path.basename(dir).replace(/^\./, "") || "claude";
  let configPath = configFor(dir, home);
  let credentialsPath = path.join(dir, ".credentials.json");
  let projectsDir = path.join(dir, "projects");
  if (primary) {
    configPath = process.env.CLAUDE_CONFIG_PATH || configPath;
    credentialsPath = process.env.CLAUDE_CREDENTIALS_PATH || credentialsPath;
    projectsDir = process.env.CLAUDE_PROJECTS_DIR || projectsDir;
  }
  const email = (readJson(configPath)?.oauthAccount as { emailAddress?: string } | undefined)?.emailAddress;
  return { id, label: email?.trim() || id, dir, credentialsPath, configPath, projectsDir, primary };
}

/** Every Claude account to sync, the default one first. */
export function listAccounts(home = os.homedir()): ClaudeAccount[] {
  const explicit = process.env.CLAUDE_ACCOUNTS?.split(",").map((s) => s.trim()).filter(Boolean);
  let dirs: string[];
  if (explicit?.length) {
    dirs = explicit.map(expand);
  } else {
    const extra: string[] = [];
    try {
      for (const e of fs.readdirSync(home, { withFileTypes: true })) {
        if (!e.isDirectory() || !/^\.claude[-_].+/.test(e.name)) continue;
        const dir = path.join(home, e.name);
        if (fs.existsSync(path.join(dir, ".credentials.json"))) extra.push(dir);
      }
    } catch {
      // No readable home folder: just the default account.
    }
    dirs = [path.join(home, ".claude"), ...extra.sort()];
  }
  const seen = new Set<string>();
  return dirs
    .map((d) => path.resolve(d))
    .filter((d) => (seen.has(d) ? false : (seen.add(d), true)))
    .map((d, i) => accountFor(d, i === 0, home));
}

/** The default account (the CLAUDE_* settings in .env.local apply to it). */
export function primaryAccount(): ClaudeAccount {
  return listAccounts()[0];
}
