import { OfficeMap, type MapRoom } from "@/components/office/OfficeMap";
import { resumeFor } from "@/lib/links";
import { getInbox, getOffice, getOrg } from "@/lib/queries";

/** The whole office on one walkable map: a room per project, a desk per teammate. */
export default async function OfficePage() {
  const [office, inbox, org] = await Promise.all([getOffice(), getInbox(), getOrg()]);
  const company = (id: string | null) => org.companies.find((c) => c.id === id) ?? null;

  const rooms = new Map<string, MapRoom>();
  for (const t of office) {
    const p = t.project;
    if (!rooms.has(p.id)) rooms.set(p.id, { id: p.id, name: p.name, emoji: p.emoji, slug: p.slug, company: company(p.company_id)?.name ?? null, theme: p.theme, teams: [] });
    rooms.get(p.id)!.teams.push({
      id: t.team.id,
      name: t.team.name,
      members: t.members.map((m) => {
        const latest = [...m.sessions].sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""))[0];
        return {
          id: m.agent.id,
          name: m.agent.name,
          role: m.agent.role,
          avatar: m.agent.avatar,
          pose: m.pose,
          line: m.line,
          asks: m.openTasks.map((a) => ({ id: a.id, kind: a.kind, title: a.title })),
          session: latest ? { id: latest.id, title: latest.title, url: latest.url, resume: resumeFor(latest) } : null,
        };
      }),
    });
  }
  // A company's projects sit next to each other; rooms without a company come last.
  const list = [...rooms.values()]
    .filter((r) => r.teams.some((t) => t.members.length))
    .sort((a, b) => Number(!a.company) - Number(!b.company) || (a.company ?? "").localeCompare(b.company ?? "") || a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-3xl font-bold">The office</h1>
        <p className="text-zinc-600">
          Everyone on one floor. Walk around with the arrow keys or WASD (or click anywhere), and walk up to a teammate to see what they&apos;re on, open their session, or clear what they&apos;re asking you.
        </p>
      </header>
      <OfficeMap rooms={list} waiting={inbox.length} />
    </div>
  );
}
