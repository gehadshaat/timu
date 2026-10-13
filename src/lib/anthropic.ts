import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Shared Anthropic client. Org-level API keys must name the workspace on every request. */
export function anthropic(): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
}

export function hasClaudeKey(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
