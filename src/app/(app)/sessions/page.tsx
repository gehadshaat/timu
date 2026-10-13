import Link from "next/link";
import clsx from "clsx";
import { SessionBoard, type ListScope } from "@/components/sessions/SessionBoard";
import { toSessionLite } from "@/lib/session-lite";
import { getAllCommentCounts } from "@/lib/comments";
import { getInbox, getOrg, getSessions, orgOptions } from "@/lib/queries";

const STATUSES = ["needs_you", "review", "working", "failed", "idle", "done"];
const SOURCES = [
  ["cloud", "Cloud"],
  ["local", "Local"],
  ["claude_ai", "claude.ai"],
];
const LIMIT = 1000;
const VIEWS: [string, string][] = [
  ["", "Active"],
  ["unfiled", "Unfiled"],
  ["archived", "Archived"],
];

export default async function SessionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [sessions, org, commentCounts] = await Promise.all([
    getSessions({
      status: sp.status,
      source: sp.source,
      projectId: sp.project,
      q: sp.q,
      archived: sp.view === "archived",
      unfiled: sp.view === "unfiled",
      limit: LIMIT,
    }),
    getOrg(),
    getAllCommentCounts("session"),
  ]);
  const asks = Object.fromEntries((await getInbox(org)).map((i) => [i.session.id, i.task.id]));
  const scope: ListScope = sp.view === "archived" ? "archived" : sp.view === "unfiled" ? "unfiled" : "all";
  const href = (view: string) => {
    const p = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => !!e[1] && e[0] !== "view"));
    if (view) p.set("view", view);
    const qs = p.toString();
    return qs ? `/sessions?${qs}` : "/sessions";
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">All sessions</h1>
          <p className="text-zinc-600">Select several to assign, link to a goal, re-file or archive them at once. Click a title&apos;s ✏️ to rename.</p>
        </div>
        <nav className="flex rounded-xl bg-white p-0.5 ring-1 ring-black/10" aria-label="Which sessions">
          {VIEWS.map(([v, label]) => (
            <Link
              key={v}
              href={href(v)}
              className={clsx("rounded-lg px-3 py-1.5 text-sm font-semibold", (sp.view ?? "") === v ? "bg-ink text-paper" : "text-zinc-600 hover:bg-black/5")}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <form className="flex flex-wrap gap-2 rounded-2xl bg-white p-3 ring-1 ring-black/5">
        {sp.view ? <input type="hidden" name="view" value={sp.view} /> : null}
        <input
          name="q"
          defaultValue={sp.q}
          placeholder="Search titles…"
          aria-label="Search titles"
          className="min-w-[200px] flex-1 rounded-lg border-0 bg-zinc-50 px-3 py-2 text-sm ring-1 ring-black/10"
        />
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="rounded-lg border-0 bg-zinc-50 px-3 py-2 text-sm ring-1 ring-black/10">
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} aria-label="Source" className="rounded-lg border-0 bg-zinc-50 px-3 py-2 text-sm ring-1 ring-black/10">
          <option value="">Any source</option>
          {SOURCES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select name="project" defaultValue={sp.project ?? ""} aria-label="Project" className="rounded-lg border-0 bg-zinc-50 px-3 py-2 text-sm ring-1 ring-black/10">
          <option value="">Any project</option>
          {org.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.emoji} {p.name}
            </option>
          ))}
        </select>
        <button className="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-paper">Filter</button>
      </form>
      {sessions.length >= LIMIT ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Showing the {LIMIT} most recent — narrow it down with the filters.</p>
      ) : null}
      <SessionBoard sessions={sessions.map(toSessionLite)} options={orgOptions(org)} scope={scope} commentCounts={commentCounts} asks={asks} />
    </div>
  );
}
