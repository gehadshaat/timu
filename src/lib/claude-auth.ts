import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { primaryAccount, type ClaudeAccount } from "./claude-accounts";

/**
 * Signing in to Claude for the cloud sessions and routines pulls, without pasting tokens.
 *
 * Timu borrows the login Claude Code keeps fresh: it re-reads the access token from Claude Code's
 * credentials file (~/.claude/.credentials.json, or CLAUDE_CREDENTIALS_PATH) on every pull, so when
 * Claude Code refreshes its token, Timu has it on the next sync. A CLAUDE_SESSIONS_TOKEN in
 * .env.local is tried first when set, and if Claude rejects it Timu falls back to Claude Code's.
 * Timu never refreshes the token itself.
 */

export interface ClaudeToken {
  token: string;
  source: "env" | "claude-code";
  /** ms since epoch, when known (Claude Code's file records it). */
  expiresAt: number | null;
}

/** Thrown by the pulls when Claude rejects the token (401/403), so the next one can be tried. */
export class ClaudeAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClaudeAuthError";
  }
}

export const REAUTH_HINT = "Open Claude Code (run `claude` in a terminal) to refresh your login — Timu picks it up on the next sync.";

export function credentialsPath(): string {
  return process.env.CLAUDE_CREDENTIALS_PATH || path.join(os.homedir(), ".claude", ".credentials.json");
}

/** Claude Code's current access token, read fresh from its credentials file. */
export function readClaudeCodeToken(file = credentialsPath()): ClaudeToken | null {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } };
    const token = json.claudeAiOauth?.accessToken?.trim();
    if (!token) return null;
    const exp = Number(json.claudeAiOauth?.expiresAt);
    return { token, source: "claude-code", expiresAt: Number.isFinite(exp) && exp > 0 ? exp : null };
  } catch {
    return null;
  }
}

/** Claude Code's account config (~/.claude.json, or CLAUDE_CONFIG_PATH). */
export function claudeConfigPath(): string {
  return process.env.CLAUDE_CONFIG_PATH || path.join(os.homedir(), ".claude.json");
}

/**
 * An account's Claude organisation id, which the routines API needs (as x-organization-uuid):
 * CLAUDE_ORG_UUID for the default account when set, else the account Claude Code is signed in with
 * (read from that account's config; only that one field). Pass a config file path or an account.
 */
export function claudeOrgUuid(target: string | ClaudeAccount = primaryAccount()): string | null {
  const file = typeof target === "string" ? target : target.configPath;
  const env = process.env.CLAUDE_ORG_UUID?.trim();
  if (env && (typeof target === "string" || target.primary)) return env;
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { oauthAccount?: { organizationUuid?: string } };
    return json.oauthAccount?.organizationUuid?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * An account's tokens to try, in order: .env.local's (default account only), then the account's
 * Claude Code login (when it's a different one).
 */
export function claudeTokens(account: ClaudeAccount = primaryAccount()): ClaudeToken[] {
  const out: ClaudeToken[] = [];
  const env = account.primary ? process.env.CLAUDE_SESSIONS_TOKEN?.trim() : undefined;
  if (env) out.push({ token: env, source: "env", expiresAt: null });
  const cc = readClaudeCodeToken(account.credentialsPath);
  if (cc && cc.token !== env) out.push(cc);
  return out;
}

/**
 * Run a pull with the first token Claude accepts. Auth failures move on to the next token; when
 * none works the error says how to sign in again instead of showing a raw 401.
 */
export async function withClaudeToken<T>(
  fn: (token: string) => Promise<T>,
  tokens: ClaudeToken[] = claudeTokens(),
  /** Told which login worked, so Settings can show the one actually in use. */
  onSignedIn?: (t: ClaudeToken) => void,
): Promise<T> {
  if (!tokens.length) throw new ClaudeAuthError(`Not signed in to Claude. ${REAUTH_HINT}`, 401);
  let last: ClaudeAuthError | null = null;
  for (const t of tokens) {
    try {
      const out = await fn(t.token);
      onSignedIn?.(t);
      return out;
    } catch (err) {
      if (!(err instanceof ClaudeAuthError)) throw err;
      last = err;
    }
  }
  const expired = tokens.some((t) => t.source === "claude-code" && t.expiresAt !== null && t.expiresAt < Date.now());
  throw new ClaudeAuthError(`Claude ${expired ? "login has expired" : `rejected the login (${last?.status})`}. ${REAUTH_HINT}`, last?.status ?? 401);
}

export interface ClaudeAuthStatus {
  /** Some token is available to try. */
  available: boolean;
  /** Where the token Timu will use comes from. */
  source: ClaudeToken["source"] | null;
  /** Claude Code's token expiry, when it's the one in use. */
  expiresAt: number | null;
  expired: boolean;
}

/** What the Settings page shows: which login Timu will use and whether it's still fresh. */
export function claudeAuthStatus(account: ClaudeAccount = primaryAccount()): ClaudeAuthStatus {
  const tokens = claudeTokens(account);
  const cc = tokens.find((t) => t.source === "claude-code") ?? null;
  return {
    available: tokens.length > 0,
    source: tokens[0]?.source ?? null,
    expiresAt: cc?.expiresAt ?? null,
    expired: !!cc?.expiresAt && cc.expiresAt < Date.now() && tokens.length === 1,
  };
}
