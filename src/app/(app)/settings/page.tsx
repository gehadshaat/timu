import { ClickUpPanel } from "@/components/ClickUpPanel";
import { McpPanel } from "@/components/McpPanel";
import { ResetOrgButton } from "@/components/ResetOrgButton";
import { SourcesPanel } from "@/components/SourcesPanel";
import { SyncButton } from "@/components/SyncButton";
import { syncStatus } from "@/lib/auto-sync";
import { mirrorStatus } from "@/lib/clickup/mirror";
import { TriageMemory } from "@/components/TriageMemory";
import { getMemory, getStaleDays, triageEngine } from "@/lib/triage";
import { hasClaude } from "@/lib/classify/claude";
import { timeAgo } from "@/lib/format";
import { getSourceStats } from "@/lib/queries";
import { getSourceInfo } from "@/lib/source-info";

export default async function SettingsPage() {
  const [info, stats, memory, staleDays] = await Promise.all([getSourceInfo(), getSourceStats(), getMemory(), getStaleDays()]);
  const sync = syncStatus();
  const mins = (s: number) => (s < 60 ? `${s} seconds` : s === 60 ? "minute" : `${Math.round(s / 60)} minutes`);
  const cadence = !sync.active
    ? "Timu syncs when you press Sync sessions (TIMU_SYNC_INTERVAL=0)."
    : `Timu syncs by itself: local transcripts every ${mins(sync.every)}${sync.cloudEvery ? `, cloud sessions and routines every ${mins(sync.cloudEvery)}` : ""}. Open pages update as soon as something changes.`;
  const engine = { typesafe: "TypeSafe Jev", claude: "Claude Haiku 5.5, through the Claude CLI", status: "the session's own status (install the Claude CLI, or set TYPESAFE_API_KEY, for a model)" }[triageEngine()];
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Sources & settings</h1>
          <p className="text-zinc-600">Where Timu reads your sessions from. {cadence} Each sync files new sessions with the right teammate.</p>
        </div>
        <div className="w-48">
          <SyncButton status={sync} />
        </div>
      </header>

      <SourcesPanel info={info} />

      <McpPanel tokenSet={!!process.env.TIMU_MCP_TOKEN?.trim()} repoDir={process.cwd()} />

      <ClickUpPanel status={mirrorStatus()} />

      <TriageMemory memory={memory} engine={engine} staleDays={staleDays} />

      <section className="space-y-2 rounded-3xl bg-white p-5 ring-1 ring-black/5">
        <h2 className="font-display text-lg font-bold">Last imports</h2>
        <ul className="text-sm text-zinc-600">
          {stats.map((s) => (
            <li key={s.source}>
              <b>{s.source}</b>: {s.sessions} sessions
              {!s.lastImport
                ? " · nothing imported yet"
                : s.lastImport.error
                  ? ` · failed ${timeAgo(s.lastImport.finished_at)}`
                  : ` · last new activity ${timeAgo(s.lastImport.finished_at)} (${s.lastImport.imported} new, ${s.lastImport.updated} updated)`}
              {s.lastImport?.error ? <span className="text-rose-600"> · {s.lastImport.error}</span> : null}
            </li>
          ))}
        </ul>
        <p className="text-sm text-zinc-500">
          Organiser: {hasClaude() ? "Claude (claude-opus-5-5), through the Claude CLI on your login" : "rules only — install Claude Code and sign in (`claude`) to let Claude build teams"}
        </p>
      </section>

      <section className="space-y-2 rounded-3xl bg-rose-50 p-5 ring-1 ring-rose-200">
        <h2 className="font-display text-lg font-bold text-rose-900">Rebuild the team</h2>
        <p className="text-sm text-rose-900/70">Removes all projects, teams, teammates and goals (your imported sessions stay) and reruns setup.</p>
        <ResetOrgButton />
      </section>
    </div>
  );
}
