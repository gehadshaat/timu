import "server-only";
import type { ClaudeAccount } from "./claude-accounts";
import { type ClaudeToken } from "./claude-auth";
import { getSetting, setSetting } from "./db";

export { REAUTH_HINT, withClaudeToken } from "./claude-auth";

const KEY = "claude_login";
const keyFor = (account?: ClaudeAccount) => (!account || account.primary ? KEY : `${KEY}:${account.id}`);

export interface LastLogin {
  source: ClaudeToken["source"];
  at: string;
}

/** Remember which login Claude last accepted (Settings shows it; a rejected .env.local token is flagged). */
export function rememberLogin(t: ClaudeToken, account?: ClaudeAccount): void {
  setSetting(keyFor(account), { source: t.source, at: new Date().toISOString() } satisfies LastLogin);
}

export function lastLogin(account?: ClaudeAccount): LastLogin | null {
  return getSetting<LastLogin>(keyFor(account));
}
