import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { anthropic } from "../anthropic";
import type { Verdict } from "../types";
import type { TriageInput } from "./rules";

/** Cheap, fast judge: Claude Haiku 5.5 at low effort, many sessions per call. */
const MODEL = "claude-haiku-5-5";
const BATCH = 25;

const Schema = z.object({
  verdicts: z.array(
    z.object({
      id: z.string(),
      needed: z.boolean(),
      kind: z.enum(["none", "respond", "review", "decide", "unblock"]),
      confidence: z.number().describe("0 to 1"),
      ask: z.string().nullable().describe("When needed: the specific thing to do, as a short imperative"),
      reason: z.string().describe("A few words on why"),
    }),
  ),
});

export async function claudeJudge(inputs: TriageInput[], memory: string[]): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  for (let i = 0; i < inputs.length; i += BATCH) {
    const batch = inputs.slice(i, i + BATCH);
    const res = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low", format: zodOutputFormat(Schema) },
      system:
        "You triage a person's AI work sessions. For each session decide whether the person genuinely needs to do something now. " +
        "Follow the person's rules exactly; when in doubt and nothing concrete is asked of them, say not needed.\n\nThe person's rules:\n" +
        memory.map((m) => `- ${m}`).join("\n"),
      messages: [{ role: "user", content: `Sessions:\n${JSON.stringify(batch)}\n\nReturn one verdict per session id.` }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`Haiku triage failed (stop_reason: ${res.stop_reason})`);
    const at = new Date().toISOString();
    for (const v of res.parsed_output.verdicts) {
      if (!batch.some((b) => b.id === v.id)) continue;
      out.set(v.id, {
        needed: v.needed,
        kind: v.needed ? (v.kind === "none" ? "respond" : v.kind) : "none",
        confidence: Math.max(0, Math.min(1, v.confidence)),
        engine: "claude",
        reason: v.reason,
        ask: v.needed ? v.ask : null,
        at,
      });
    }
  }
  return out;
}
