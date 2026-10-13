const STYLE: Record<string, string> = {
  working: "bg-sky-100 text-sky-800",
  needs_you: "bg-rose-100 text-rose-800",
  review: "bg-amber-100 text-amber-800",
  idle: "bg-zinc-100 text-zinc-600",
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-orange-100 text-orange-800",
};

const LABEL: Record<string, string> = {
  working: "Working",
  needs_you: "Needs you",
  review: "Review ready",
  idle: "Idle",
  done: "Done",
  failed: "Failed",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${STYLE[status] ?? STYLE.idle}`}>
      {LABEL[status] ?? status}
    </span>
  );
}
