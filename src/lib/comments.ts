import "server-only";
import { all, get, insert, isUuid, now } from "./db";
import { companyHref, personHref, projectHref, teamHref } from "./links";
import type { Org } from "./queries";

export type CommentEntity = "company" | "project" | "team" | "agent" | "goal" | "session" | "task";
export const COMMENT_ENTITIES: CommentEntity[] = ["company", "project", "team", "agent", "goal", "session", "task"];

export interface CommentRow {
  id: string;
  entity_type: CommentEntity;
  entity_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export async function getComments(type: CommentEntity, id: string): Promise<CommentRow[]> {
  return all<CommentRow>("select * from comments where entity_type = ? and entity_id = ? order by created_at", type, id);
}

/** Comment counts per entity id, for badges in lists. */
export async function getCommentCounts(type: CommentEntity, ids: string[]): Promise<Record<string, number>> {
  const rows = all<{ entity_id: string; n: number }>(
    "select entity_id, count(*) as n from comments where entity_type = ? and entity_id in (select value from json_each(?)) group by entity_id",
    type,
    [...new Set(ids)],
  );
  return Object.fromEntries(rows.map((r) => [r.entity_id, r.n]));
}

/** The most recent comments anywhere, newest first (for the digest). */
export async function getRecentComments(since: string, limit = 30): Promise<CommentRow[]> {
  return all<CommentRow>("select * from comments where created_at >= ? order by created_at desc limit ?", since, limit);
}

/** All comments for many entities of one type, keyed by entity id. */
export async function getCommentsMap(type: CommentEntity, ids: string[]): Promise<Record<string, CommentRow[]>> {
  const rows = all<CommentRow>(
    "select * from comments where entity_type = ? and entity_id in (select value from json_each(?)) order by created_at",
    type,
    [...new Set(ids)],
  );
  const out: Record<string, CommentRow[]> = {};
  for (const r of rows) (out[r.entity_id] ??= []).push(r);
  return out;
}

/** Comment counts for every entity of a type (comments are few, so one pass is cheap). */
export async function getAllCommentCounts(type: CommentEntity): Promise<Record<string, number>> {
  const rows = all<{ entity_id: string; n: number }>(
    "select entity_id, count(*) as n from comments where entity_type = ? group by entity_id",
    type,
  );
  return Object.fromEntries(rows.map((r) => [r.entity_id, r.n]));
}

/** Where each comment lives, as a label and a link — for the digest. */
export async function commentTargets(rows: CommentRow[], org: Org): Promise<Map<string, { label: string; href: string }>> {
  const out = new Map<string, { label: string; href: string }>();
  const sessionIds = rows.filter((r) => r.entity_type === "session").map((r) => r.entity_id);
  const sessions = sessionIds.length
    ? all<{ id: string; title: string }>("select id, title from sessions where id in (select value from json_each(?))", sessionIds)
    : [];
  const todoIds = rows.filter((r) => r.entity_type === "task").map((r) => r.entity_id);
  const todos = todoIds.length
    ? all<{ id: string; title: string }>("select id, title from tasks where id in (select value from json_each(?))", todoIds)
    : [];
  for (const r of rows) {
    const id = r.entity_id;
    let t: { label: string; href: string } | null = null;
    if (r.entity_type === "session") {
      const s = sessions.find((x) => x.id === id);
      if (s) t = { label: `💬 ${s.title}`, href: `/sessions/${id}#comments` };
    } else if (r.entity_type === "company") {
      const c = org.companies.find((x) => x.id === id);
      if (c) t = { label: `${c.emoji} ${c.name}`, href: `${companyHref(c.slug)}#comments` };
    } else if (r.entity_type === "project") {
      const p = org.projects.find((x) => x.id === id);
      if (p) t = { label: `${p.emoji} ${p.name}`, href: `${projectHref(p.slug)}#comments` };
    } else if (r.entity_type === "team") {
      const tm = org.teams.find((x) => x.id === id);
      if (tm) t = { label: `👥 ${tm.name}`, href: `${teamHref(id)}#comments` };
    } else if (r.entity_type === "agent") {
      const a = org.agents.find((x) => x.id === id);
      if (a) t = { label: `🧑 ${a.name}`, href: `${personHref(id)}#comments` };
    } else if (r.entity_type === "goal") {
      const g = org.goals.find((x) => x.id === id);
      const p = org.projects.find((x) => x.id === g?.project_id);
      if (g && p) t = { label: `🎯 ${g.title}`, href: `${projectHref(p.slug)}#goal-${id}` };
    } else if (r.entity_type === "task") {
      const td = todos.find((x) => x.id === id);
      if (td) t = { label: `✅ ${td.title}`, href: "/todos" };
    }
    if (t) out.set(r.id, t);
  }
  return out;
}

// ---------- writing ----------

export interface CommentResult {
  ok: boolean;
  message: string;
  comment?: CommentRow;
}

const MAX_BODY = 10_000;

function cleanBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY);
}

export async function addComment(type: CommentEntity, id: string, body: string): Promise<CommentResult> {
  const text = cleanBody(body);
  if (!text) return { ok: false, message: "Write something first." };
  if (!COMMENT_ENTITIES.includes(type) || !isUuid(id)) return { ok: false, message: "Couldn't find that." };
  try {
    const [comment] = insert<CommentRow>("comments", { entity_type: type, entity_id: id, body: text });
    return { ok: true, message: "Comment added.", comment };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function editComment(commentId: string, body: string): Promise<CommentResult> {
  const text = cleanBody(body);
  if (!text) return { ok: false, message: "A comment can't be empty — delete it instead." };
  if (!isUuid(commentId)) return { ok: false, message: "Couldn't find that comment." };
  try {
    const comment = get<CommentRow>("update comments set body = ?, updated_at = ? where id = ? returning *", text, now(), commentId);
    if (!comment) return { ok: false, message: "Couldn't find that comment." };
    return { ok: true, message: "Saved.", comment };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Delete a comment; returns it so the client can offer Undo (re-adding it). */
export async function deleteComment(commentId: string): Promise<CommentResult> {
  if (!isUuid(commentId)) return { ok: false, message: "Couldn't find that comment." };
  try {
    const rows = all<CommentRow>("delete from comments where id = ? returning *", commentId);
    if (!rows.length) return { ok: false, message: "Couldn't find that comment." };
    return { ok: true, message: "Comment deleted.", comment: rows[0] };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Put a deleted comment back exactly as it was (Undo). */
export async function restoreComment(comment: CommentRow): Promise<CommentResult> {
  if (!isUuid(comment?.id) || !COMMENT_ENTITIES.includes(comment.entity_type) || !isUuid(comment.entity_id)) {
    return { ok: false, message: "Nothing to restore." };
  }
  try {
    const [restored] = insert<CommentRow>(
      "comments",
      {
        id: comment.id,
        entity_type: comment.entity_type,
        entity_id: comment.entity_id,
        body: cleanBody(comment.body),
        created_at: comment.created_at,
        updated_at: comment.updated_at,
      },
      { on: "id", do: "update" },
    );
    return { ok: true, message: "Restored.", comment: restored };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
