import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ActionResult } from "../ops";

/** read: never changes anything · write: creates or edits · destructive: deletes something */
export type ToolKind = "read" | "write" | "destructive";

const ANNOTATIONS = {
  read: { readOnlyHint: true, openWorldHint: false },
  write: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  destructive: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
} as const;

/**
 * Register one tool. `run` returns any JSON-able value (sent back as compact JSON) and
 * signals failure by throwing; the message goes back to Claude as a tool error.
 */
export function defineTool<S extends z.ZodObject>(
  server: McpServer,
  name: string,
  spec: { title: string; description: string; kind: ToolKind; input: S },
  run: (args: z.output<S>) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.input as z.ZodObject,
      annotations: { title: spec.title, ...ANNOTATIONS[spec.kind] },
    },
    // The SDK has already validated `args` against `spec.input`.
    async (args: unknown): Promise<CallToolResult> => {
      try {
        const data = await run(args as z.output<S>);
        return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }] };
      } catch (err) {
        return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
      }
    },
  );
}

/** Unwrap an ops result, throwing its message when it failed. */
export function expectOk<T extends ActionResult>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(r.message);
  return r as Extract<T, { ok: true }>;
}

// ---------- shared input fields ----------

export const ref = (what: string) => z.string().trim().min(1).describe(what);
export const COMPANY_REF = "Company id, slug or exact name";
export const PROJECT_REF = "Project id, slug or exact name";
export const TEAM_REF = "Team id or exact name; write 'Project / Team' when the name exists in several projects";
export const TEAMMATE_REF = "Teammate id or exact name; write 'Team / Name' when the name repeats";
export const GOAL_REF = "Goal id or exact title; write 'Project / Goal' when the title repeats";
export const SESSION_REF = "Session: Timu id, the Claude session id (e.g. session_01…), or its claude.ai URL";

export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("Date as YYYY-MM-DD");
export const priority = z.enum(["low", "normal", "high"]);
