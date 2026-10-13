"use client";

import { useEffect, useState } from "react";

function Command({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-zinc-500">{label}</p>
      <pre className="whitespace-pre-wrap break-all rounded-xl bg-zinc-50 p-2 font-mono text-xs ring-1 ring-black/5">{text}</pre>
    </div>
  );
}

/** How to connect Claude to Timu's MCP server. The token itself is never shown here. */
export function McpPanel({ tokenSet, repoDir }: { tokenSet: boolean; repoDir: string }) {
  const [origin, setOrigin] = useState("http://localhost:3100");
  useEffect(() => setOrigin(window.location.origin), []);
  const token = "<TIMU_MCP_TOKEN>";

  return (
    <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <span aria-hidden className="text-2xl">🤖</span>
        Let Claude run Timu (MCP)
      </h2>
      <p className="text-sm text-zinc-600">
        Claude can read and reorganise everything here: companies, projects, teams, teammates, goals, to-dos, sessions and your inbox. Ask it to
        &ldquo;file my unfiled sessions&rdquo; or &ldquo;set up a Marketing team for Sunbeam&rdquo;.
      </p>
      {tokenSet ? (
        <>
          <p className="text-sm text-zinc-600">
            Replace <code className="rounded bg-zinc-100 px-1">{token}</code> with the value of <code className="rounded bg-zinc-100 px-1">TIMU_MCP_TOKEN</code> in
            .env.local.
          </p>
          <Command label="Claude Code, while Timu is running" text={`claude mcp add --transport http timu ${origin}/api/mcp --header "Authorization: Bearer ${token}"`} />
          <details className="space-y-2 text-sm">
            <summary className="cursor-pointer font-semibold text-zinc-700">Other ways to connect</summary>
            <div className="mt-2 space-y-2">
              <Command label="Claude Code or Claude Desktop on this machine, without the web app (stdio)" text={`claude mcp add timu -- npm --prefix ${repoDir} run -s mcp`} />
              <Command label="claude.ai or Claude Desktop custom connector (needs a public Timu URL)" text={`${origin}/api/mcp?token=${token}`} />
            </div>
          </details>
        </>
      ) : (
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
          Set <code>TIMU_MCP_TOKEN</code> in .env.local (<code>npm run dev</code> generates one) and restart Timu to turn on the MCP endpoint.
        </p>
      )}
    </section>
  );
}
