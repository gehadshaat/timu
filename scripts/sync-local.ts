/**
 * Push local Claude Code transcripts to a Timu server that can't read your disk
 * (e.g. once Timu is hosted). Usage:
 *
 *   TIMU_URL=https://timu.example.com TIMU_INGEST_TOKEN=… npm run sync:local
 *
 * Only top-level transcripts changed since the last push are sent (state in ~/.timu-sync.json).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TIMU_URL = (process.env.TIMU_URL || "http://localhost:3100").replace(/\/+$/, "");
const TOKEN = process.env.TIMU_INGEST_TOKEN;
const DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
const STATE = path.join(os.homedir(), ".timu-sync.json");
const BATCH_BYTES = 8 * 1024 * 1024;

async function main() {
  if (!TOKEN) throw new Error("Set TIMU_INGEST_TOKEN (same value as on the Timu server).");
  const state: Record<string, number> = JSON.parse(await fs.readFile(STATE, "utf8").catch(() => "{}"));

  const changed: { id: string; mtimeMs: number; file: string }[] = [];
  for (const project of await fs.readdir(DIR, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    for (const f of await fs.readdir(path.join(DIR, project.name))) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(DIR, project.name, f);
      const { mtimeMs } = await fs.stat(file);
      if (state[file] !== mtimeMs) changed.push({ id: f.replace(/\.jsonl$/, ""), mtimeMs, file });
    }
  }
  console.log(`${changed.length} transcript(s) changed in ${DIR}`);

  let batch: { id: string; mtimeMs: number; content: string; file: string }[] = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const res = await fetch(`${TIMU_URL}/api/ingest/local`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ files: batch.map(({ id, mtimeMs, content }) => ({ id, mtimeMs, content })) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Timu returned ${res.status}: ${body.error ?? ""}`);
    console.log(`  sent ${batch.length}: ${body.imported} new, ${body.updated} updated`);
    for (const b of batch) state[b.file] = b.mtimeMs;
    await fs.writeFile(STATE, JSON.stringify(state));
    batch = [];
    size = 0;
  };

  for (const c of changed) {
    const content = await fs.readFile(c.file, "utf8");
    if (size + content.length > BATCH_BYTES) await flush();
    batch.push({ ...c, content });
    size += content.length;
  }
  await flush();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
