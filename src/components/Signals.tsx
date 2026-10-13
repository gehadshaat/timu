import clsx from "clsx";
import { HEALTH_LABEL, SPARK_DAYS, type Health, type Signals } from "@/lib/signals";
import { timeAgo } from "@/lib/format";

const HEALTH_DOT: Record<Health, string> = {
  stuck: "bg-orange-500",
  needs_you: "bg-rose-500",
  active: "bg-emerald-500",
  quiet: "bg-sky-400",
  dormant: "bg-zinc-300",
  empty: "bg-zinc-200",
};

const HEALTH_CHIP: Record<Health, string> = {
  stuck: "bg-orange-100 text-orange-800",
  needs_you: "bg-rose-100 text-rose-700",
  active: "bg-emerald-100 text-emerald-800",
  quiet: "bg-sky-100 text-sky-800",
  dormant: "bg-zinc-100 text-zinc-500",
  empty: "bg-zinc-100 text-zinc-400",
};

export function HealthDot({ health, className }: { health: Health; className?: string }) {
  return (
    <span className={clsx("relative inline-flex h-2.5 w-2.5 shrink-0", className)} title={HEALTH_LABEL[health]}>
      {health === "needs_you" || health === "stuck" ? (
        <span className={clsx("absolute inset-0 animate-ping rounded-full opacity-50", HEALTH_DOT[health])} />
      ) : null}
      <span className={clsx("relative inline-flex h-2.5 w-2.5 rounded-full", HEALTH_DOT[health])} />
    </span>
  );
}

export function HealthChip({ health }: { health: Health }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold", HEALTH_CHIP[health])}>
      <HealthDot health={health} />
      {HEALTH_LABEL[health]}
    </span>
  );
}

/** 14 days of activity as tiny bars; today is on the right. */
export function Sparkline({ data, className, tone = "amber" }: { data: number[]; className?: string; tone?: "amber" | "emerald" | "zinc" }) {
  const max = Math.max(1, ...data);
  const w = 4;
  const gap = 2;
  const h = 22;
  const fill = { amber: "#f59e0b", emerald: "#10b981", zinc: "#a1a1aa" }[tone];
  const total = data.reduce((a, b) => a + b, 0);
  return (
    <svg
      viewBox={`0 0 ${data.length * (w + gap) - gap} ${h}`}
      className={clsx("h-[22px] w-[82px] shrink-0", className)}
      role="img"
      aria-label={`${total} session-days of activity in the last ${SPARK_DAYS} days`}
    >
      {data.map((v, i) => {
        const bh = v ? Math.max(3, Math.round((v / max) * h)) : 2;
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1.5} fill={v ? fill : "#e4e4e7"} opacity={i === data.length - 1 ? 1 : 0.75} />;
      })}
    </svg>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className={clsx("block h-1.5 overflow-hidden rounded-full bg-black/5", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span className="block h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** The compact row of vital signs shown on project, department and company cards. */
export function SignalRow({ s, compact = false }: { s: Signals; compact?: boolean }) {
  const items: { show: boolean; node: React.ReactNode; title: string }[] = [
    { show: s.asks > 0, title: "Asks waiting on you", node: <span className="font-bold text-rose-600">🙋 {s.asks}</span> },
    { show: s.stuck > 0, title: "Stuck (failed) sessions in the last 30 days", node: <span className="font-bold text-orange-600">⚠️ {s.stuck}</span> },
    { show: s.working > 0, title: "Working right now", node: <span className="text-emerald-700">⚙️ {s.working}</span> },
    { show: s.shipped7d > 0, title: "Shipped in the last 7 days", node: <span className="text-sky-700">🚀 {s.shipped7d}</span> },
    { show: !compact, title: "Sessions", node: <span className="text-zinc-500">💬 {s.sessions}</span> },
    { show: !compact && s.people > 0, title: "Teammates", node: <span className="text-zinc-500">🧑 {s.people}</span> },
  ];
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
      {items
        .filter((i) => i.show)
        .map((i) => (
          <span key={i.title} title={i.title}>
            {i.node}
          </span>
        ))}
      {s.lastActive ? <span className="text-zinc-400">· {timeAgo(s.lastActive)}</span> : null}
    </span>
  );
}
