import { InboxBoard, type InboxFilters } from "@/components/asks/InboxBoard";
import { toAskView } from "@/lib/ask-view";
import { getInbox, getOrg, getSnoozedCount } from "@/lib/queries";

const KEYS = ["q", "company", "project", "kind", "source", "age", "sort", "group"] as const;

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const org = await getOrg();
  const [inbox, snoozed] = await Promise.all([getInbox(org), getSnoozedCount()]);
  const asks = inbox.map((item) => toAskView(item, org));
  const initial: Partial<InboxFilters> = {};
  for (const k of KEYS) {
    const v = sp[k];
    if (typeof v === "string" && v) (initial as Record<string, string>)[k] = v;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">🙋 Needs you</h1>
          <p className="text-zinc-600">
            Everything your teammates are waiting on. Filter, select many, and clear them in one go — every action can be undone.
          </p>
        </div>
      </header>
      <InboxBoard asks={asks} snoozed={snoozed} initial={initial} />
    </div>
  );
}
