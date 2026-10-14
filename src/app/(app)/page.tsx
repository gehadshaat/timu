import Link from "next/link";
import { Character } from "@/components/Character";
import { RecentSessions } from "@/components/home/RecentSessions";
import { CompanySection } from "@/components/home/Structure";
import { getHome } from "@/lib/home";
import { getSessions, orgOptions } from "@/lib/queries";
import { POSE_LABEL } from "@/lib/avatar";

export default async function HomePage() {
  const [home, recent] = await Promise.all([getHome(), getSessions({ limit: 3 })]);
  const { totals: t } = home;
  const now = Date.now();
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const companies = home.companies.filter((c) => c.company);
  const loose = home.companies.find((c) => !c.company);
  const asksByProject: Record<string, string[]> = {};
  const askBySession: Record<string, string> = {};
  for (const it of home.inbox) {
    if (it.project) (asksByProject[it.project.id] ??= []).push(it.task.id);
    askBySession[it.session.id] ??= it.task.id;
  }
  const goalTitles = Object.fromEntries(home.org.goals.map((g) => [g.id, g.title]));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-amber-100 via-orange-50 to-rose-100 px-5 pt-4 ring-1 ring-black/5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="pb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-orange-700/70">{greeting}</p>
          <h1 className="mt-0.5 font-display text-2xl font-bold sm:text-3xl">
            {t.asks === 0 ? (
              "Nobody is waiting on you 🎉"
            ) : (
              <Link href="/inbox" className="hover:underline">
                {t.asks} thing{t.asks === 1 ? "" : "s"} need{t.asks === 1 ? "s" : ""} you
              </Link>
            )}
          </h1>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
            <StatChip href="/office" label="working now" value={t.working} tone={t.working ? "bg-emerald-100 text-emerald-800" : undefined} />
            <StatChip href="/digest" label="shipped this week" value={t.shipped7d} />
            <StatChip
              href="/projects"
              label={t.goals ? `across ${t.goals} active goal${t.goals === 1 ? "" : "s"}` : "no active goals"}
              value={t.goalProgress === null ? "—" : `${Math.round(t.goalProgress * 100)}%`}
            />
            {t.stuck ? <StatChip href="/inbox" label="stuck" value={t.stuck} tone="bg-orange-100 text-orange-800" /> : null}
            {home.unfiled ? <StatChip href="/organize" label="unfiled" value={home.unfiled} tone="bg-amber-200 text-amber-950" /> : null}
          </div>
        </div>
        <div className="hidden items-end -space-x-4 self-end sm:flex">
          {home.cast.map((m) => (
            <Link key={m.agent.id} href={`/people/${m.agent.id}`} title={`${m.agent.name} — ${POSE_LABEL[m.pose]}`}>
              <Character spec={m.agent.avatar} pose={m.pose} size={64} desk={false} />
            </Link>
          ))}
        </div>
      </header>

      <RecentSessions sessions={recent} options={orgOptions(home.org)} asks={askBySession} goals={goalTitles} />

      <div className="min-w-0 space-y-5">
        {companies.map((c) => (
          <CompanySection key={c.company!.id} card={c} now={now} asks={asksByProject} />
        ))}
        {loose ? <CompanySection card={loose} now={now} asks={asksByProject} /> : null}
        {!home.companies.length ? (
          <div className="rounded-3xl border-2 border-dashed border-zinc-300 p-10 text-center text-zinc-500">
            No projects yet.{" "}
            <Link href="/settings" className="font-semibold text-orange-700 hover:underline">
              Import your sessions
            </Link>{" "}
            and Timu will organise them into companies, projects and teams.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatChip({ href, label, value, tone }: { href: string; label: string; value: number | string; tone?: string }) {
  return (
    <Link href={href} className={`rounded-full px-2.5 py-1 ring-1 ring-black/5 hover:brightness-95 ${tone ?? "bg-white/70 text-zinc-700"}`}>
      <span className="font-black">{value}</span> {label}
    </Link>
  );
}
