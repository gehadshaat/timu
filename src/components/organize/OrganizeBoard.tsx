"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { bulkAgentsAction, bulkProjectsAction, bulkSessionsAction, type BulkResult, type SessionOp } from "@/app/_actions/bulk";
import { fold } from "@/lib/search";
import { companyHref, personHref, projectHref, teamHref } from "@/lib/links";
import type { OrgOptions } from "@/lib/queries";
import { Character } from "../Character";
import { SourceBadge } from "../SourceBadge";
import { StatusPill } from "../StatusPill";
import type { SessionLite } from "@/lib/session-lite";
import { opForPick } from "../sessions/SessionBoard";
import { BAR_POPOVER, BarButton, BulkBar, SelectBox } from "../ui/BulkBar";
import { Ago } from "../ui/Ago";
import { Leaving, markedClasses } from "../ui/Leaving";
import { OrgPicker } from "../ui/Picker";
import { Popover } from "../ui/Popover";
import { useBulkRunner } from "../ui/useBulk";
import { useLeavingList } from "../ui/useLeaving";
import { useSelection } from "../ui/useSelection";

const MIME = {
  sessions: "application/x-timu-sessions",
  agent: "application/x-timu-agent",
  project: "application/x-timu-project",
} as const;
type DragKind = keyof typeof MIME;

export interface OrganizeCounts {
  agents: Record<string, number>;
  teams: Record<string, number>;
  projects: Record<string, number>;
}

interface Dnd {
  dragging: DragKind | null;
  hot: string | null;
  setHot: (id: string | null) => void;
  setDragging: (k: DragKind | null) => void;
  dropSessions: (ids: string[], op: SessionOp, label: string) => void;
  moveAgent: (agentId: string, teamId: string) => void;
  moveProject: (projectId: string, companyId: string | null) => void;
}

const DndContext = createContext<Dnd | null>(null);
const useDnd = () => useContext(DndContext)!;

function readDrag(e: React.DragEvent): DragKind | null {
  const types = Array.from(e.dataTransfer.types);
  return (Object.keys(MIME) as DragKind[]).find((k) => types.includes(MIME[k])) ?? null;
}

/** Props that make an element a drop target for some kinds of drag. */
function useDrop(id: string, accept: Partial<Record<DragKind, (data: string) => void>>) {
  const { hot, setHot } = useDnd();
  const props = {
    onDragOver: (e: React.DragEvent) => {
      const kind = readDrag(e);
      if (!kind || !accept[kind]) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setHot(id);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      if (hot === id) setHot(null);
    },
    onDrop: (e: React.DragEvent) => {
      const kind = readDrag(e);
      if (!kind || !accept[kind]) return;
      e.preventDefault();
      e.stopPropagation();
      setHot(null);
      accept[kind]!(e.dataTransfer.getData(MIME[kind]));
    },
  };
  return { hot: hot === id, props };
}

function startDrag(e: React.DragEvent, kind: DragKind, data: string, setDragging: (k: DragKind | null) => void, ghost?: HTMLElement | null) {
  e.dataTransfer.setData(MIME[kind], data);
  e.dataTransfer.setData("text/plain", data);
  e.dataTransfer.effectAllowed = "move";
  if (ghost) e.dataTransfer.setDragImage(ghost, 16, 16);
  e.stopPropagation();
  setDragging(kind);
}

// ---------- the org tree (drop targets) ----------

function PersonChip({ agent, count }: { agent: OrgOptions["agents"][number]; count: number }) {
  const dnd = useDnd();
  const { hot, props } = useDrop(`agent:${agent.id}`, {
    sessions: (data) => dnd.dropSessions(JSON.parse(data) as string[], { type: "assign", agentId: agent.id }, agent.name),
  });
  return (
    <div
      {...props}
      draggable
      onDragStart={(e) => startDrag(e, "agent", agent.id, dnd.setDragging)}
      onDragEnd={() => dnd.setDragging(null)}
      title={`${agent.name}, ${agent.role} — drop sessions here, or drag to another team`}
      className={clsx(
        "drop-target flex cursor-grab items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 pr-2.5 text-xs ring-1 ring-black/10 active:cursor-grabbing",
        hot && "drop-hot",
      )}
    >
      <Character spec={agent.avatar} pose={hot ? "needs_you" : "idle"} desk={false} size={26} />
      <Link href={personHref(agent.id)} className="font-semibold hover:underline" draggable={false}>
        {agent.name}
      </Link>
      {count ? <span className="text-[10px] font-bold text-zinc-400">{count}</span> : null}
    </div>
  );
}

function TeamRow({ team, options, counts }: { team: OrgOptions["teams"][number]; options: OrgOptions; counts: OrganizeCounts }) {
  const dnd = useDnd();
  const people = options.agents.filter((a) => a.team_id === team.id);
  const { hot, props } = useDrop(`team:${team.id}`, {
    sessions: (data) => dnd.dropSessions(JSON.parse(data) as string[], { type: "team", teamId: team.id }, team.name),
    agent: (agentId) => {
      if (!people.some((p) => p.id === agentId)) dnd.moveAgent(agentId, team.id);
    },
  });
  return (
    <div {...props} className={clsx("drop-target rounded-2xl bg-zinc-50 p-2 ring-1 ring-black/5", hot && "drop-hot")}>
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <Link href={teamHref(team.id)} className="text-sm font-bold hover:underline">
          👥 {team.name}
        </Link>
        <span className="text-[11px] font-semibold text-zinc-400">
          {counts.teams[team.id] ?? 0} session{(counts.teams[team.id] ?? 0) === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {people.length ? (
          people.map((a) => <PersonChip key={a.id} agent={a} count={counts.agents[a.id] ?? 0} />)
        ) : (
          <span className="px-1 text-xs text-zinc-400">No one yet — drop someone here</span>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project, options, counts }: { project: OrgOptions["projects"][number]; options: OrgOptions; counts: OrganizeCounts }) {
  const dnd = useDnd();
  const teams = options.teams.filter((t) => t.project_id === project.id);
  const { hot, props } = useDrop(`project:${project.id}`, {
    sessions: (data) => dnd.dropSessions(JSON.parse(data) as string[], { type: "project", projectId: project.id }, project.name),
  });
  return (
    <div
      {...props}
      className={clsx("drop-target space-y-2 rounded-3xl bg-white p-3 shadow-sm ring-1 ring-black/5", hot && "drop-hot", dnd.dragging === "project" && "opacity-80")}
    >
      <div
        draggable
        onDragStart={(e) => startDrag(e, "project", project.id, dnd.setDragging)}
        onDragEnd={() => dnd.setDragging(null)}
        className="flex cursor-grab items-center gap-2 active:cursor-grabbing"
        title="Drag onto another company"
      >
        <span aria-hidden className="text-xl">
          {project.emoji}
        </span>
        <Link href={projectHref(project.slug)} className="min-w-0 flex-1 truncate font-display font-bold hover:underline" draggable={false}>
          {project.name}
        </Link>
        <span className="shrink-0 text-[11px] font-semibold text-zinc-400">{counts.projects[project.id] ?? 0}</span>
        <span aria-hidden className="shrink-0 text-zinc-300">
          ⠿
        </span>
      </div>
      {teams.length ? (
        <div className="space-y-1.5">
          {teams.map((t) => (
            <TeamRow key={t.id} team={t} options={options} counts={counts} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-zinc-50 px-2 py-1.5 text-xs text-zinc-400">No teams yet. Drop sessions on the project to file them here.</p>
      )}
    </div>
  );
}

function CompanyBlock({
  company,
  projects,
  options,
  counts,
}: {
  company: OrgOptions["companies"][number] | null;
  projects: OrgOptions["projects"];
  options: OrgOptions;
  counts: OrganizeCounts;
}) {
  const dnd = useDnd();
  const { hot, props } = useDrop(`company:${company?.id ?? "none"}`, {
    project: (projectId) => {
      if (!projects.some((p) => p.id === projectId)) dnd.moveProject(projectId, company?.id ?? null);
    },
  });
  return (
    <section {...props} className={clsx("drop-target space-y-3 rounded-[28px] bg-white/50 p-3 ring-1 ring-black/5 sm:p-4", hot && "drop-hot")}>
      <h2 className="flex items-center gap-2 px-1 font-display text-lg font-bold">
        <span aria-hidden>{company?.emoji ?? "📦"}</span>
        {company ? (
          <Link href={companyHref(company.slug)} className="hover:underline">
            {company.name}
          </Link>
        ) : (
          "No company"
        )}
        <span className="text-sm font-semibold text-zinc-400">· {projects.length}</span>
      </h2>
      {projects.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} options={options} counts={counts} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border-2 border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-400">Drop a project here</p>
      )}
    </section>
  );
}

function Bin({ id, label, hint, op, tone }: { id: string; label: string; hint: string; op: SessionOp; tone: string }) {
  const dnd = useDnd();
  const { hot, props } = useDrop(id, { sessions: (data) => dnd.dropSessions(JSON.parse(data) as string[], op, label) });
  return (
    <div {...props} className={clsx("drop-target flex-1 rounded-2xl border-2 border-dashed px-4 py-3 text-center", tone, hot && "drop-hot")}>
      <div className="font-display font-bold">{label}</div>
      <div className="text-xs opacity-70">{hint}</div>
    </div>
  );
}

// ---------- the sessions tray (drag sources) ----------

type Tab = "unfiled" | "recent";
const TRAY_PAGE = 60;

export function OrganizeBoard({
  unfiled,
  recent,
  options,
  counts,
}: {
  unfiled: SessionLite[];
  recent: SessionLite[];
  options: OrgOptions;
  counts: OrganizeCounts;
}) {
  const [tab, setTab] = useState<Tab>(unfiled.length ? "unfiled" : "recent");
  const [q, setQ] = useState("");
  const [dragging, setDragging] = useState<DragKind | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const { run } = useBulkRunner();

  const source = tab === "unfiled" ? unfiled : recent;
  const [limit, setLimit] = useState(TRAY_PAGE);
  const list = useLeavingList(source, (s) => s.id);
  const shown = useMemo(() => {
    const terms = fold(q).split(" ").filter(Boolean);
    if (!terms.length) return list.visible;
    return list.visible.filter((s) => {
      const hay = fold(`${s.title} ${s.summary ?? ""} ${s.repo ?? ""}`);
      return terms.every((t) => hay.includes(t));
    });
  }, [list.visible, q]);
  const liveIds = useMemo(() => shown.filter((s) => !list.leavingIds.has(s.id)).map((s) => s.id), [shown, list.leavingIds]);
  const sel = useSelection(liveIds);

  const agents = useMemo(() => new Map(options.agents.map((a) => [a.id, a])), [options.agents]);
  const projects = useMemo(() => new Map(options.projects.map((p) => [p.id, p])), [options.projects]);

  const after = useCallback(
    (ids: string[], op: SessionOp) => {
      // Leaving the tray: anything filed to a person/team leaves "Unfiled"; archive leaves both tabs.
      const leaves = op.type === "archive" || (tab === "unfiled" && (op.type === "assign" || op.type === "team"));
      if (leaves) {
        list.leave(ids, "move");
        sel.remove(ids);
      }
      return leaves;
    },
    [list, sel, tab],
  );

  const dropSessions = useCallback(
    (ids: string[], op: SessionOp, label: string) => {
      const clean = ids.filter((id) => typeof id === "string");
      if (!clean.length) return;
      const leaves = after(clean, op);
      run(() => bulkSessionsAction(clean, op), {
        message: (r: BulkResult) => (op.type === "archive" || op.type === "unassign" ? r.message : `${clean.length === 1 ? "Filed" : `${clean.length} sessions filed`} under ${label}`),
        onFailed: () => leaves && list.restore(clean),
        onUndone: () => leaves && list.restore(clean),
      });
    },
    [after, list, run],
  );

  const moveAgent = useCallback((agentId: string, teamId: string) => run(() => bulkAgentsAction([agentId], { type: "team", teamId })), [run]);
  const moveProject = useCallback((projectId: string, companyId: string | null) => run(() => bulkProjectsAction([projectId], { type: "company", companyId })), [run]);

  const dnd: Dnd = { dragging, hot, setHot, setDragging, dropSessions, moveAgent, moveProject };

  const companies = [...options.companies.map((c) => ({ company: c, projects: options.projects.filter((p) => p.company_id === c.id) }))];
  const loose = options.projects.filter((p) => !p.company_id);

  return (
    <DndContext.Provider value={dnd}>
      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* tray */}
        <aside className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <div className="flex h-full max-h-[80vh] flex-col gap-2 rounded-[28px] bg-white p-3 shadow-sm ring-1 ring-black/5 lg:max-h-none">
            <div className="flex rounded-xl bg-zinc-100 p-0.5" role="tablist">
              {(
                [
                  ["unfiled", `Unfiled · ${unfiled.length}`],
                  ["recent", "Recent"],
                ] as [Tab, string][]
              ).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => {
                    setTab(t);
                    setLimit(TRAY_PAGE);
                    sel.clear();
                  }}
                  className={clsx("flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold", tab === t ? "bg-white shadow-sm" : "text-zinc-500 hover:text-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter sessions…"
              aria-label="Filter sessions"
              className="rounded-xl border-0 bg-zinc-50 px-3 py-2 text-sm ring-1 ring-black/10"
            />
            <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-zinc-500">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={liveIds.length > 0 && liveIds.every((id) => sel.has(id))}
                  onChange={(e) => (e.target.checked ? sel.selectAll() : sel.clear())}
                  className="h-3.5 w-3.5 accent-amber-500"
                />
                Select all {liveIds.length}
              </label>
              <span>Drag one, or select several and drag</span>
            </div>
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {shown.length === 0 ? (
                <li className="rounded-2xl bg-emerald-50 px-3 py-6 text-center text-sm font-semibold text-emerald-800">
                  {tab === "unfiled" && !q ? "Everything is filed 🎉" : "No sessions match."}
                </li>
              ) : null}
              {shown.slice(0, limit).map((s) => {
                const { phase, effect } = list.phaseOf(s.id);
                const selected = sel.has(s.id);
                const owner = s.agent_id ? agents.get(s.agent_id) : undefined;
                const project = s.project_id ? projects.get(s.project_id) : undefined;
                return (
                  <Leaving key={s.id} phase={phase} as="li" className="board-row">
                    <div
                      draggable={phase === "idle"}
                      onDragStart={(e) => {
                        const ids = selected ? sel.ids : [s.id];
                        if (ghost.current) ghost.current.textContent = `📦 ${ids.length} sessions`;
                        startDrag(e, "sessions", JSON.stringify(ids), setDragging, ids.length > 1 ? ghost.current : null);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setHot(null);
                      }}
                      className={clsx(
                        "relative flex cursor-grab items-start gap-2 rounded-2xl bg-white px-2.5 py-2 ring-1 ring-black/10 transition active:cursor-grabbing",
                        selected && "bg-amber-50 ring-2 ring-amber-300",
                        markedClasses(phase, effect),
                      )}
                    >
                      <SelectBox checked={selected} onToggle={(shift) => sel.toggle(s.id, { shift })} label={`Select “${s.title}”`} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-amber-500" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/sessions/${s.id}`} className="line-clamp-2 text-sm font-semibold leading-snug hover:underline" draggable={false}>
                          {s.title}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                          <StatusPill status={s.status} />
                          <SourceBadge source={s.source} />
                          <Ago iso={s.last_activity_at} />
                        </div>
                        {owner || project || s.repo ? (
                          <div className="mt-1 truncate text-[11px] text-zinc-500">
                            {owner ? `👤 ${owner.name} · ` : ""}
                            {project ? `${project.emoji} ${project.name}` : ""}
                            {s.repo ? <span className="font-mono"> {s.repo}</span> : null}
                          </div>
                        ) : null}
                      </div>
                      <span aria-hidden className="mt-0.5 shrink-0 text-zinc-300">
                        ⠿
                      </span>
                    </div>
                  </Leaving>
                );
              })}
              {shown.length > limit ? (
                <li>
                  <button type="button" onClick={() => setLimit((n) => n + TRAY_PAGE)} className="w-full rounded-xl bg-zinc-50 px-3 py-2 text-xs font-bold text-zinc-600 ring-1 ring-black/5 hover:bg-zinc-100">
                    Show {Math.min(TRAY_PAGE, shown.length - limit)} more · {shown.length - limit} left
                  </button>
                </li>
              ) : null}
            </ul>
          </div>
        </aside>

        {/* org */}
        <div className="min-w-0 space-y-4">
          {companies.map(({ company, projects: ps }) => (
            <CompanyBlock key={company.id} company={company} projects={ps} options={options} counts={counts} />
          ))}
          <CompanyBlock company={null} projects={loose} options={options} counts={counts} />
        </div>
      </div>

      {/* bins appear while dragging sessions */}
      <div
        className={clsx(
          "fixed bottom-4 left-1/2 z-[65] flex w-[min(94vw,40rem)] -translate-x-1/2 gap-3 rounded-3xl bg-ink/90 p-3 text-paper shadow-2xl transition",
          dragging === "sessions" ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
        )}
      >
        <Bin id="bin:unfile" label="🚫 Unfile" hint="Take them off their teammate" op={{ type: "unassign" }} tone="border-white/30" />
        <Bin id="bin:archive" label="🗄️ Archive" hint="Hide everywhere" op={{ type: "archive" }} tone="border-rose-300/60 text-rose-100" />
      </div>

      {/* drag image for several sessions */}
      <div ref={ghost} aria-hidden className="pointer-events-none fixed -left-[9999px] top-0 rounded-2xl bg-ink px-3 py-2 text-sm font-bold text-paper shadow-xl">
        📦 sessions
      </div>

      <BulkBar count={sel.size} noun={["session", "sessions"]} onClear={sel.clear}>
        <Popover label="👤 Assign…" side="top" className={BAR_POPOVER} panelClassName="w-80">
          {(close) => (
            <OrgPicker
              options={options}
              kinds={["person", "team", "project"]}
              onPick={(p) => {
                close();
                const op = opForPick(p);
                if (op) dropSessions(sel.ids, op, p.label);
              }}
            />
          )}
        </Popover>
        <BarButton onClick={() => dropSessions(sel.ids, { type: "refile" }, "the organiser")} title="Let the AI organiser place them">
          🔄 Re-file with AI
        </BarButton>
        <BarButton tone="danger" onClick={() => dropSessions(sel.ids, { type: "archive" }, "Archive")}>
          🗄️ Archive
        </BarButton>
      </BulkBar>
    </DndContext.Provider>
  );
}
