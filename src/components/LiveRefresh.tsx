"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Window event carrying the latest SyncStatus from /api/events; SyncButton listens for it. */
export const SYNC_EVENT = "timu:sync";

/** Wait this long after a change before refreshing, so a burst of writes refreshes once. */
const SETTLE_MS = 300;

/** Typing somewhere? Then a refresh waits until you leave the field. */
const editing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/**
 * Keeps the open page current: listens to /api/events and refreshes the server components when the
 * database changes (a sync found something, Claude changed something over MCP, another tab did).
 * Only the visible tab listens; a tab you come back to refreshes once.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting = false;

    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        waiting = document.visibilityState !== "visible" || editing();
        if (!waiting) router.refresh();
      }, SETTLE_MS);
    };
    const open = () => {
      if (source) return;
      source = new EventSource("/api/events");
      source.addEventListener("change", refresh);
      source.addEventListener("sync", (e) => window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: JSON.parse((e as MessageEvent).data) })));
    };
    const close = () => {
      source?.close();
      source = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        open();
        refresh(); // catch up on whatever changed while the tab was hidden
      } else close();
    };
    const onFocusOut = () => {
      if (waiting) refresh();
    };

    if (document.visibilityState === "visible") open();
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      close();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [router]);

  return null;
}
