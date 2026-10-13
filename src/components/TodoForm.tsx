"use client";

import { useState, useTransition } from "react";
import { createTodoAction, updateTodoAction, type TodoInput } from "@/app/actions";
import type { OrgOptions } from "@/lib/queries";

const field = "rounded-lg border-0 bg-zinc-50 px-2 py-1.5 text-sm ring-1 ring-black/10";

/** Add or edit a to-do. Project, goal and assignee are optional and narrow each other. */
export function TodoForm({
  options,
  initial,
  taskId,
  lockProject,
  onDone,
  compact = false,
}: {
  options: OrgOptions;
  initial?: TodoInput;
  taskId?: string;
  /** Hide the project picker (e.g. on a project page). */
  lockProject?: string;
  onDone?: () => void;
  compact?: boolean;
}) {
  const [v, setV] = useState<TodoInput>({
    title: "",
    agentId: null,
    projectId: lockProject ?? null,
    goalId: null,
    dueDate: null,
    priority: "normal",
    ...initial,
  });
  const [more, setMore] = useState(!compact || !!taskId);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<TodoInput>) => setV((prev) => ({ ...prev, ...patch }));

  const projectId = lockProject ?? v.projectId ?? null;
  const agents = options.agents.filter((a) => !projectId || a.project_id === projectId);
  const goals = options.goals.filter((g) => g.status === "active" && (!projectId || g.project_id === projectId));

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const input = { ...v, projectId };
          const r = taskId ? await updateTodoAction(taskId, input) : await createTodoAction(input);
          setMsg(r.ok ? null : r.message);
          if (r.ok) {
            if (!taskId) setV((prev) => ({ ...prev, title: "", dueDate: null }));
            onDone?.();
          }
        });
      }}
    >
      <div className="flex gap-2">
        <input
          value={v.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Add a to-do…"
          aria-label="To-do"
          className={`${field} min-w-0 flex-1`}
        />
        {compact && !more ? (
          <button type="button" onClick={() => setMore(true)} className="rounded-lg px-2 text-xs font-semibold text-zinc-500 ring-1 ring-black/10">
            ⋯
          </button>
        ) : null}
        <button disabled={pending} className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-sm font-bold text-paper disabled:opacity-60">
          {taskId ? "Save" : "Add"}
        </button>
      </div>
      {more ? (
        <div className="flex flex-wrap gap-2">
          <select aria-label="Assignee" value={v.agentId ?? ""} onChange={(e) => set({ agentId: e.target.value || null })} className={field}>
            <option value="">👤 Me</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.role}
              </option>
            ))}
          </select>
          {lockProject ? null : (
            <select
              aria-label="Project"
              value={v.projectId ?? ""}
              onChange={(e) => set({ projectId: e.target.value || null, goalId: null, agentId: null })}
              className={field}
            >
              <option value="">No project</option>
              {options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Goal" value={v.goalId ?? ""} onChange={(e) => set({ goalId: e.target.value || null })} className={field}>
            <option value="">No goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                🎯 {g.title}
              </option>
            ))}
          </select>
          <input type="date" aria-label="Due date" value={v.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value || null })} className={field} />
          <select aria-label="Priority" value={v.priority} onChange={(e) => set({ priority: e.target.value as TodoInput["priority"] })} className={field}>
            <option value="high">🔥 High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
      ) : null}
      {msg ? <p className="text-xs text-rose-600">{msg}</p> : null}
    </form>
  );
}
