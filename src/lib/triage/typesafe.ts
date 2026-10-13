import "server-only";
import type { Verdict } from "../types";
import type { TriageInput } from "./rules";

/**
 * TypeSafe AI Jev: a small decision model that answers typed questions about a state.
 * We ask one yes/no ("does the person need to act?") and one choice (what kind of action).
 */
export function typesafeConfigured(): boolean {
  return !!process.env.TYPESAFE_API_KEY;
}

const KINDS = {
  none: "Nothing is needed from the person",
  respond: "Answer a question the session asked",
  review: "Review or test finished work",
  decide: "Choose between options the session laid out",
  unblock: "Fix something only the person can (run a migration, grant access, provide credentials, resolve a failure)",
};

export async function typesafeJudge(input: TriageInput, memory: string[]): Promise<Verdict> {
  const url = process.env.TYPESAFE_API_URL || "https://api.typesafe.ai/v1/systemone";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.TYPESAFE_MODEL || "jev-latest",
      state: { session: input, my_rules: memory },
      questions: {
        needs_user: {
          type: "noul",
          instructions: "Following my_rules, does the person genuinely need to do something about this session right now?",
          criteria: {
            true: "There is a concrete pending action only the person can take.",
            false: "Nothing is pending for the person: the work finished cleanly, is still running, or the message is just a sign-off.",
          },
        },
        kind: { type: "choice", instructions: "If action is needed, what kind?", criteria: KINDS },
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`TypeSafe returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const json = (await res.json()) as {
    answers?: { needs_user?: { noul?: number }; kind?: { choice?: string; confidence?: number } };
  };
  const p = json.answers?.needs_user?.noul;
  if (typeof p !== "number") throw new Error("TypeSafe answer missing needs_user");
  const choice = (json.answers?.kind?.choice ?? "none") as Verdict["kind"];
  const needed = p >= 0.5;
  return {
    needed,
    kind: needed ? (choice === "none" ? "respond" : choice) : "none",
    confidence: needed ? p : 1 - p,
    engine: "typesafe",
    reason: needed ? `TypeSafe: ${Math.round(p * 100)}% likely needs you` : `TypeSafe: ${Math.round((1 - p) * 100)}% sure nothing is pending`,
    ask: needed ? input.needs_action ?? input.status_detail : null,
    at: new Date().toISOString(),
  };
}
