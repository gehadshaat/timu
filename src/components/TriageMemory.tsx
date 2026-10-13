"use client";

import { useState, useTransition } from "react";
import {
  addMemoryAction,
  deleteMemoryAction,
  recheckOpenAsksAction,
  resetMemoryAction,
  setStaleDaysAction,
  updateMemoryAction,
} from "@/app/actions";
import type { MemoryItem } from "@/lib/triage/memory";

const SOURCE_LABEL: Record<MemoryItem["source"], string> = { default: "built-in", you: "yours", learned: "learned" };

function Row({ item }: { item: MemoryItem }) {
  const [text, setText] = useState(item.text);
  const [pending, start] = useTransition();
  const dirty = text.trim() !== item.text;
  return (
    <li className="flex items-start gap-2">
      <span className="mt-2 shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-500">{SOURCE_LABEL[item.source]}</span>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.max(1, Math.ceil(text.length / 95))}
        aria-label="Memory rule"
        className="min-w-0 flex-1 resize-y rounded-lg border-0 bg-zinc-50 px-2 py-1.5 text-sm ring-1 ring-black/10"
      />
      {dirty ? (
        <button type="button" disabled={pending} onClick={() => start(() => updateMemoryAction(item.id, text))} className="mt-1 rounded-lg bg-ink px-2 py-1 text-xs font-bold text-paper">
          Save
        </button>
      ) : null}
      <button type="button" disabled={pending} onClick={() => start(() => deleteMemoryAction(item.id))} className="mt-1 rounded-lg px-2 py-1 text-xs text-zinc-400 hover:text-rose-600" aria-label="Delete rule">
        ✕
      </button>
    </li>
  );
}

export function TriageMemory({ memory, engine, staleDays }: { memory: MemoryItem[]; engine: string; staleDays: number }) {
  const [draft, setDraft] = useState("");
  const [days, setDays] = useState(String(staleDays));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-black/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">🧠 Triage memory</h2>
          <p className="text-sm text-zinc-500">
            Before anything lands in your inbox, a quick check decides whether it genuinely needs you. Obvious cases are settled by
            rules; the rest go to <b>{engine}</b>, which reads these rules. &ldquo;Not needed&rdquo; on an inbox item can add to them.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setMsg((await recheckOpenAsksAction()).message))}
          className="shrink-0 rounded-xl bg-ink px-3 py-2 text-sm font-bold text-paper disabled:opacity-60"
        >
          {pending ? "Checking…" : "Re-check open asks"}
        </button>
      </div>
      {msg ? <p className="text-sm font-semibold text-emerald-700">{msg}</p> : null}
      <form
        className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-sm ring-1 ring-black/5"
        onSubmit={(e) => {
          e.preventDefault();
          start(() => setStaleDaysAction(Number(days)));
        }}
      >
        <span>📦 Sessions idle for</span>
        <input
          type="number"
          min={0}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          aria-label="Idle days before a session stops raising asks"
          className="w-20 rounded-md border-0 bg-white px-2 py-1 ring-1 ring-black/10"
        />
        <span>days or more never need you (0 turns this off). They&apos;re still imported and searchable.</span>
        {Number(days) !== staleDays ? <button className="rounded-lg bg-ink px-2 py-1 text-xs font-bold text-paper">Save</button> : null}
      </form>
      <ul className="space-y-2">
        {memory.map((m) => (
          <Row key={`${m.id}:${m.text}`} item={m} />
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft;
          setDraft("");
          start(() => addMemoryAction(text));
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a rule, e.g. “Dependabot PRs never need me”"
          aria-label="New memory rule"
          className="min-w-0 flex-1 rounded-lg border-0 bg-zinc-50 px-2 py-1.5 text-sm ring-1 ring-black/10"
        />
        <button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-bold text-paper">Add</button>
      </form>
      <button type="button" disabled={pending} onClick={() => start(() => resetMemoryAction())} className="text-xs text-zinc-400 hover:text-rose-600">
        Reset to built-in rules
      </button>
    </section>
  );
}
