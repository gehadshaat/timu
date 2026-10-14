import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NormalizedSession } from "../types";
import { parseTranscript, WORKING_WINDOW_MS } from "./local";

export function localProjectsDir(): string {
  return process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
}

export async function countLocalTranscripts(dir = localProjectsDir()): Promise<number | null> {
  try {
    const projects = await fs.readdir(dir, { withFileTypes: true });
    let n = 0;
    for (const p of projects) {
      if (!p.isDirectory()) continue;
      const files = await fs.readdir(path.join(dir, p.name));
      n += files.filter((f) => f.endsWith(".jsonl")).length;
    }
    return n;
  } catch {
    return null;
  }
}

export interface TranscriptFile {
  path: string;
  mtimeMs: number;
  size: number;
}

/** What a transcript looked like when it was last imported: `${mtimeMs}:${size}`. */
export type ScanMemory = Map<string, string>;

/**
 * The transcripts worth reading again: new or changed since they were last imported, plus any written
 * within the working window, whose status ("working") still depends on the clock. Everything else is
 * already in the database as it is on disk.
 */
export function transcriptsToRead(files: TranscriptFile[], seen: ScanMemory, now = Date.now()): TranscriptFile[] {
  return files.filter((f) => seen.get(f.path) !== `${f.mtimeMs}:${f.size}` || now - f.mtimeMs < WORKING_WINDOW_MS);
}

/** Every top-level transcript (subagent transcripts live in subfolders and are skipped). */
async function listTranscripts(dir: string): Promise<TranscriptFile[]> {
  const out: TranscriptFile[] = [];
  for (const p of await fs.readdir(dir, { withFileTypes: true })) {
    if (!p.isDirectory()) continue;
    const projectDir = path.join(dir, p.name);
    for (const file of await fs.readdir(projectDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const full = path.join(projectDir, file);
      const stat = await fs.stat(full);
      out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
  return out;
}

/** Remembered for the life of the server, so a restart reads everything once. */
const memory: ScanMemory = ((globalThis as { __timuScanMemory?: ScanMemory }).__timuScanMemory ??= new Map());

/**
 * Parses the transcripts in `dir`. With `onlyChanged`, skips the ones that haven't changed since a
 * previous scan was `remember`ed (call it once they're safely imported), so a sync every minute reads
 * only the sessions you're working in, not every transcript you have.
 */
export async function scanLocalTranscripts(
  dir = localProjectsDir(),
  opts: { onlyChanged?: boolean } = {},
): Promise<{ sessions: NormalizedSession[]; remember: () => void }> {
  const all = await listTranscripts(dir);
  const files = opts.onlyChanged ? transcriptsToRead(all, memory) : all;
  const sessions: NormalizedSession[] = [];
  for (const f of files) {
    // Stat came first: if the file grows while it's read, the next scan sees a new mtime and reads it again.
    const parsed = parseTranscript(await fs.readFile(f.path, "utf8"), { fileId: path.basename(f.path, ".jsonl"), mtimeMs: f.mtimeMs });
    if (parsed) sessions.push(parsed);
  }
  return {
    sessions,
    remember: () => {
      for (const f of files) memory.set(f.path, `${f.mtimeMs}:${f.size}`);
    },
  };
}
