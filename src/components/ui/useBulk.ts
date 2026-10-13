"use client";

import { useCallback, useTransition } from "react";
import { undoAction, type BulkResult } from "@/app/_actions/bulk";
import { useToast } from "./Toaster";

export interface RunOptions {
  /** Called when the action succeeds (before the toast). */
  onOk?: (r: BulkResult) => void;
  /** Called when the action fails, so optimistic UI can roll back. */
  onFailed?: () => void;
  /** Called after Undo restored everything. */
  onUndone?: () => void;
  /** Override the success toast text. */
  message?: (r: BulkResult) => string;
}

/**
 * Run a bulk server action with a toast for the result and, when the action returned an
 * undo snapshot, an Undo button that restores it.
 */
export function useBulkRunner() {
  const { toast } = useToast();
  const [pending, start] = useTransition();

  const run = useCallback(
    (fn: () => Promise<BulkResult>, opts: RunOptions = {}) => {
      start(async () => {
        let r: BulkResult;
        try {
          r = await fn();
        } catch (err) {
          r = { ok: false, count: 0, message: err instanceof Error ? err.message : String(err) };
        }
        if (!r.ok) {
          opts.onFailed?.();
          toast({ message: r.message, tone: "error" });
          return;
        }
        opts.onOk?.(r);
        const undo = r.undo;
        toast({
          message: opts.message ? opts.message(r) : r.message,
          tone: "success",
          action: undo
            ? {
                label: "Undo",
                run: async () => {
                  const u = await undoAction(undo);
                  if (u.ok) opts.onUndone?.();
                  toast({ message: u.ok ? "Undone." : u.message, tone: u.ok ? "info" : "error" });
                },
              }
            : undefined,
        });
      });
    },
    [toast],
  );

  return { run, pending };
}
