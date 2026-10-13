import "server-only";
import { listAccounts, type ClaudeAccount } from "./claude-accounts";
import { claudeAuthStatus } from "./claude-auth";
import { lastLogin } from "./claude-auth-store";
import { cloudConfigFromEnv } from "./sources/cloud";
import { countLocalTranscripts, localProjectsDir } from "./sources/local-scan";
import { getSourceStats } from "./queries";
import type { SourceInfo } from "@/components/SourcesPanel";

export async function getSourceInfo(): Promise<SourceInfo> {
  const [localFiles, stats] = await Promise.all([countLocalTranscripts(), getSourceStats()]);
  return {
    localDir: localProjectsDir(),
    localFiles,
    cloudConfigured: !!cloudConfigFromEnv(),
    claude: listAccounts().map(claudeLogin),
    ingestTokenSet: !!process.env.TIMU_INGEST_TOKEN,
    counts: Object.fromEntries(stats.map((s) => [s.source, s.sessions])),
  };
}

/** Which Claude login the cloud pulls use, in words for the Settings page (worked out on the server). */
function claudeLogin(account: ClaudeAccount): SourceInfo["claude"][number] {
  const st = claudeAuthStatus(account);
  let expires: string | null = null;
  if (st.expiresAt) {
    const mins = Math.round((st.expiresAt - Date.now()) / 60_000);
    expires = mins <= 0 ? "expired" : mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`;
  }
  // What actually worked last time beats what we'd try first: a rejected .env.local token is flagged.
  const last = lastLogin(account);
  const envSet = account.primary && !!process.env.CLAUDE_SESSIONS_TOKEN?.trim();
  const source = last?.source === "claude-code" ? "claude-code" : st.source;
  return { id: account.id, label: account.label, dir: account.dir, source, expired: st.expired, expires, envRejected: envSet && last?.source === "claude-code" };
}
