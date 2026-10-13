"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  /** e.g. Undo. The toast closes once the action finishes. */
  action?: { label: string; run: () => Promise<void> | void };
  /** ms; errors and toasts with an action stay a little longer. */
  duration?: number;
}

interface Toast extends ToastInput {
  id: number;
}

interface ToastApi {
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICON: Record<ToastTone, string> = { success: "✓", error: "!", info: "i" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const duration = input.duration ?? (input.tone === "error" ? 8000 : input.action ? 7000 : 3500);
      // Keep the stack short: the newest five.
      setToasts((all) => [...all.slice(-4), { ...input, id }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => window.clearTimeout(t));
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="toast-region pointer-events-none fixed bottom-4 left-4 right-4 z-[70] flex flex-col items-stretch gap-2 md:right-auto md:w-96"
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const tone = toast.tone ?? "info";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="toast-in pointer-events-auto flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-paper shadow-xl ring-1 ring-black/20"
    >
      <span
        aria-hidden
        className={clsx(
          "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black",
          tone === "success" && "bg-emerald-400 text-emerald-950",
          tone === "error" && "bg-rose-400 text-rose-950",
          tone === "info" && "bg-sky-300 text-sky-950",
        )}
      >
        {ICON[tone]}
      </span>
      <span className="min-w-0 flex-1 font-semibold">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await toast.action!.run();
            } finally {
              onClose();
            }
          }}
          className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-300 hover:bg-white/20 disabled:opacity-50"
        >
          {busy ? "…" : toast.action.label}
        </button>
      ) : null}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="shrink-0 text-paper/50 hover:text-paper">
        ✕
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast needs <ToastProvider>");
  return ctx;
}
