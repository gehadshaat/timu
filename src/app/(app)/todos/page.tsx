import Link from "next/link";
import { QuickAdd } from "@/components/todos/QuickAdd";
import { TodoBoard } from "@/components/todos/TodoBoard";
import { TodoList } from "@/components/TodoList";
import { getOrg, getTodos, orgOptions } from "@/lib/queries";

export default async function TodosPage({ searchParams }: { searchParams: Promise<{ done?: string; view?: string }> }) {
  const { done, view } = await searchParams;
  const list = view === "list";
  const href = (p: { done?: boolean; list?: boolean }) => {
    const q = new URLSearchParams();
    if (p.done) q.set("done", "1");
    if (p.list) q.set("view", "list");
    return q.size ? `/todos?${q}` : "/todos";
  };
  const [org, todos] = await Promise.all([getOrg(), getTodos({ includeDone: done === "1" })]);
  const options = orgOptions(org);
  const open = todos.filter((t) => t.task.status !== "done").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">✅ My to-dos</h1>
          <p className="text-zinc-600">
            Your own list, plus work you&apos;ve handed to teammates ({open} open). Paste a whole list to add many at once; select several to finish, reassign or
            reschedule them together.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Link href={href({ done: done !== "1", list })} className="text-zinc-500 hover:underline">
            {done === "1" ? "Hide finished" : "Show finished"}
          </Link>
          <span className="flex rounded-xl bg-white p-0.5 ring-1 ring-black/10" role="group" aria-label="View">
            <Link href={href({ done: done === "1" })} aria-current={!list ? "page" : undefined} className={!list ? "rounded-lg bg-ink px-2.5 py-1 text-paper" : "rounded-lg px-2.5 py-1 text-zinc-600 hover:bg-black/5"}>
              ▦ Board
            </Link>
            <Link href={href({ done: done === "1", list: true })} aria-current={list ? "page" : undefined} className={list ? "rounded-lg bg-ink px-2.5 py-1 text-paper" : "rounded-lg px-2.5 py-1 text-zinc-600 hover:bg-black/5"}>
              ☰ List · bulk edit
            </Link>
          </span>
        </div>
      </header>

      <div className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <QuickAdd options={options} />
      </div>

      {list ? (
        <TodoList items={todos} options={options} groupByAgent keepDone={done === "1"} empty="Nothing on your plate." />
      ) : (
        <TodoBoard items={todos} options={options} empty="Nothing on your plate." />
      )}
    </div>
  );
}
