"use client";

import { useCallback } from "react";
import { notNeededAction } from "@/app/actions";
import { bulkSessionsAction, bulkTasksAction } from "@/app/_actions/bulk";
import type { AskView } from "@/lib/ask-view";
import { useToast } from "../ui/Toaster";
import { useBulkRunner } from "../ui/useBulk";
import type { LeaveEffect } from "../ui/useLeaving";

interface LeavingApi {
  leave: (ids: string[], effect?: LeaveEffect) => void;
  restore: (ids: string[]) => void;
}

/**
 * Handled / not needed / snooze / archive for one or many asks. Each plays its exit
 * effect right away (handled: green ✓, the teammate cheers, the card folds away), then
 * saves; failures and Undo bring the cards back.
 */
export function useAskActions(list: LeavingApi, asks: () => AskView[], onGone?: (ids: string[]) => void) {
  const { run, pending } = useBulkRunner();
  const { toast } = useToast();

  const go = useCallback(
    (ids: string[], effect: LeaveEffect, action: () => ReturnType<typeof bulkTasksAction>, message: (n: number) => string) => {
      if (!ids.length) return;
      list.leave(ids, effect);
      onGone?.(ids);
      run(action, {
        onFailed: () => list.restore(ids),
        onUndone: () => list.restore(ids),
        message: () => message(ids.length),
      });
    },
    [list, onGone, run],
  );

  const handled = useCallback(
    (ids: string[]) => go(ids, "done", () => bulkTasksAction(ids, { type: "handled" }), (n) => (n === 1 ? "Handled ✓ — nice." : `${n} asks handled ✓`)),
    [go],
  );

  const notNeeded = useCallback(
    (ids: string[], why?: string) => {
      if (why?.trim() && ids.length === 1) {
        // Teaching a rule goes through the memory-saving path (no undo for the rule itself).
        list.leave(ids, "dismiss");
        onGone?.(ids);
        notNeededAction(ids[0], why)
          .then((r) => toast({ message: r.message, tone: r.ok ? "success" : "error" }))
          .catch((err) => {
            list.restore(ids);
            toast({ message: err instanceof Error ? err.message : String(err), tone: "error" });
          });
        return;
      }
      go(ids, "dismiss", () => bulkTasksAction(ids, { type: "not_needed" }), (n) => (n === 1 ? "Dismissed — not needed." : `${n} asks dismissed`));
    },
    [go, list, onGone, toast],
  );

  const snooze = useCallback(
    (ids: string[], hours: number, label: string) =>
      go(ids, "snooze", () => bulkTasksAction(ids, { type: "snooze", hours }), (n) => `${n === 1 ? "Snoozed" : `${n} asks snoozed`} · back ${label.toLowerCase()}`),
    [go],
  );

  /** Archive the sessions behind these asks (closes the asks too). */
  const archive = useCallback(
    (ids: string[]) => {
      const byId = new Map(asks().map((a) => [a.id, a]));
      const sessionIds = [...new Set(ids.map((id) => byId.get(id)?.session.id).filter((x): x is string => !!x))];
      go(ids, "move", () => bulkSessionsAction(sessionIds, { type: "archive" }), (n) => `Archived ${n === 1 ? "the session" : `${n} sessions`}`);
    },
    [asks, go],
  );

  return { handled, notNeeded, snooze, archive, pending };
}
