"use client";

import { useEffect, useState, useTransition } from "react";
import { syncAllAction } from "@/app/actions";
import type { SyncStatus } from "@/lib/auto-sync";
import { timeAgo } from "@/lib/format";
import { SYNC_EVENT } from "./LiveRefresh";

const every = (s: number) => (s % 60 ? `${s}s` : s === 60 ? "minute" : `${s / 60} min`);

/** Re-renders now and then so "synced 2m ago" stays true; null until mounted (no hydration mismatch). */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function SyncButton({ compact = false, status: initial }: { compact?: boolean; status?: SyncStatus }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState(initial);
  const now = useNow();

  useEffect(() => {
    const onSync = (e: Event) => setStatus((e as CustomEvent<SyncStatus>).detail);
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  const busy = pending || !!status?.running;
  const failed = status?.lastOk === false ? status.lastMessage : null;
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
        <span className={busy ? "animate-spin" : ""} aria-hidden>
          🔄
        </span>
        {busy ? "Syncing…" : "Sync sessions"}
      </button>
      {!compact && status?.active && now ? (
        <p className="text-[11px] leading-snug text-zinc-500">
          {status.lastAt ? `Synced ${timeAgo(status.lastAt, now)}` : "Syncing soon"} · by itself every {every(status.every)}
        </p>
      ) : null}
      {!compact && (msg ?? failed) ? <p className={`text-[11px] leading-snug ${failed && !msg ? "text-rose-600" : "text-zinc-500"}`}>{msg ?? failed}</p> : null}
    </div>
  );
}
