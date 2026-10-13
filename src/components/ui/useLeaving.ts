"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How an item leaves a list: handled (green ✓, cheer), dismissed (grey), snoozed (amber), or moved elsewhere. */
export type LeaveEffect = "done" | "dismiss" | "snooze" | "move";
export type LeavePhase = "idle" | "marked" | "collapsing";

/** How long the "done" moment shows before the item folds away, and how long folding takes. */
export const MARK_MS = 1000;
export const COLLAPSE_MS = 380;
const STAGGER_MS = 45;
/** Up to this many items ripple out one after another; more than that leave together. */
const RIPPLE_MAX = 24;

type Phase = { phase: LeavePhase; effect: LeaveEffect };

function withoutMany<V>(obj: Record<string, V>, ids: string[]): Record<string, V> {
  const next = { ...obj };
  for (const id of ids) delete next[id];
  return next;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * A list whose items play an exit effect before disappearing: they are marked (e.g. flash
 * green with a ✓), then collapse, then hide. Items the server already dropped keep
 * rendering in their old spot until their exit finishes; `restore` brings items back
 * (Undo, or the action failed).
 *
 * Steps are scheduled per group of items, not per item, so clearing hundreds at once
 * costs a handful of renders.
 */
export function useLeavingList<T>(items: T[], keyOf: (item: T) => string) {
  const [state, setState] = useState<Record<string, Phase>>({});
  const [ghosts, setGhosts] = useState<Record<string, { item: T; index: number }>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  /** The exit each item is currently playing; restore() forgets it so pending steps skip it. */
  const tokens = useRef(new Map<string, number>());
  const nextToken = useRef(1);
  const timers = useRef(new Set<number>());
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => window.clearTimeout(t));
  }, []);

  const visible = useMemo(() => {
    const key = keyRef.current;
    const out = items.filter((i) => !hidden.has(key(i)));
    const present = new Set(items.map(key));
    const missing = Object.entries(ghosts)
      .filter(([id]) => !present.has(id) && !hidden.has(id))
      .sort((a, b) => a[1].index - b[1].index);
    for (const [, g] of missing) out.splice(Math.min(g.index, out.length), 0, g.item);
    return out;
  }, [items, ghosts, hidden]);

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  /**
   * Play the exit effect on these items. With `keep`, the item only flashes its stamp and
   * stays (e.g. a finished to-do in a list that shows finished ones).
   */
  const leave = useCallback((ids: string[], effect: LeaveEffect = "done", opts: { keep?: boolean } = {}) => {
    const key = keyRef.current;
    const list = visibleRef.current;
    const index = new Map(list.map((t, i) => [key(t), i]));
    const wanted = ids.filter((id) => index.has(id));
    if (!wanted.length) return;

    const token = nextToken.current++;
    for (const id of wanted) tokens.current.set(id, token);
    const live = (group: string[]) => group.filter((id) => tokens.current.get(id) === token);
    const at = (ms: number, fn: () => void) => {
      const t = window.setTimeout(() => {
        timers.current.delete(t);
        fn();
      }, ms);
      timers.current.add(t);
    };
    const mark = (group: string[], phase: LeavePhase) => {
      if (!group.length) return;
      setState((s) => {
        const next = { ...s };
        for (const id of group) next[id] = { phase, effect };
        return next;
      });
    };

    const reduce = reducedMotion();
    const markMs = reduce ? 350 : effect === "done" ? MARK_MS : effect === "move" ? 250 : 650;

    if (opts.keep) {
      at(0, () => mark(live(wanted), "marked"));
      at(markMs, () => {
        const g = live(wanted);
        g.forEach((id) => tokens.current.delete(id));
        setState((s) => withoutMany(s, g));
      });
      return;
    }

    setGhosts((g) => {
      const next = { ...g };
      for (const id of wanted) next[id] = { item: list[index.get(id)!], index: index.get(id)! };
      return next;
    });
    const collapseMs = reduce ? 0 : COLLAPSE_MS;
    // A few items ripple out one after another; many leave together.
    const stagger = reduce || wanted.length > RIPPLE_MAX ? 0 : STAGGER_MS;
    const slots = new Map<number, string[]>();
    wanted.forEach((id, n) => {
      const delay = Math.min(n, 14) * stagger;
      slots.set(delay, [...(slots.get(delay) ?? []), id]);
    });
    for (const [delay, group] of slots) {
      at(delay, () => mark(live(group), "marked"));
      at(delay + markMs, () => mark(live(group), "collapsing"));
      at(delay + markMs + collapseMs + 20, () => {
        const g = live(group);
        if (!g.length) return;
        g.forEach((id) => tokens.current.delete(id));
        setHidden((h) => {
          const next = new Set(h);
          for (const id of g) next.add(id);
          return next;
        });
        setGhosts((x) => withoutMany(x, g));
        setState((s) => withoutMany(s, g));
      });
    }
  }, []);

  /** Bring items back (Undo, or the action failed). */
  const restore = useCallback((ids: string[]) => {
    for (const id of ids) tokens.current.delete(id);
    const drop = new Set(ids);
    setHidden((h) => new Set([...h].filter((id) => !drop.has(id))));
    setState((s) => withoutMany(s, ids));
    setGhosts((g) => withoutMany(g, ids));
  }, []);

  const phaseOf = useCallback((id: string): Phase => state[id] ?? { phase: "idle", effect: "done" }, [state]);

  /** Ids currently leaving or gone — they shouldn't count as "in the list" any more. */
  const leavingIds = useMemo(() => new Set([...Object.keys(state), ...Object.keys(ghosts), ...hidden]), [state, ghosts, hidden]);

  return { visible, leave, restore, phaseOf, leavingIds };
}
