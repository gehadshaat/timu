"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";

/**
 * "5m ago", shown once the page is in the browser. The server's clock and the browser's differ, so
 * text rendered during hydration can disagree ("4m" vs "5m"), and React then re-renders the whole page.
 */
export function Ago({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <span className={className}>{mounted ? timeAgo(iso) : ""}</span>;
}
