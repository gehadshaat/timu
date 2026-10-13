import "server-only";
import { all, get } from "../db";
import type { SessionRow } from "../types";
import { isUuid, sessionKey } from "./resolve";

export type FullSession = SessionRow & { raw: Record<string, unknown> };

/** Load sessions by Timu id, source id or URL, in the order given. Throws naming any that don't exist. */
export async function findSessions(refs: string[]): Promise<FullSession[]> {
  const keys = [...new Set(refs.map(sessionKey))];
  const ids = keys.filter(isUuid);
  const byExternal = all<FullSession>("select * from sessions where external_id in (select value from json_each(?))", keys);
  const byId = ids.length ? all<FullSession>("select * from sessions where id in (select value from json_each(?))", ids) : [];
  const found = new Map<string, FullSession>();
  for (const s of byExternal) found.set(s.external_id, s);
  for (const s of byId) found.set(s.id, s);
  const missing = keys.filter((k) => !found.has(k));
  if (missing.length) {
    throw new Error(`No session matches ${missing.map((m) => `"${m}"`).join(", ")}. Find sessions with list_sessions.`);
  }
  return keys.map((k) => found.get(k)!);
}

/** One row by uuid, or a clear error when it doesn't exist. */
export async function rowById<T>(table: string, id: string, what: string): Promise<T> {
  if (!isUuid(id)) throw new Error(`"${id}" isn't a ${what} id.`);
  const row = get(`select * from ${table} where id = ?`, id);
  if (!row) throw new Error(`No ${what} with id ${id}.`);
  return row as T;
}
