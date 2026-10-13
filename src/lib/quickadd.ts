import type { Priority } from "./types";

/**
 * Quick-add syntax for to-dos, one per line:
 *
 *   Write FAQ for the spring pages @Maya #sunbeam-web !high due:fri
 *
 *   @Name        assign to a teammate (@me = you)
 *   #project     file under a project (slug or name, unambiguous prefix is fine)
 *   !  !!  !high  high priority   ·  !low  low priority
 *   due:…  by:…  today, tomorrow, mon…sun, nextweek, +3d, +2w, 2026-11-01, 11/1
 *
 * Bullets ("- ", "* ", "1. ", "[ ] ") are stripped, so a pasted checklist just works.
 * Tokens that don't match anything stay in the title and are reported in `unknown`.
 */

export interface QuickAddContext {
  agents: { id: string; name: string }[];
  projects: { id: string; name: string; slug?: string }[];
}

export interface QuickAddItem {
  title: string;
  /** undefined = not given (use the default); null = explicitly you (@me). */
  agentId?: string | null;
  projectId?: string;
  priority?: Priority;
  /** YYYY-MM-DD */
  dueDate?: string;
  unknown: string[];
}

/** A list marker ("- ", "* ", "1. ") and/or a checkbox ("[ ] ", "[x] "), in either order. */
const BULLET = /^\s*(?:(?:[-*•‣◦]|\d+[.)])\s+)?(?:\[\s?[xX ]?\s?\]\s+)?/;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

/** Parse the value of a due: token. Returns YYYY-MM-DD or null when not understood. */
export function parseDue(raw: string, today: Date): string | null {
  const v = raw.toLowerCase().trim();
  if (!v) return null;
  if (v === "today" || v === "tod") return isoDate(today);
  if (v === "tomorrow" || v === "tmrw" || v === "tom") return isoDate(addDays(today, 1));
  if (v === "nextweek" || v === "next-week") {
    const toMonday = (8 - today.getDay()) % 7 || 7;
    return isoDate(addDays(today, toMonday));
  }
  const rel = v.match(/^\+(\d{1,3})([dw])$/);
  if (rel) return isoDate(addDays(today, Number(rel[1]) * (rel[2] === "w" ? 7 : 1)));
  const dayIdx = DAYS.findIndex((d) => v.startsWith(d) && d.startsWith(v.slice(0, 3)));
  if (dayIdx >= 0 && /^[a-z]+$/.test(v)) return isoDate(addDays(today, (dayIdx - today.getDay() + 7) % 7));
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return isoDate(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const md = v.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    let d = new Date(today.getFullYear(), Number(md[1]) - 1, Number(md[2]));
    if (d < addDays(today, -1)) d = new Date(today.getFullYear() + 1, Number(md[1]) - 1, Number(md[2]));
    return isoDate(d);
  }
  return null;
}

function findAgent(token: string, ctx: QuickAddContext): string | null | undefined {
  const t = norm(token);
  if (!t) return undefined;
  if (t === "me" || t === "myself" || t === "you") return null;
  const exact = ctx.agents.filter((a) => norm(a.name) === t);
  if (exact.length === 1) return exact[0].id;
  const prefix = ctx.agents.filter((a) => norm(a.name).startsWith(t));
  return prefix.length === 1 ? prefix[0].id : undefined;
}

function findProject(token: string, ctx: QuickAddContext): string | undefined {
  const t = norm(token);
  if (!t) return undefined;
  const keys = (p: QuickAddContext["projects"][number]) => [norm(p.name), norm(p.slug ?? "")].filter(Boolean);
  const exact = ctx.projects.filter((p) => keys(p).includes(t));
  if (exact.length === 1) return exact[0].id;
  const prefix = ctx.projects.filter((p) => keys(p).some((k) => k.startsWith(t)));
  return prefix.length === 1 ? prefix[0].id : undefined;
}

export function parseQuickAddLine(line: string, ctx: QuickAddContext, today = new Date()): QuickAddItem | null {
  const text = line.replace(BULLET, "").trim();
  if (!text) return null;
  const item: QuickAddItem = { title: "", unknown: [] };
  const words: string[] = [];

  for (const word of text.split(/\s+/)) {
    if (/^@\S+/.test(word)) {
      const found = findAgent(word.slice(1), ctx);
      if (found !== undefined) {
        item.agentId = found;
        continue;
      }
      item.unknown.push(word);
    } else if (/^#\S+/.test(word)) {
      const found = findProject(word.slice(1), ctx);
      if (found) {
        item.projectId = found;
        continue;
      }
      item.unknown.push(word);
    } else if (/^!{1,3}$/.test(word) || /^!(high|h|urgent)$/i.test(word)) {
      item.priority = "high";
      continue;
    } else if (/^!(low|l)$/i.test(word)) {
      item.priority = "low";
      continue;
    } else if (/^!(normal|n|med|medium)$/i.test(word)) {
      item.priority = "normal";
      continue;
    } else if (/^(due|by):\S+$/i.test(word)) {
      const due = parseDue(word.slice(word.indexOf(":") + 1), today);
      if (due) {
        item.dueDate = due;
        continue;
      }
      item.unknown.push(word);
    }
    words.push(word);
  }

  item.title = words.join(" ").trim();
  return item.title ? item : null;
}

/** Parse a pasted block: one to-do per non-empty line. */
export function parseQuickAdd(text: string, ctx: QuickAddContext, today = new Date()): QuickAddItem[] {
  return text
    .split(/\r?\n/)
    .map((l) => parseQuickAddLine(l, ctx, today))
    .filter((x): x is QuickAddItem => !!x);
}

/** Plain list parsing for milestones / goals: strip bullets, drop blanks, de-duplicate. */
export function parseLines(text: string, max = 200): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(BULLET, "").trim();
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line.slice(0, 300));
    if (out.length >= max) break;
  }
  return out;
}

/** "Maya — SEO Lead", "Maya - SEO Lead", "Maya: SEO Lead", "Maya, SEO Lead" → { name, role }. */
export function parsePersonLine(line: string): { name: string; role: string } | null {
  const text = line.replace(BULLET, "").trim();
  if (!text) return null;
  const m = text.match(/^(.+?)\s*(?:—|–|-|:|,|\|)\s*(.+)$/);
  if (!m) return { name: text, role: "Teammate" };
  return { name: m[1].trim(), role: m[2].trim() };
}
