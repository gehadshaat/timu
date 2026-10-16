import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { pushToClickUp } from "../../clickup/mirror";
import { defineTool } from "../tool";

export function registerClickUpTools(server: McpServer): void {
  defineTool(
    server,
    "push_to_clickup",
    {
      title: "Push to ClickUp",
      kind: "write",
      description:
        "Mirror the org into ClickUp now instead of waiting for the next sync: a folder per project, a list per team plus Goals and To-dos lists, and a task per session, goal, milestone and to-do. Sends only what changed since the last push. Returns what was created, updated, moved and archived, and how many changes are left if it stopped early (ClickUp's rate limit). Needs CLICKUP_API_TOKEN; get_settings → clickup says whether it's on.",
      input: z.object({}),
    },
    async () => {
      const r = await pushToClickUp();
      if (!r.ok) throw new Error(r.message);
      return { message: r.message, created: r.created, updated: r.updated, moved: r.moved, archived: r.archived, left: r.left };
    },
  );
}
