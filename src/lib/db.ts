import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";

/**
 * node:sqlite prints "ExperimentalWarning: SQLite is an experimental feature" once per process, and
 * Next.js dev starts many processes. Load it with that one warning muted; every other warning still prints.
 */
function loadSqlite(): typeof import("node:sqlite") {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const type = typeof rest[0] === "string" ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
    const message = typeof warning === "string" ? warning : warning.message;
    if (type === "ExperimentalWarning" && /SQLite/.test(message)) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
}
const sqlite = loadSqlite();

/**
 * Timu's database: one SQLite file, queried with raw SQL.
 *
 * - `all`, `get` and `run` take SQL with `?` placeholders. Booleans, objects and arrays in params are
 *   encoded (0/1, JSON text); columns declared `json` or `boolean` in db/schema.sql are decoded on read.
 * - For `id in (…)` pass the array as one param: `where id in (select value from json_each(?))`.
 * - Everything is synchronous (node:sqlite). `tx` runs a function in one transaction.
 *
 * The file lives at TIMU_DB_PATH (default data/timu.db). The schema is created on first open, and any
 * db/migrations/NNNN_*.sql newer than PRAGMA user_version is applied in order.
 */

export type Param = SQLInputValue | boolean | Record<string, unknown> | unknown[] | undefined;
export type Row = Record<string, unknown>;

let conn: DatabaseSync | null = null;

function dbDir(): string {
  return path.join(process.cwd(), "db");
}

export function dbPath(): string {
  return process.env.TIMU_DB_PATH || path.join(process.cwd(), "data", "timu.db");
}

/** Open (and if needed create or migrate) a database file. Exported for tests and setup. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new sqlite.DatabaseSync(file);
  d.exec("pragma journal_mode = wal; pragma busy_timeout = 5000; pragma foreign_keys = on;");
  migrate(d);
  return d;
}

function migrate(d: DatabaseSync) {
  const version = (d.prepare("pragma user_version").get() as { user_version: number }).user_version;
  const steps: { version: number; sql: string }[] = [];
  if (version < 1) steps.push({ version: 1, sql: fs.readFileSync(path.join(dbDir(), "schema.sql"), "utf8") });
  const migrations = path.join(dbDir(), "migrations");
  if (fs.existsSync(migrations)) {
    for (const f of fs.readdirSync(migrations).sort()) {
      const n = Number(f.match(/^(\d+)_.*\.sql$/)?.[1]);
      if (n > Math.max(version, 1)) steps.push({ version: n, sql: fs.readFileSync(path.join(migrations, f), "utf8") });
    }
  }
  for (const step of steps) {
    d.exec("begin");
    try {
      d.exec(step.sql);
      d.exec(`pragma user_version = ${step.version}`);
      d.exec("commit");
    } catch (err) {
      d.exec("rollback");
      throw err;
    }
  }
}

export function db(): DatabaseSync {
  if (!conn) conn = openDatabase(dbPath());
  return conn;
}

/** Point the module at another database (tests use ":memory:"). */
export function useDatabase(d: DatabaseSync | null): void {
  conn = d;
}

const statements = new Map<string, StatementSync>();
function prepare(sql: string): StatementSync {
  const d = db();
  let s = statements.get(sql);
  if (!s || (s as StatementSync & { __db?: DatabaseSync }).__db !== d) {
    s = d.prepare(sql);
    (s as StatementSync & { __db?: DatabaseSync }).__db = d;
    statements.set(sql, s);
  }
  return s;
}

function encode(v: Param): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === "object" && !ArrayBuffer.isView(v)) return JSON.stringify(v);
  return v as SQLInputValue;
}

function decoder(s: StatementSync): ((row: Row) => Row) | null {
  const cols = s.columns().filter((c) => c.type === "json" || c.type === "boolean");
  if (!cols.length) return null;
  return (row) => {
    for (const c of cols) {
      const v = row[c.name];
      if (v === null || v === undefined) continue;
      row[c.name] = c.type === "boolean" ? v === 1 || v === 1n : JSON.parse(v as string);
    }
    return row;
  };
}

/** Every row of a query. */
export function all<T = Row>(sql: string, ...params: Param[]): T[] {
  const s = prepare(sql);
  const rows = s.all(...params.map(encode)).map((r) => ({ ...r }) as Row);
  const dec = decoder(s);
  return (dec ? rows.map(dec) : rows) as T[];
}

/** The first row of a query, or null. */
export function get<T = Row>(sql: string, ...params: Param[]): T | null {
  const s = prepare(sql);
  const row = s.get(...params.map(encode));
  if (!row) return null;
  const dec = decoder(s);
  return (dec ? dec({ ...row }) : { ...row }) as T;
}

/** The first column of the first row, e.g. `select count(*) …`. */
export function scalar<T = number>(sql: string, ...params: Param[]): T {
  const row = prepare(sql).get(...params.map(encode));
  return (row ? Object.values(row)[0] : null) as T;
}

/** An insert/update/delete. Returns how many rows changed. */
export function run(sql: string, ...params: Param[]): number {
  return Number(prepare(sql).run(...params.map(encode)).changes);
}

let depth = 0;
/** Run `fn` in a transaction (nested calls join the outer one). `fn` must be synchronous. */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  const d = db();
  d.exec("begin immediate");
  depth++;
  try {
    const out = fn();
    d.exec("commit");
    return out;
  } catch (err) {
    d.exec("rollback");
    throw err;
  } finally {
    depth--;
  }
}

export const newId = (): string => randomUUID();
export const now = (): string => new Date().toISOString();

/**
 * `insert into table (cols) values (…) returning *` for one row or many; rows without an `id` get one.
 * `conflict` adds an `on conflict (…)` clause: "nothing" skips duplicates, "update" overwrites the given
 * columns. Returns the inserted (or updated) rows; skipped duplicates are left out.
 */
export function insert<T = Row>(
  table: string,
  rows: Row | Row[],
  conflict?: { on: string; do: "nothing" | "update" },
): T[] {
  const list = Array.isArray(rows) ? rows : [rows];
  return tx(() =>
    list.flatMap((r) => {
      const row = "id" in r || table === "settings" ? r : { id: newId(), ...r };
      const cols = Object.keys(row).filter((c) => row[c] !== undefined);
      let sql = `insert into ${table} (${cols.join(", ")}) values (${cols.map(() => "?").join(", ")})`;
      if (conflict) {
        const keys = conflict.on.split(",").map((c) => c.trim());
        const set = cols.filter((c) => !keys.includes(c) && c !== "id");
        sql +=
          conflict.do === "nothing" || !set.length
            ? ` on conflict (${conflict.on}) do nothing`
            : ` on conflict (${conflict.on}) do update set ${set.map((c) => `${c} = excluded.${c}`).join(", ")}`;
      }
      return all<T>(`${sql} returning *`, ...cols.map((c) => row[c] as Param));
    }),
  );
}

/** `update table set … where <where>`; returns how many rows changed. */
export function update(table: string, values: Row, where: string, ...params: Param[]): number {
  const cols = Object.keys(values).filter((c) => values[c] !== undefined);
  if (!cols.length) return 0;
  return run(`update ${table} set ${cols.map((c) => `${c} = ?`).join(", ")} where ${where}`, ...cols.map((c) => values[c] as Param), ...params);
}

export function getSetting<T>(key: string): T | null {
  return get<{ value: T }>("select value from settings where key = ?", key)?.value ?? null;
}

export function setSetting(key: string, value: unknown): void {
  run(
    "insert into settings (key, value, updated_at) values (?, ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at",
    key,
    JSON.stringify(value),
    now(),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids that arrive from the browser: keep only well-formed UUIDs, de-duplicated, capped. */
export function cleanIds(ids: unknown, max = 5000): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, max);
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
