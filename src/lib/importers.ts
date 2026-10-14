import "server-only";
import JSZip from "jszip";
import { listAccounts } from "./claude-accounts";
import { ClaudeAuthError, claudeTokens } from "./claude-auth";
import { REAUTH_HINT, rememberLogin, withClaudeToken } from "./claude-auth-store";
import { ingestSessions, type IngestResult } from "./ingest";
import { cloudConfigFromEnv, extractCloudRecords, fetchCloudSessions, mapCloudSession } from "./sources/cloud";
import { extractConversations, mapClaudeAiConversation } from "./sources/claudeai";
import { scanLocalTranscripts } from "./sources/local-scan";
import { parseTranscript } from "./sources/local";
import type { NormalizedSession } from "./types";

const sum = (a: IngestResult, b: IngestResult): IngestResult => ({
  imported: a.imported + b.imported,
  updated: a.updated + b.updated,
  tasksOpened: a.tasksOpened + b.tasksOpened,
  notes: [...(a.notes ?? []), ...(b.notes ?? [])],
});
const NONE: IngestResult = { imported: 0, updated: 0, tasksOpened: 0 };

/**
 * Local transcripts from every Claude account's projects folder. `onlyChanged` (what syncs use) reads
 * just the transcripts that changed since the last import; without it every transcript is read again.
 */
export async function importLocal(opts: { onlyChanged?: boolean } = {}): Promise<IngestResult> {
  let total = NONE;
  const seen = new Set<string>();
  for (const a of listAccounts()) {
    if (seen.has(a.projectsDir)) continue;
    seen.add(a.projectsDir);
    const scan = await scanLocalTranscripts(a.projectsDir, opts);
    total = sum(total, await ingestSessions("local", scan.sessions, a.id));
    scan.remember();
  }
  return total;
}

/**
 * Cloud sessions from every Claude account that's signed in, each with its own login. One account
 * failing (say its login expired) doesn't stop the others; it's noted in the result instead.
 */
export async function importCloudFromApi(): Promise<IngestResult> {
  const cfg = cloudConfigFromEnv();
  if (!cfg) throw new Error(`Not signed in to Claude. ${REAUTH_HINT} Or paste a JSON export instead.`);
  const accounts = listAccounts().filter((a) => claudeTokens(a).length);
  let total = NONE;
  const failures: string[] = [];
  for (const a of accounts) {
    try {
      const records = await withClaudeToken(
        (token) => fetchCloudSessions({ ...cfg, token, orgUuid: a.primary ? cfg.orgUuid : undefined }),
        claudeTokens(a),
        (t) => rememberLogin(t, a),
      );
      total = sum(total, await ingestSessions("cloud", records.map(mapCloudSession), a.id));
    } catch (err) {
      if (accounts.length === 1) throw err;
      failures.push(`${a.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length === accounts.length) throw new ClaudeAuthError(failures.join(" · "), 401);
  return failures.length ? { ...total, notes: [...(total.notes ?? []), ...failures] } : total;
}

export async function importCloudFromJson(payload: unknown): Promise<IngestResult> {
  const records = extractCloudRecords(payload);
  if (!records.length) throw new Error("No cloud sessions found in that JSON (expected objects with ids like session_…).");
  return ingestSessions("cloud", records.map(mapCloudSession));
}

export async function importClaudeAiPayload(payload: unknown): Promise<IngestResult> {
  const sessions = extractConversations(payload)
    .map(mapClaudeAiConversation)
    .filter((s): s is NormalizedSession => !!s);
  return ingestSessions("claude_ai", sessions);
}

/** The claude.ai data export is a zip containing conversations.json (or the bare JSON file). */
export async function importClaudeAiExport(file: File): Promise<IngestResult> {
  const buf = Buffer.from(await file.arrayBuffer());
  let json: string;
  if (file.name.endsWith(".zip") || buf.subarray(0, 2).toString() === "PK") {
    const zip = await JSZip.loadAsync(buf);
    const entry = Object.values(zip.files).find((f) => /(^|\/)conversations\.json$/.test(f.name));
    if (!entry) throw new Error("That zip has no conversations.json — is it the claude.ai data export?");
    json = await entry.async("string");
  } else {
    json = buf.toString("utf8");
  }
  return importClaudeAiPayload(JSON.parse(json));
}

/** Raw transcript files pushed by `npm run sync:local` (for when Timu runs somewhere else). */
export async function importLocalFiles(files: { id: string; mtimeMs?: number; content: string }[]): Promise<IngestResult> {
  const sessions = files
    .map((f) => parseTranscript(f.content, { fileId: f.id, mtimeMs: f.mtimeMs }))
    .filter((s): s is NormalizedSession => !!s);
  return ingestSessions("local", sessions);
}
