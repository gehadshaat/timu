import "server-only";
import type { UndoSnapshot } from "./bulk";
import { getSetting, setSetting } from "./db";

/**
 * The last few undoable changes made through the MCP server. Tools hand back an `undo_id`
 * instead of the (possibly large) snapshot; the `undo` tool takes it back out. The UI keeps
 * its snapshots in the toast instead.
 */

const KEY = "undo_log";
const KEEP = 10;

export interface UndoEntry {
  id: string;
  at: string;
  label: string;
  snapshot: UndoSnapshot;
}

const hasContent = (s: UndoSnapshot) => Object.values(s).some((v) => Array.isArray(v) && v.length > 0);

/** Remember a snapshot; returns its id, or undefined when there's nothing to undo. */
export async function rememberUndo(label: string, snapshot: UndoSnapshot | undefined): Promise<string | undefined> {
  if (!snapshot || !hasContent(snapshot)) return undefined;
  const log = (await getSetting<UndoEntry[]>(KEY)) ?? [];
  const entry: UndoEntry = { id: crypto.randomUUID(), at: new Date().toISOString(), label, snapshot };
  await setSetting(KEY, [entry, ...log].slice(0, KEEP));
  return entry.id;
}

export async function getUndo(id: string): Promise<UndoEntry | null> {
  return ((await getSetting<UndoEntry[]>(KEY)) ?? []).find((e) => e.id === id) ?? null;
}

/** Forget a snapshot once it has been applied (each change can be undone once). */
export async function dropUndo(id: string): Promise<void> {
  const log = (await getSetting<UndoEntry[]>(KEY)) ?? [];
  await setSetting(KEY, log.filter((e) => e.id !== id));
}

/** What can still be undone, newest first. */
export async function listUndo(): Promise<{ undo_id: string; at: string; change: string }[]> {
  const log = (await getSetting<UndoEntry[]>(KEY)) ?? [];
  return log.map((e) => ({ undo_id: e.id, at: e.at, change: e.label }));
}
