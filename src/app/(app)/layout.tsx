import Link from "next/link";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { SyncButton } from "@/components/SyncButton";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { ToastProvider } from "@/components/ui/Toaster";
import { getNav } from "@/lib/home";
import { isSetupComplete } from "@/lib/organize";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSetupComplete())) redirect("/setup");
  const { counts, tree } = await getNav();

  return (
    <ToastProvider>
      <div className="mx-auto flex min-h-screen max-w-[88rem] flex-col gap-6 px-4 py-4 md:flex-row md:px-6 md:py-8">
        {/* The whole sidebar scrolls as one (no inner scroll box for the project tree); its scrollbar is hidden. */}
        <aside className="md:sticky md:top-8 md:max-h-[calc(100vh-4rem)] md:w-60 md:shrink-0 md:overflow-y-auto md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden">
          <div className="flex min-h-full flex-col gap-4">
            <Link href="/" className="flex items-center gap-2 px-2">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-xl text-paper shadow">🐝</span>
              <span>
                <span className="block font-display text-2xl font-bold leading-none">Timu</span>
                <span className="text-xs font-semibold text-zinc-500">your Claude team</span>
              </span>
            </Link>
            <Nav counts={counts} tree={tree} />
            <div className="mt-auto hidden md:block">
              <SyncButton />
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 pb-24">{children}</main>
      </div>
      <CommandPalette />
    </ToastProvider>
  );
}
