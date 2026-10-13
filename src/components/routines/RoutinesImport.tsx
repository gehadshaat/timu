"use client";

import { useActionState, useTransition, useState } from "react";
import { importRoutinesJsonAction, syncRoutinesAction, type ActionResult } from "@/app/actions";

/** Pull routines from Claude now, or paste the JSON the RemoteTrigger tool's list action prints. */
export function RoutinesImport({ canSync }: { canSync: boolean }) {
  const [pasteResult, pasteAction, pasting] = useActionState(importRoutinesJsonAction, null);
  const [syncResult, setSyncResult] = useState<ActionResult | null>(null);
  const [syncing, startSync] = useTransition();
  const result = syncResult ?? pasteResult;

  return (
    <details className="group rounded-2xl bg-white/70 p-3 ring-1 ring-black/5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm font-semibold text-zinc-600">
        <span className="inline-block w-4 text-xs text-zinc-400 group-open:rotate-90">▸</span> Update routines
        {result ? <span className={result.ok ? "text-emerald-700" : "text-rose-700"}>· {result.message}</span> : null}
      </summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm text-zinc-600">
          <p>
            <b>Sync</b> pulls routines from Claude with your Claude Code login, like cloud sessions. Every Timu sync does this too.
          </p>
          <button
            type="button"
            disabled={!canSync || syncing}
            onClick={() => startSync(async () => setSyncResult(await syncRoutinesAction()))}
            className="rounded-xl bg-ink px-3 py-1.5 text-sm font-bold text-paper disabled:opacity-40"
            title={canSync ? undefined : "Sign in to Claude Code on this machine first (run `claude`)"}
          >
            {syncing ? "Syncing…" : "🔄 Sync routines now"}
          </button>
          {!canSync ? <p className="text-xs text-zinc-500">Not signed in to Claude yet, so paste them instead →</p> : null}
        </div>
        <form action={(f) => { setSyncResult(null); pasteAction(f); }} className="space-y-2">
          <textarea
            name="json"
            rows={4}
            placeholder={"Paste the routines JSON — e.g. ask Claude Code: “use RemoteTrigger list and give me the raw output”."}
            aria-label="Routines JSON"
            className="w-full rounded-xl border-0 bg-zinc-50 px-3 py-2 font-mono text-xs ring-1 ring-black/10"
          />
          <button disabled={pasting} className="rounded-xl bg-white px-3 py-1.5 text-sm font-bold ring-1 ring-black/10 hover:bg-zinc-50 disabled:opacity-40">
            {pasting ? "Importing…" : "Import pasted routines"}
          </button>
        </form>
      </div>
    </details>
  );
}
