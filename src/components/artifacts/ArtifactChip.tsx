import Link from "next/link";

/** "🖼️ 3": how many artifacts a session or goal made; opens where they're listed. */
export function ArtifactChip({ count, href }: { count: number | undefined; href: string }) {
  if (!count) return null;
  return (
    <Link
      href={href}
      title={`${count} artifact${count === 1 ? "" : "s"}`}
      className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-800 hover:bg-violet-200"
    >
      🖼️ {count}
    </Link>
  );
}
