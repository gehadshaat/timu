import "server-only";
import { get, isUuid, update } from "./db";
import { uniqueSlug } from "./slugs";

/** Everything that can be renamed in place. */
export type RenameKind = "company" | "project" | "team" | "agent" | "goal" | "session" | "milestone" | "todo";

export interface RenameResult {
  ok: boolean;
  message: string;
  name?: string;
  /** Companies and projects are addressed by slug; a new name means a new URL. */
  slug?: string;
}

const TABLE = {
  company: "companies",
  project: "projects",
  team: "teams",
  agent: "agents",
  goal: "goals",
  session: "sessions",
  milestone: "goal_milestones",
  todo: "tasks",
} as const;

const COLUMN: Record<RenameKind, "name" | "title"> = {
  company: "name",
  project: "name",
  team: "name",
  agent: "name",
  goal: "title",
  session: "title",
  milestone: "title",
  todo: "title",
};

const DUPLICATE: Partial<Record<RenameKind, string>> = {
  team: "This project already has a team with that name.",
  agent: "This team already has someone with that name.",
};

/** Rename one thing in place. Companies and projects get a new slug when their name changes. */
export async function renameEntity(kind: RenameKind, id: string, name: string): Promise<RenameResult> {
  const value = name.replace(/\s+/g, " ").trim().slice(0, COLUMN[kind] === "name" ? 120 : 300);
  if (!value) return { ok: false, message: "The name can't be empty." };
  if (!isUuid(id) || !(kind in TABLE)) return { ok: false, message: "Couldn't find that." };
  const values: Record<string, unknown> = { [COLUMN[kind]]: value };
  let slug: string | undefined;
  try {
    if (kind === "company" || kind === "project") {
      const table = TABLE[kind];
      const current = get<{ name: string; slug: string }>(`select name, slug from ${table} where id = ?`, id);
      if (!current) return { ok: false, message: "Couldn't find that." };
      // Keep URLs stable unless the name actually changed.
      slug = current.name === value ? current.slug : await uniqueSlug(table, value, id);
      values.slug = slug;
    }
    // A renamed session keeps your title through later syncs.
    if (kind === "session") values.title_locked = true;
    update(TABLE[kind], values, kind === "todo" ? "id = ? and origin = 'manual'" : "id = ?", id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg.includes("UNIQUE constraint failed") ? (DUPLICATE[kind] ?? "That name is already taken.") : msg };
  }
  return { ok: true, message: "Renamed.", name: value, slug };
}
