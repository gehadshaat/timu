"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { bulkAddTodosAction, type QuickTodo } from "@/app/_actions/bulk";
import { dueLabel } from "@/lib/format";
import type { OrgOptions } from "@/lib/queries";
import { parseQuickAdd } from "@/lib/quickadd";
import { useBulkRunner } from "../ui/useBulk";

/**
 * Type a to-do — or paste a whole list, one per line — with inline shortcuts:
 * @person, #project, !high / !low, due:fri. A live preview shows how each line is read.
 */
export function QuickAdd({
  options,
  projectId,
  agentId,
  goalId,
  compact = false,
  placeholder,
}: {
  options: OrgOptions;
  /** Default project for lines that don't name one. */
  projectId?: string | null;
  /** Default assignee (undefined = you). */
  agentId?: string | null;
  goalId?: string | null;
  compact?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [help, setHelp] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const { run, pending } = useBulkRunner();

  const ctx = useMemo(
    () => ({
      agents: options.agents.map((a) => ({ id: a.id, name: a.name })),
      projects: options.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    }),
    [options],
  );
  const items = useMemo(() => parseQuickAdd(text, ctx), [text, ctx]);
  const multi = text.includes("\n");
  const agentName = (id: string | null | undefined) => (id ? options.agents.find((a) => a.id === id)?.name : null);
  const project = (id: string | null | undefined) => (id ? options.projects.find((p) => p.id === id) : undefined);

  const submit = () => {
    if (!items.length || pending) return;
    const payload: QuickTodo[] = items.map((it) => ({
      title: it.title,
      // @me → null (you); not given → the default assignee for this box.
      agentId: it.agentId === undefined ? (agentId ?? null) : it.agentId,
      projectId: it.projectId ?? projectId ?? null,
      goalId: goalId ?? null,
      dueDate: it.dueDate ?? null,
      priority: it.priority,
    }));
    const before = text;
    setText("");
    run(() => bulkAddTodosAction(payload), { onFailed: () => setText(before) });
    ref.current?.focus();
  };

  const showPreview = items.length > 0 && (multi || items.some((i) => i.agentId !== undefined || i.projectId || i.priority || i.dueDate || i.unknown.length));

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <textarea
          ref={ref}
          value={text}
          rows={multi ? Math.min(8, text.split("\n").length) : 1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && (!multi || e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder ?? (compact ? "Add a to-do…  (@who #project !high due:fri)" : "Add to-dos — one per line. Try: Write FAQ @Maya #sunbeam !high due:fri")}
          aria-label="Add to-dos"
          className="min-w-0 flex-1 resize-none rounded-xl border-0 bg-zinc-50 px-3 py-2 text-sm ring-1 ring-black/10 focus:bg-white focus:ring-2 focus:ring-amber-300"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!items.length || pending}
          className="shrink-0 rounded-xl bg-ink px-3 py-2 text-sm font-bold text-paper disabled:opacity-40"
        >
          {items.length > 1 ? `Add ${items.length}` : "Add"}
        </button>
        {!compact ? (
          <button type="button" onClick={() => setHelp((v) => !v)} aria-label="Quick-add help" className="shrink-0 rounded-xl px-2.5 py-2 text-sm font-bold text-zinc-500 ring-1 ring-black/10 hover:bg-zinc-50">
            ?
          </button>
        ) : null}
      </div>
      {help ? (
        <div className="rounded-2xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <b>@Maya</b> assigns (or <b>@me</b>) · <b>#project</b> files it (name or slug, a prefix is fine) · <b>!</b> or <b>!high</b>, <b>!low</b> sets priority ·{" "}
          <b>due:</b>today, tomorrow, fri, nextweek, +3d, 11/1 · Paste a list — bullets and checkboxes are ignored. Shift+Enter for a new line; ⌘/Ctrl+Enter adds them
          all.
        </div>
      ) : null}
      {showPreview ? (
        <ul className="space-y-1 rounded-2xl bg-white/70 p-2 ring-1 ring-black/5">
          {items.slice(0, 50).map((it, i) => {
            const who = it.agentId === undefined ? agentName(agentId) : it.agentId === null ? "Me" : agentName(it.agentId);
            const p = project(it.projectId ?? projectId);
            const due = it.dueDate ? dueLabel(it.dueDate) : null;
            return (
              <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold text-zinc-800">{it.title}</span>
                {who ? <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-800">👤 {who}</span> : null}
                {p ? (
                  <span className={clsx("rounded-full px-2 py-0.5 font-semibold", it.projectId ? "bg-violet-100 text-violet-800" : "bg-zinc-100 text-zinc-500")}>
                    {p.emoji} {p.name}
                  </span>
                ) : null}
                {it.priority === "high" ? <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">🔥 high</span> : null}
                {it.priority === "low" ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-600">low</span> : null}
                {due ? <span className={`rounded-full px-2 py-0.5 font-semibold ${due.tone}`}>📅 {due.text}</span> : null}
                {it.unknown.map((u) => (
                  <span key={u} className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800" title="Didn't match anyone or any project — kept in the title">
                    ? {u}
                  </span>
                ))}
              </li>
            );
          })}
          {items.length > 50 ? <li className="text-xs text-zinc-500">…and {items.length - 50} more</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
