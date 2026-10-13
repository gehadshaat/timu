import "server-only";
import { McpServer } from "@modelcontextprotocol/server";
import { registerBulkTools } from "./tools/bulk";
import { registerNoteTools } from "./tools/notes";
import { registerOrgTools } from "./tools/org";
import { registerReadTools } from "./tools/read";
import { registerRoutineTools } from "./tools/routines";
import { registerSessionTools } from "./tools/sessions";
import { registerWorkTools } from "./tools/work";

const INSTRUCTIONS = `Timu organises the user's Claude sessions like a small company.

- Companies contain projects. A project has teams, goals (with milestones) and to-dos.
- Teams have teammates: cartoon personas with a role. Every imported Claude session is owned by one teammate; sessions with no owner are "unfiled".
- The inbox holds asks: sessions waiting on the user (respond, review, decide, unblock, run). Triage rules decide which sessions genuinely need the user.

Start with get_org for the structure and ids. Tools take an id, a slug or an exact name; qualify repeated names as "Project / Team" or "Team / Name". Sessions can also be named by their Claude session id or claude.ai URL.

To organise: list_sessions with unfiled=true, create the companies, projects, teams and teammates that are missing, then assign_sessions. Deleting a project or team asks what happens to its sessions (unfile, refile or move).

For many things at once use the bulk tools: handle_asks, move_sessions, archive_sessions, refile_sessions, add_todos (one per line, with @person #project !high due:fri), update_todos, add_goals, add_milestones, hire_teammates, move_teammates, move_projects. Changes that can be undone return an undo_id; pass it to undo. search finds anything by name; comments (list_comments, add_comment) hold notes and decisions on any company, project, team, teammate, goal, session or to-do.`;

/** A fresh Timu MCP server. Built per request over HTTP and once per connection over stdio. */
export function createTimuMcp(): McpServer {
  const server = new McpServer({ name: "timu", title: "Timu", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  registerReadTools(server);
  registerOrgTools(server);
  registerWorkTools(server);
  registerSessionTools(server);
  registerBulkTools(server);
  registerNoteTools(server);
  registerRoutineTools(server);
  return server;
}
