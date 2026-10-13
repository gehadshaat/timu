"use client";

import { useState, useTransition } from "react";
import { createGoalAction, updateGoalAction, type GoalInput } from "@/app/actions";

const field = "rounded-lg border-0 bg-zinc-50 px-2 py-1.5 text-sm ring-1 ring-black/10";

export function GoalForm({
  projectId,
  goalId,
  teams,
  initial,
  onDone,
}: {
  projectId: string;
  goalId?: string;
  teams: { id: string; name: string }[];
  initial?: Partial<GoalInput>;
  onDone?: () => void;
}) {
  const [v, setV] = useState<Partial<GoalInput>>({ title: "", description: "", teamId: null, dueDate: null, priority: "normal", ...initial });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<GoalInput>) => setV((p) => ({ ...p, ...patch }));

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const input = { title: v.title ?? "", description: v.description, teamId: v.teamId, dueDate: v.dueDate, priority: v.priority };
          const r = goalId ? await updateGoalAction(goalId, input) : await createGoalAction({ ...input, projectId });
          setMsg(r.ok ? null : r.message);
          if (r.ok) {
            if (!goalId) setV({ title: "", description: "", teamId: null, dueDate: null, priority: "normal" });
            onDone?.();
          }
        });
      }}
    >
      <input value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder="Goal, e.g. “Launch spring landing pages”" aria-label="Goal title" className={`${field} w-full font-semibold`} />
      <textarea value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder="Why it matters (optional)" aria-label="Description" rows={2} className={`${field} w-full`} />
      <div className="flex flex-wrap gap-2">
        <select aria-label="Team" value={v.teamId ?? ""} onChange={(e) => set({ teamId: e.target.value || null })} className={field}>
          <option value="">Any team</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input type="date" aria-label="Due date" value={v.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value || null })} className={field} />
        <select aria-label="Priority" value={v.priority} onChange={(e) => set({ priority: e.target.value as GoalInput["priority"] })} className={field}>
          <option value="high">🔥 High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <button disabled={pending} className="ml-auto rounded-lg bg-ink px-4 py-1.5 text-sm font-bold text-paper disabled:opacity-60">
          {goalId ? "Save" : "Add goal"}
        </button>
        {goalId && onDone ? (
          <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 ring-1 ring-black/10">
            Cancel
          </button>
        ) : null}
      </div>
      {msg ? <p className="text-xs text-rose-600">{msg}</p> : null}
    </form>
  );
}
