/** 0..1 — finished milestones, done sessions and done to-dos over all of them. */
export function goalProgress(milestones: { done: boolean }[], sessions: { status: string }[], todos: { status: string }[]): number {
  const total = milestones.length + sessions.length + todos.length;
  if (!total) return 0;
  const done =
    milestones.filter((m) => m.done).length +
    sessions.filter((s) => s.status === "done").length +
    todos.filter((t) => t.status === "done").length;
  return done / total;
}
