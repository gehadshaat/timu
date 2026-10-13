"use server";

import { revalidatePath } from "next/cache";
import { rejudgeSession, type RejudgeResult } from "@/lib/rejudge";

export type { RejudgeResult } from "@/lib/rejudge";

/** Ask the triage judge about one session again and open, update or close its ask to match. */
export async function rejudgeSessionAction(sessionId: string): Promise<RejudgeResult> {
  const r = await rejudgeSession(sessionId);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
