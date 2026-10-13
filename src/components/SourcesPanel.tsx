"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  importClaudeAiExportAction,
  importCloudAction,
  importCloudJsonAction,
  importLocalAction,
  type ActionResult,
} from "@/app/actions";

export interface SourceInfo {
  localDir: string;
  localFiles: number | null;
  cloudConfigured: boolean;
  /** Which Claude login the cloud pulls use (see lib/claude-auth). */
  /** Every Claude account Timu syncs, with how it's signed in (see lib/claude-accounts). */
  claude: { id: string; label: string; dir: string; source: "env" | "claude-code" | null; expired: boolean; expires: string | null; envRejected: boolean }[];
  ingestTokenSet: boolean;
  counts: Record<string, number>;
}

/** How Timu signs in to Claude: borrowing Claude Code's login, which Claude Code keeps fresh. */
function ClaudeLogin({ claude, many }: { claude: SourceInfo["claude"][number]; many: boolean }) {
  const who = many ? (
    <span className="mb-0.5 block font-mono text-[10px] opacity-70" title={claude.dir}>
      {claude.label}
    </span>
  ) : null;
  if (!claude.source)
    return (
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
        {who}
        <b>Not signed in to Claude.</b> Sign in to Claude Code on this machine (run <code>claude</code>) and Timu uses that login automatically — no token to paste.
      </p>
    );
  if (claude.expired)
    return (
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
        {who}
        <b>Your Claude login expired.</b> Open Claude Code (run <code>{claude.id === "claude" ? "claude" : `CLAUDE_CONFIG_DIR=${claude.dir} claude`}</code>) to refresh it —
        Timu picks it up on the next sync.
      </p>
    );
  return (
    <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900 ring-1 ring-emerald-200">
      {who}
      {claude.source === "claude-code" ? (
        <>
          <b>🟢 Signed in with your Claude Code login.</b> Claude Code keeps it fresh{claude.expires ? ` (current token: ${claude.expires} left)` : ""}; nothing to paste.
          {claude.envRejected ? (
            <span className="mt-1 block text-emerald-800/80">
              Claude rejected the <code>CLAUDE_SESSIONS_TOKEN</code> in .env.local, so you can delete that line.
            </span>
          ) : null}
        </>
      ) : (
        <>
          <b>🔑 Using the token in .env.local.</b> If Claude rejects it, Timu falls back to your Claude Code login automatically.
        </>
      )}
    </p>
  );
}

function Result({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return <p className={`text-sm font-semibold ${r.ok ? "text-emerald-700" : "text-rose-700"}`}>{r.ok ? "✓ " : "⚠ "}{r.message}</p>;
}

function Card({ icon, title, count, children }: { icon: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold">
          <span aria-hidden className="text-2xl">{icon}</span>
          {title}
        </h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${count ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-500"}`}>
          {count} imported
        </span>
      </div>
      {children}
    </div>
  );
}

export function SourcesPanel({ info }: { info: SourceInfo }) {
  const [localResult, setLocalResult] = useState<ActionResult | null>(null);
  const [cloudResult, setCloudResult] = useState<ActionResult | null>(null);
  const [pendingLocal, startLocal] = useTransition();
  const [pendingCloud, startCloud] = useTransition();
  const [jsonResult, jsonAction, jsonPending] = useActionState(importCloudJsonAction, null);
  const [exportResult, exportAction, exportPending] = useActionState(importClaudeAiExportAction, null);
  const [origin, setOrigin] = useState("http://localhost:3100");
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card icon="☁️" title="Claude Code · cloud" count={info.counts.cloud ?? 0}>
        <p className="text-sm text-zinc-600">Sessions from claude.ai/code, with live status (working, blocked, ready for review).</p>
        {info.claude.map((c) => (
          <ClaudeLogin key={c.id} claude={c} many={info.claude.length > 1} />
        ))}
        <p className="text-[11px] text-zinc-500">
          {info.claude.length > 1 ? `${info.claude.length} Claude accounts, ` : "One Claude account, "}
          all filed into the same companies and projects. Add another by signing in with <code>CLAUDE_CONFIG_DIR=~/.claude-work claude</code>; Timu finds it on the next sync.
        </p>
        {info.cloudConfigured ? (
          <button
            type="button"
            disabled={pendingCloud}
            onClick={() => startCloud(async () => setCloudResult(await importCloudAction()))}
            className="self-start rounded-xl bg-ink px-4 py-2 text-sm font-bold text-paper disabled:opacity-60"
          >
            {pendingCloud ? "Importing…" : "Import cloud sessions"}
          </button>
        ) : (
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
            Paste a JSON export below until you&apos;re signed in (see README → Cloud sessions for how to get one).
          </p>
        )}
        <Result r={cloudResult} />
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-zinc-700">Paste or upload sessions JSON</summary>
          <form action={jsonAction} className="mt-2 space-y-2">
            <textarea
              name="json"
              rows={4}
              placeholder='{"data":[{"id":"session_…","title":"…"}]}'
              className="w-full rounded-xl border-0 bg-zinc-50 p-2 font-mono text-xs ring-1 ring-black/10"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" name="file" accept=".json,application/json" className="text-xs" />
              <button disabled={jsonPending} className="rounded-xl bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
                {jsonPending ? "Importing…" : "Import JSON"}
              </button>
            </div>
            <Result r={jsonResult} />
          </form>
        </details>
      </Card>

      <Card icon="💻" title="Claude Code · local" count={info.counts.local ?? 0}>
        <p className="text-sm text-zinc-600">
          Transcripts on this machine in <code className="rounded bg-zinc-100 px-1">{info.localDir}</code>
          {info.localFiles == null ? " — folder not found." : ` — ${info.localFiles} found.`}
        </p>
        <button
          type="button"
          disabled={pendingLocal || !info.localFiles}
          onClick={() => startLocal(async () => setLocalResult(await importLocalAction()))}
          className="self-start rounded-xl bg-ink px-4 py-2 text-sm font-bold text-paper disabled:opacity-50"
        >
          {pendingLocal ? "Importing…" : "Import local transcripts"}
        </button>
        <Result r={localResult} />
      </Card>

      <Card icon="📦" title="claude.ai chats · export" count={info.counts.claude_ai ?? 0}>
        <p className="text-sm text-zinc-600">
          In claude.ai go to <b>Settings → Privacy → Export data</b>. Upload the zip you get by email (or its conversations.json).
        </p>
        <form action={exportAction} className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" accept=".zip,.json" className="text-xs" />
          <button disabled={exportPending} className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-paper disabled:opacity-60">
            {exportPending ? "Importing…" : "Import export"}
          </button>
        </form>
        <Result r={exportResult} />
      </Card>

      <Card icon="🧩" title="claude.ai chats · Chrome extension" count={info.counts.claude_ai ?? 0}>
        <p className="text-sm text-zinc-600">
          Keeps chats in sync while you use claude.ai. Load the <code className="rounded bg-zinc-100 px-1">extension/</code> folder at{" "}
          <code className="rounded bg-zinc-100 px-1">chrome://extensions</code> (Developer mode → Load unpacked), then set:
        </p>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 rounded-xl bg-zinc-50 p-3 text-xs ring-1 ring-black/5">
          <dt className="font-semibold text-zinc-500">Timu URL</dt>
          <dd className="font-mono">{origin}</dd>
          <dt className="font-semibold text-zinc-500">Token</dt>
          <dd className="font-mono">{info.ingestTokenSet ? "value of TIMU_INGEST_TOKEN in .env.local" : "⚠ set TIMU_INGEST_TOKEN in .env.local first"}</dd>
        </dl>
      </Card>
    </div>
  );
}
