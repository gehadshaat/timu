"use client";

import { useState, useTransition } from "react";
import { syncAllAction } from "@/app/actions";

export function SyncButton({ compact = false }: { compact?: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className={compact ? "" : "space-y-1"}>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncAllAction();
            setMsg(r.message);
          })
        }
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold shadow-sm ring-1 ring-black/10 hover:bg-zinc-50 disabled:opacity-60"
      >
        <span className={pending ? "animate-spin" : ""} aria-hidden>
          🔄
        </span>
        {pending ? "Syncing…" : "Sync sessions"}
      </button>
      {msg && !compact ? <p className="text-[11px] leading-snug text-zinc-500">{msg}</p> : null}
    </div>
  );
}
