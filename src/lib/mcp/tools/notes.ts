import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { addComment, deleteComment, editComment, getComments, type CommentEntity, type CommentRow } from "../../comments";
import { getOrg } from "../../queries";
import { rejudgeSession } from "../../rejudge";
import { rankSearch } from "../../search";
import { buildSearchIndex } from "../../search-index";
import type { TaskRow } from "../../types";
import { rememberUndo } from "../../undo-log";
import { findSessions, rowById } from "../lookup";
import { resolveCompany, resolveGoal, resolveProject, resolveTeam, resolveTeammate } from "../resolve";
import { defineTool, ref, SESSION_REF } from "../tool";

/** What a comment can be on, as tools name it, and how it's stored. */
const ON = z.enum(["company", "project", "team", "teammate", "goal", "session", "todo"]);
type On = z.infer<typeof ON>;
const ENTITY: Record<On, CommentEntity> = { company: "company", project: "project", team: "team", teammate: "agent", goal: "goal", session: "session", todo: "task" };

const TARGET_HELP =
  "The thing it's on, matching `on`: an id, slug or exact name (qualify repeated names as 'Project / Team'); a session also takes its Claude session id or URL; a to-do takes its id";

/** Resolve the thing a comment is on to its stored id. */
async function targetId(on: On, target: string): Promise<string> {
  if (on === "session") return (await findSessions([target]))[0].id;
  if (on === "todo") {
    const t = await rowById<TaskRow>("tasks", target, "to-do");
    if (t.origin !== "manual") throw new Error("That's an inbox ask, not a to-do. Comment on its session instead.");
    return t.id;
  }
  const org = await getOrg();
  if (on === "company") return resolveCompany(org, target).id;
  if (on === "project") return resolveProject(org, target).id;
  if (on === "team") return resolveTeam(org, target).id;
  if (on === "teammate") return resolveTeammate(org, target).id;
  return resolveGoal(org, target).id;
}

const brief = (c: CommentRow) => ({ id: c.id, body: c.body, created_at: c.created_at, ...(c.updated_at !== c.created_at ? { edited_at: c.updated_at } : {}) });

export function registerNoteTools(server: McpServer): void {
  // ---------- comments ----------

  defineTool(
    server,
    "list_comments",
    {
      title: "List comments",
      kind: "read",
      description: "The comment thread on a company, project, team, teammate, goal, session or to-do, oldest first.",
      input: z.object({ on: ON, target: ref(TARGET_HELP) }),
    },
    async ({ on, target }) => {
      const comments = await getComments(ENTITY[on], await targetId(on, target));
      return { count: comments.length, comments: comments.map(brief) };
    },
  );

  defineTool(
    server,
    "add_comment",
    {
      title: "Add comment",
      kind: "write",
      description: "Leave a note on a company, project, team, teammate, goal, session or to-do — a decision, context, a link. The user sees it on that page and in the digest.",
      input: z.object({ on: ON, target: ref(TARGET_HELP), body: ref("The comment (plain text; links become clickable)") }),
    },
    async ({ on, target, body }) => {
      const r = await addComment(ENTITY[on], await targetId(on, target), body);
      if (!r.ok || !r.comment) throw new Error(r.message);
      return { message: "Comment added.", comment: brief(r.comment) };
    },
  );

  defineTool(
    server,
    "update_comment",
    {
      title: "Edit comment",
      kind: "write",
      description: "Rewrite a comment (ids from list_comments).",
      input: z.object({ comment_id: ref("Comment id (from list_comments)"), body: ref("The new text") }),
    },
    async ({ comment_id, body }) => {
      const r = await editComment(comment_id, body);
      if (!r.ok || !r.comment) throw new Error(r.message);
      return { message: "Saved.", comment: brief(r.comment) };
    },
  );

  defineTool(
    server,
    "delete_comment",
    {
      title: "Delete comment",
      kind: "destructive",
      description: "Delete a comment (ids from list_comments). Returns an undo_id that puts it back.",
      input: z.object({ comment_id: ref("Comment id (from list_comments)") }),
    },
    async ({ comment_id }) => {
      const r = await deleteComment(comment_id);
      if (!r.ok || !r.comment) throw new Error(r.message);
      const undo_id = await rememberUndo("deleted a comment", { comments: [r.comment] });
      return { message: "Comment deleted.", deleted: brief(r.comment), ...(undo_id ? { undo_id } : {}) };
    },
  );

  // ---------- finding things ----------

  defineTool(
    server,
    "search",
    {
      title: "Search",
      kind: "read",
      description:
        "Find companies, projects, teams, teammates, goals, recent sessions, open to-dos and Timu's pages by name, best matches first. Use the returned id or name with the other tools.",
      input: z.object({ query: ref("Words to look for"), limit: z.number().int().min(1).max(50).default(15) }),
    },
    async ({ query, limit }) => {
      const hits = rankSearch(query, await buildSearchIndex(), limit);
      return {
        count: hits.length,
        results: hits.map((h) => ({ kind: h.kind === "person" ? "teammate" : h.kind, id: h.id, name: h.label, where: h.sublabel ?? null, page: h.href })),
      };
    },
  );

  // ---------- triage one session ----------

  defineTool(
    server,
    "recheck_session",
    {
      title: "Re-check one session",
      kind: "write",
      description:
        "Ask the triage judge again whether one session genuinely needs the user, now, and open, update or close its inbox ask to match. Returns the verdict. (recheck_open_asks does this for every open ask.)",
      input: z.object({ session: ref(SESSION_REF) }),
    },
    async ({ session }) => {
      const [s] = await findSessions([session]);
      const r = await rejudgeSession(s.id);
      if (!r.ok) throw new Error(r.message);
      return { message: r.message, needs_user: r.needed ?? false, session: { id: s.id, title: s.title } };
    },
  );
}
