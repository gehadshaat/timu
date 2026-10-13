/** Triage memory: plain-language rules the judge reads before deciding. Stored in settings. */
export interface MemoryItem {
  id: string;
  text: string;
  /** default = shipped with Timu, you = written by you, learned = saved from a "Not needed" click */
  source: "default" | "you" | "learned";
  created_at: string;
}

export const MEMORY_KEY = "triage_memory";

const stamp = "2026-10-14T00:00:00.000Z";

export const DEFAULT_MEMORY: MemoryItem[] = [
  { id: "d1", source: "default", created_at: stamp, text: "A merged or closed PR with no follow-up items needs no action from me." },
  { id: "d2", source: "default", created_at: stamp, text: "A session that is still working doesn't need me unless it asked me a question." },
  {
    id: "d3",
    source: "default",
    created_at: stamp,
    text: "It needs me when it asks me to approve, choose, review, test, run something (like a migration), or provide access or credentials.",
  },
  { id: "d4", source: "default", created_at: stamp, text: "Polite sign-offs like 'let me know if you need anything else' are not a real question." },
];
