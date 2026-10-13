import "server-only";
import { all } from "./db";

export function slugBase(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || fallback
  );
}

/** `prefix` with LIKE's wildcards escaped, for `like ? escape '\\'`. */
export const likePrefix = (prefix: string): string => prefix.replace(/[\\%_]/g, "\\$&");

/** A slug for `name` that no other row in `table` uses (`exceptId` = the row being renamed). */
export async function uniqueSlug(table: "companies" | "projects", name: string, exceptId?: string): Promise<string> {
  const base = slugBase(name, table.slice(0, -1));
  const rows = all<{ id: string; slug: string }>(`select id, slug from ${table} where slug like ? escape '\\'`, `${likePrefix(base)}%`);
  const taken = new Set(rows.filter((r) => r.id !== exceptId).map((r) => r.slug));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
