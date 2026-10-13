import { SOURCE_LABEL } from "@/lib/format";

const STYLE: Record<string, string> = {
  cloud: "bg-violet-100 text-violet-800 ring-violet-200",
  local: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  claude_ai: "bg-orange-100 text-orange-800 ring-orange-200",
};

const ICON: Record<string, string> = { cloud: "☁️", local: "💻", claude_ai: "💬" };

export function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STYLE[source] ?? "bg-zinc-100 text-zinc-700 ring-zinc-200"}`}>
      <span aria-hidden>{ICON[source]}</span>
      {SOURCE_LABEL[source] ?? source}
    </span>
  );
}
