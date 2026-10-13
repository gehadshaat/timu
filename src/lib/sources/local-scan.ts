import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NormalizedSession } from "../types";
import { parseTranscript } from "./local";

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

/** Reads every top-level transcript (subagent transcripts live in subfolders and are skipped). */
export async function scanLocalTranscripts(dir = localProjectsDir()): Promise<NormalizedSession[]> {
  const out: NormalizedSession[] = [];
  const projects = await fs.readdir(dir, { withFileTypes: true });
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const projectDir = path.join(dir, p.name);
    for (const file of await fs.readdir(projectDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const full = path.join(projectDir, file);
      const [stat, text] = await Promise.all([fs.stat(full), fs.readFile(full, "utf8")]);
      const parsed = parseTranscript(text, { fileId: file.replace(/\.jsonl$/, ""), mtimeMs: stat.mtimeMs });
      if (parsed) out.push(parsed);
    }
  }
  return out;
}
