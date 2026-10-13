import Link from "next/link";
import { Character } from "./Character";
import type { Pose } from "@/lib/avatar";
import type { InboxItem } from "@/lib/queries";
import type { PropKind } from "@/lib/types";
import { personHref, projectHref } from "@/lib/links";

const KIND_POSE: Record<string, Pose> = { respond: "needs_you", decide: "needs_you", review: "review", unblock: "failed", run: "failed" };

interface Visitor {
  key: string;
  name: string;
  role: string;
  seed: string;
  prop?: PropKind;
  pose: Pose;
  ask: string;
  more: number;
  href: string;
  personId: string | null;
  project: InboxItem["project"];
}

/** Group asks by teammate: each person queues once, carrying their most recent ask. */
function visitors(items: InboxItem[]): Visitor[] {
  const byKey = new Map<string, Visitor>();
  for (const it of items) {
    const key = it.agent?.id ?? `s:${it.session.id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.more++;
      continue;
    }
    byKey.set(key, {
      key,
      name: it.agent?.name ?? "A visitor",
      role: it.agent?.role ?? it.session.title,
      seed: it.agent?.avatar.seed ?? it.session.title,
      prop: it.agent?.avatar.prop,
      pose: KIND_POSE[it.task.kind] ?? "needs_you",
      ask: it.task.title,
      more: 0,
      href: it.session.url ?? "/",
      personId: it.agent?.id ?? null,
      project: it.project,
    });
  }
  return [...byKey.values()];
}

/**
 * Your corner office. Teammates who need you leave their desks and queue up here
 * with their ask in a speech bubble.
 */
export function ManagerDesk({ items, max = 6, title = "Your desk" }: { items: InboxItem[]; max?: number; title?: string }) {
  const queue = visitors(items);
  const shown = queue.slice(0, max);
  const yourPose: Pose = queue.length === 0 ? "done" : queue.length > 4 ? "failed" : "thinking";
  const mood =
    queue.length === 0 ? "Inbox zero. Enjoy it." : queue.length > 4 ? `${queue.length} teammates are lined up. Busy day!` : `${queue.length} teammate${queue.length === 1 ? " is" : "s are"} waiting for you.`;

  return (
    <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#3b2f2a] to-[#211a17] p-5 text-paper shadow-lg ring-1 ring-black/20">
      {/* rug + wall */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[#5b3d2e]" />
      <div className="pointer-events-none absolute bottom-3 left-1/2 h-12 w-[80%] -translate-x-1/2 rounded-[50%] bg-[#8a3b3b]/60" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="flex shrink-0 flex-col items-center">
          <div className="mb-1 text-center">
            <h2 className="font-display text-xl font-bold">{title}</h2>
            <p className="text-xs text-white/70">{mood}</p>
          </div>
          <div className="rounded-3xl bg-white/5 p-1">
            <Character spec={{ seed: "you:manager", prop: "mug", glasses: true }} pose={yourPose} size={190} title="You" />
          </div>
          <span className="-mt-2 rounded-full bg-amber-400 px-3 py-0.5 text-xs font-black text-ink shadow">YOU</span>
        </div>

        <div className="min-w-0 flex-1">
          {shown.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-2xl border-2 border-dashed border-white/20 p-8 text-sm text-white/60">
              Nobody is waiting. Your team is heads-down. ☕
            </div>
          ) : (
            <ol className="flex flex-wrap items-end justify-center gap-x-1 gap-y-4 pb-2 pt-2 lg:justify-start">
              {shown.map((v, i) => (
                <li key={v.key} className="arrive flex w-[140px] shrink-0 flex-col items-center" style={{ animationDelay: `${i * 0.12}s` }}>
                  <Link
                    href={v.href}
                    target={v.href.startsWith("http") ? "_blank" : undefined}
                    className="bubble mb-2 block w-full rounded-2xl border-2 border-rose-200 bg-white px-2.5 py-2 text-[11px] font-semibold leading-snug text-zinc-700 shadow hover:border-rose-400"
                  >
                    <span className="line-clamp-4">{v.ask}</span>
                    {v.more ? <span className="mt-1 block text-[10px] font-bold text-rose-600">+{v.more} more</span> : null}
                  </Link>
                  <Character
                    spec={{ seed: v.seed, prop: v.prop }}
                    pose={v.pose}
                    stance="standing"
                    carry={v.pose === "failed" ? "paper" : undefined}
                    size={92}
                    title={`${v.name}: ${v.ask}`}
                  />
                  <div className="mt-1 flex flex-col items-center text-center">
                    {v.personId ? (
                      <Link href={personHref(v.personId)} className="text-sm font-bold hover:underline">
                        {v.name}
                      </Link>
                    ) : (
                      <div className="text-sm font-bold">{v.name}</div>
                    )}
                    <div className="max-w-[140px] truncate text-[10px] text-white/60">{v.role}</div>
                    {v.project ? (
                      <Link href={projectHref(v.project.slug)} className="mt-0.5 max-w-[140px] truncate rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 hover:bg-white/20">
                        {v.project.emoji} {v.project.name}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
              {queue.length > max ? (
                <li className="shrink-0 self-center px-3 text-sm font-bold text-white/70">+{queue.length - max} more in line</li>
              ) : null}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
