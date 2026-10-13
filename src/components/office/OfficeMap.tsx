"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { bulkTasksAction, type TaskOp } from "@/app/_actions/bulk";
import { KIND_LABEL } from "@/lib/format";
import { personHref, projectHref } from "@/lib/links";
import { DESK_W, SIGN_H, TEAM_LABEL_H, layoutOffice, nearestSeat, stepToward, type Seat } from "@/lib/office-map";
import { themeById, wallStyle } from "@/lib/themes";
import type { Pose } from "@/lib/avatar";
import type { AvatarSpec } from "@/lib/types";
import { OpenSession } from "../asks/AskActions";
import { ASK_KIND } from "../board/palette";
import { Character } from "../Character";
import { useBulkRunner } from "../ui/useBulk";

/**
 * The whole office as one walkable map, Gather style. Every project is a room, every teammate
 * sits at a desk, and you walk around: arrow keys or WASD, or click the floor. Walk up to someone
 * (or click them) to see what they're on, open their session, or clear what they're asking you.
 */

export interface MapAsk {
  id: string;
  kind: string;
  title: string;
}

export interface MapMember {
  id: string;
  name: string;
  role: string;
  avatar: AvatarSpec;
  pose: Pose;
  line: string;
  asks: MapAsk[];
  /** Their latest session, to open from the map. */
  session: { id: string; title: string; url: string | null; resume: string | null } | null;
}

export interface MapRoom {
  id: string;
  name: string;
  emoji: string;
  slug: string;
  company: string | null;
  theme: string;
  teams: { id: string; name: string; members: MapMember[] }[];
}

const SPEED = 320; // px per second
const YOU: AvatarSpec = { seed: "you-the-manager", hair: 2, outfit: 0, glasses: true };
const FLOOR =
  "repeating-conic-gradient(#efe6d6 0 25%, #e8dcc8 0 50%) 0 0/48px 48px";

export function OfficeMap({ rooms, waiting }: { rooms: MapRoom[]; waiting: number }) {
  const layout = useMemo(() => layoutOffice(rooms), [rooms]);
  const members = useMemo(() => new Map(rooms.flatMap((r) => r.teams.flatMap((t) => t.members.map((m) => [m.id, { m, room: r, team: t.name }] as const)))), [rooms]);
  const seatOf = useMemo(() => new Map(layout.seats.map((s) => [s.memberId, s])), [layout.seats]);

  const start = { x: layout.lobby.x + layout.lobby.w - 46, y: layout.lobby.y + layout.lobby.h - 18 };
  const [you, setYou] = useState(start);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [moving, setMoving] = useState(false);
  const [talkingTo, setTalkingTo] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const target = useRef<{ x: number; y: number; then?: string } | null>(null);
  const keys = useRef(new Set<string>());
  const pos = useRef(start);
  const viewport = useRef<HTMLDivElement>(null);

  const near: Seat | null = nearestSeat(layout.seats, you.x, you.y);

  const centerOn = useCallback(
    (p: { x: number; y: number }, smooth = false) => {
      const el = viewport.current;
      if (!el) return;
      el.scrollTo({ left: p.x * zoom - el.clientWidth / 2, top: p.y * zoom - el.clientHeight / 2, behavior: smooth ? "smooth" : "auto" });
    },
    [zoom],
  );

  // The walking loop: held keys move you; otherwise walk toward a clicked target.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = keys.current;
      let dx = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
      let dy = (k.has("down") ? 1 : 0) - (k.has("up") ? 1 : 0);
      let next = pos.current;
      let walking = false;
      if (dx || dy) {
        target.current = null;
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
        next = { x: next.x + dx * SPEED * dt, y: next.y + dy * SPEED * dt };
        walking = true;
        if (dx) setFacing(dx > 0 ? 1 : -1);
      } else if (target.current) {
        const t = target.current;
        const step = stepToward(next, t, SPEED * dt);
        if (t.x !== next.x) setFacing(t.x > next.x ? 1 : -1);
        next = { x: step.x, y: step.y };
        walking = !step.arrived;
        if (step.arrived) {
          if (t.then) setTalkingTo(t.then);
          target.current = null;
        }
      }
      if (next !== pos.current) {
        next = { x: Math.max(20, Math.min(layout.width - 20, next.x)), y: Math.max(40, Math.min(layout.height - 10, next.y)) };
        pos.current = next;
        setYou(next);
        centerOn(next);
      }
      setMoving(walking);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout.width, layout.height, centerOn]);

  useEffect(() => centerOn(pos.current), [centerOn]);

  const walkTo = (x: number, y: number, then?: string) => {
    setTalkingTo(null);
    target.current = { x, y, then };
    viewport.current?.focus({ preventScroll: true });
  };
  const walkToMember = (id: string) => {
    const s = seatOf.get(id);
    if (s) walkTo(s.spotX, s.spotY, id);
  };

  const KEY: Record<string, string> = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir = KEY[e.key];
    if (dir) {
      e.preventDefault();
      keys.current.add(dir);
      setTalkingTo(null);
    } else if ((e.key === "e" || e.key === "E" || e.key === "Enter") && near) {
      e.preventDefault();
      setTalkingTo(near.memberId);
    } else if (e.key === "Escape") setTalkingTo(null);
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    const dir = KEY[e.key];
    if (dir) keys.current.delete(dir);
  };

  // Rooms and desks only change when the data or who you're next to does — not on every step.
  const nearId = near?.memberId ?? null;
  const walkRef = useRef(walkToMember);
  walkRef.current = walkToMember;
  const floor = useMemo(
    () => (
      <>
              {/* Lobby: your desk */}
              <div className="absolute rounded-2xl border-[6px] border-amber-300 bg-amber-50/90 shadow-sm" style={{ left: layout.lobby.x, top: layout.lobby.y, width: layout.lobby.w, height: layout.lobby.h }}>
                <div className="flex items-center justify-between rounded-t-lg bg-amber-200 px-3" style={{ height: SIGN_H - 6 }}>
                  <span className="font-display text-base font-bold">🏠 Your desk</span>
                  <span className="rounded-full bg-rose-500 px-2 text-xs font-black text-white">{waiting}</span>
                </div>
                <div className="grid place-items-start gap-1 px-3 pt-2 text-left text-xs font-semibold text-amber-900/70" style={{ width: "62%" }}>
                  <span className="text-3xl">🖥️☕</span>
                  {waiting ? `${waiting} ask${waiting === 1 ? "" : "s"} waiting — walk over to whoever's waving.` : "Nobody's waiting on you 🎉"}
                </div>
              </div>

              {/* Rooms */}
              {layout.rooms.map((lr) => {
                const room = rooms.find((r) => r.id === lr.id)!;
                const theme = themeById(room.theme);
                return (
                  <div key={lr.id} className="absolute rounded-2xl shadow-sm" style={{ left: lr.x, top: lr.y, width: lr.w, height: lr.h, background: theme.floor, border: `6px solid ${theme.trim}` }}>
                    <div className="flex items-center gap-2 rounded-t-lg px-3" style={{ ...wallStyle(theme), height: SIGN_H - 6 }}>
                      <Link
                        data-stop
                        href={projectHref(room.slug)}
                        className={clsx("truncate font-display text-base font-bold hover:underline", theme.dark ? "text-white" : "text-ink")}
                        title="Open the project"
                      >
                        {room.emoji} {room.name}
                      </Link>
                      {room.company ? <span className={clsx("truncate text-[11px] font-semibold", theme.dark ? "text-white/60" : "text-zinc-500")}>{room.company}</span> : null}
                      <span className="ml-auto text-sm">{theme.decor.slice(0, 2).join(" ")}</span>
                    </div>
                    {/* Door */}
                    <div className="absolute -bottom-[6px] left-1/2 h-[6px] w-16 -translate-x-1/2" style={{ background: theme.floor }} />
                    {lr.teams.map((lt) => {
                      const team = room.teams.find((t) => t.id === lt.id)!;
                      return (
                        <div key={lt.id} className="absolute left-0 right-0 px-3" style={{ top: lt.y - lr.y - 6, height: TEAM_LABEL_H }}>
                          <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", theme.dark ? "bg-white/15 text-white/80" : "bg-white/60 text-zinc-600")}>{team.name}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Teammates at their desks */}
              {layout.seats.map((s) => {
                const entry = members.get(s.memberId)!;
                const m = entry.m;
                const isNear = nearId === m.id;
                const asking = m.asks.length > 0;
                return (
                  <button
                    key={s.memberId}
                    data-stop
                    type="button"
                    onClick={() => walkRef.current(m.id)}
                    className={clsx("absolute flex flex-col items-center rounded-xl transition", isNear && "bg-white/30 ring-2 ring-amber-300")}
                    style={{ left: s.x, top: s.y, width: DESK_W, height: 120 }}
                    title={`${m.name}, ${m.role}`}
                  >
                    {asking ? <span className="absolute right-3 top-0 z-10 grid h-6 w-6 animate-bounce place-items-center rounded-full bg-rose-500 text-xs font-black text-white shadow">!</span> : null}
                    <Character spec={m.avatar} pose={m.pose} size={92} />
                    <span className="-mt-1 max-w-full truncate rounded-full bg-ink/80 px-2 text-[11px] font-bold text-paper">{m.name}</span>
                  </button>
                );
              })}
      </>
    ),
    [layout, rooms, members, nearId, waiting],
  );

  const waitingMembers = [...members.values()].filter((x) => x.m.asks.length);
  const talking = talkingTo ? members.get(talkingTo) : null;
  const nearby = near && !talking ? members.get(near.memberId) : null;

  return (
    <div className="relative overflow-hidden rounded-3xl ring-1 ring-black/10">
      {/* Toolbar: who's waiting (click to walk over), rooms, zoom */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 bg-white/80 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-ink/85 px-3 py-1 text-xs font-bold text-paper shadow">🙋 {waiting} waiting on you</span>
          {waitingMembers.slice(0, 8).map(({ m }) => (
            <button
              key={m.id}
              type="button"
              onClick={() => walkToMember(m.id)}
              className="flex items-center gap-1 rounded-full bg-white/90 py-0.5 pl-0.5 pr-2 text-xs font-semibold shadow ring-1 ring-black/5 hover:bg-white"
              title={`Walk to ${m.name}`}
            >
              <Character spec={m.avatar} pose="needs_you" desk={false} size={22} />
              {m.name}
              <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-black text-white">{m.asks.length}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Go to a room"
            value=""
            onChange={(e) => {
              const r = layout.rooms.find((x) => x.id === e.target.value);
              if (r) walkTo(r.x + r.w / 2, r.y + r.h - 20);
            }}
            className="rounded-full border-0 bg-white/90 py-1 pl-3 pr-8 text-xs font-semibold shadow ring-1 ring-black/5"
          >
            <option value="">Go to a room…</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.emoji} {r.company ? `${r.company} › ` : ""}
                {r.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.45, +(z - 0.15).toFixed(2)))} aria-label="Zoom out" className="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-sm font-bold shadow ring-1 ring-black/5">
            −
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(1.3, +(z + 0.15).toFixed(2)))} aria-label="Zoom in" className="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-sm font-bold shadow ring-1 ring-black/5">
            +
          </button>
          <button type="button" onClick={() => walkTo(start.x, start.y)} className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold shadow ring-1 ring-black/5" title="Back to your desk">
            🏠 My desk
          </button>
        </div>
      </div>

      {/* The map */}
      <div
        ref={viewport}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => keys.current.clear()}
        aria-label="Office map. Arrow keys or WASD to walk, E to talk to the teammate next to you."
        className="h-[72vh] min-h-[480px] overflow-auto outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
        style={{ background: FLOOR }}
      >
        <div style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div
            className="relative origin-top-left"
            style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("[data-stop]")) return;
              const rect = e.currentTarget.getBoundingClientRect();
              walkTo((e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom);
            }}
          >
            {floor}
            {/* You */}
            <div className="pointer-events-none absolute z-10 flex flex-col items-center" style={{ left: you.x - 30, top: you.y - 78, width: 60 }}>
              <div style={{ transform: `scaleX(${facing})` }}>
                <Character spec={YOU} pose={moving ? "walking" : "idle"} stance="standing" desk={false} size={66} />
              </div>
              <span className="-mt-1 rounded-full bg-amber-400 px-2 text-[11px] font-black text-amber-950 shadow">You</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: hint, or who's next to you, or the conversation */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3">
        {talking ? (
          <TalkCard entry={talking} onClose={() => setTalkingTo(null)} />
        ) : nearby ? (
          <button type="button" onClick={() => setTalkingTo(nearby.m.id)} className="pointer-events-auto rounded-full bg-ink px-4 py-2 text-sm font-bold text-paper shadow-lg">
            Press <kbd className="rounded bg-white/20 px-1.5">E</kbd> to talk to {nearby.m.name}
            {nearby.m.asks.length ? ` · ${nearby.m.asks.length} waiting on you` : ""}
          </button>
        ) : (
          <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-zinc-600 shadow ring-1 ring-black/5">
            Click the map, then walk with <kbd className="font-mono">←↑↓→</kbd> / <kbd className="font-mono">WASD</kbd> — or click anyone to walk over
          </span>
        )}
      </div>
    </div>
  );
}

function TalkCard({ entry, onClose }: { entry: { m: MapMember; room: MapRoom; team: string }; onClose: () => void }) {
  const { m, room, team } = entry;
  const { run } = useBulkRunner();
  const [gone, setGone] = useState<string[]>([]);
  const asks = m.asks.filter((a) => !gone.includes(a.id));
  const act = (id: string, op: TaskOp) => {
    setGone((g) => [...g, id]);
    run(() => bulkTasksAction([id], op), { onFailed: () => setGone((g) => g.filter((x) => x !== id)), onUndone: () => setGone((g) => g.filter((x) => x !== id)) });
  };
  return (
    <div className="pointer-events-auto w-full max-w-xl rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-black/10">
      <div className="flex items-start gap-3">
        <Character spec={m.avatar} pose={asks.length ? "needs_you" : m.pose} desk={false} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={personHref(m.id)} className="font-display text-lg font-bold hover:underline">
              {m.name}
            </Link>
            <span className="truncate text-xs text-zinc-500">
              {m.role} · {team} · {room.emoji} {room.name}
            </span>
          </div>
          {m.line ? <p className="mt-1 rounded-xl rounded-tl-none bg-zinc-100 px-3 py-1.5 text-sm">💬 {m.line}</p> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 text-zinc-400 hover:bg-zinc-100 hover:text-ink">
          ✕
        </button>
      </div>
      {asks.length ? (
        <ul className="mt-3 space-y-1.5">
          {asks.map((a) => {
            const tone = ASK_KIND[a.kind] ?? ASK_KIND.respond;
            return (
              <li key={a.id} className="flex items-center gap-2 rounded-xl bg-zinc-50 px-2 py-1.5">
                <span className={clsx("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase text-white", tone.cls)}>{KIND_LABEL[a.kind] ?? a.kind}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={a.title}>
                  {a.title}
                </span>
                <button type="button" onClick={() => act(a.id, { type: "handled" })} className="rounded-lg bg-emerald-500 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-600" title="Done — I handled it">
                  ✓
                </button>
                <button type="button" onClick={() => act(a.id, { type: "not_needed" })} className="rounded-lg px-2 py-1 text-xs ring-1 ring-black/10 hover:bg-white" title="Not needed — make it go away">
                  🙅
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">Nothing waiting on you from {m.name}.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {m.session ? (
          <>
            <OpenSession url={m.session.url} resume={m.session.resume} small />
            <Link href={`/sessions/${m.session.id}`} className="min-w-0 truncate text-xs font-semibold text-orange-700 hover:underline">
              {m.session.title}
            </Link>
          </>
        ) : null}
        <Link href={personHref(m.id)} className="ml-auto text-xs font-semibold text-zinc-500 hover:underline">
          Their board →
        </Link>
      </div>
    </div>
  );
}
