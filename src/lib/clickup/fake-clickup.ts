/**
 * An in-memory stand-in for the parts of ClickUp's API the mirror uses, for tests. Hand `fetch` to a
 * ClickUpClient. It keeps spaces, folders, lists, tasks and tags, enforces that a task's status exists
 * in its list, and logs every request.
 */
import type { ClickUpStatus } from "./client";

export interface FakeTask {
  id: string;
  list: string;
  name: string;
  markdown: string;
  status: string;
  priority: number | null;
  due_date: number | null;
  start_date: number | null;
  tags: string[];
  parent: string | null;
  archived: boolean;
}

const DEFAULT_STATUSES: ClickUpStatus[] = [
  { status: "to do", type: "open", orderindex: 0 },
  { status: "complete", type: "closed", orderindex: 1 },
];

export class FakeClickUp {
  workspaces = [{ id: "9001", name: "Sunbeam workspace" }];
  spaces: { id: string; workspace: string; name: string; statuses: ClickUpStatus[]; tags: string[] }[] = [];
  folders: { id: string; space: string; name: string }[] = [];
  lists: { id: string; space: string; folder: string | null; name: string; statuses: ClickUpStatus[] | null }[] = [];
  tasks = new Map<string, FakeTask>();
  log: string[] = [];
  /** Statuses a newly made space gets (ClickUp's API can't set them). */
  newSpaceStatuses: ClickUpStatus[] = DEFAULT_STATUSES;
  /** Fail the next requests matching a pattern with a status, e.g. a 429 for "POST /list". */
  failures: { match: RegExp; status: number; headers?: Record<string, string>; times: number }[] = [];
  /** When set, every response carries these rate-limit headers. */
  rateHeaders: Record<string, string> | null = null;
  private seq = 100;

  private id = (prefix = "") => `${prefix}${++this.seq}`;

  statusesOf(listId: string): ClickUpStatus[] {
    const list = this.lists.find((l) => l.id === listId)!;
    return list.statuses ?? this.spaces.find((s) => s.id === list.space)!.statuses;
  }

  writes(): string[] {
    return this.log.filter((l) => !l.startsWith("GET "));
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/api\/v[23]/, "");
    const line = `${method} ${path}`;
    this.log.push(line);
    const fail = this.failures.find((f) => f.times > 0 && f.match.test(line));
    if (fail) {
      fail.times--;
      return this.reply(fail.status, { err: "Injected failure", ECODE: "TEST" }, fail.headers);
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    return this.route(method, path.split("/").filter(Boolean).map(decodeURIComponent), body);
  };

  private reply(status: number, json: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json", ...(this.rateHeaders ?? {}), ...headers } });
  }

  private route(method: string, p: string[], body: Record<string, unknown>): Response {
    const [a, b, c, d, e, f] = p;
    const notFound = () => this.reply(404, { err: "Not found", ECODE: "ITEM_015" });
    // workspaces and spaces
    if (method === "GET" && a === "team" && !b) return this.reply(200, { teams: this.workspaces.map((w) => ({ id: w.id, name: w.name, members: [] })) });
    if (a === "team" && c === "space") {
      if (method === "GET") return this.reply(200, { spaces: this.spaces.filter((s) => s.workspace === b).map((s) => ({ id: s.id, name: s.name, statuses: s.statuses })) });
      const space = { id: this.id("s"), workspace: b, name: String(body.name), statuses: this.newSpaceStatuses, tags: [] as string[] };
      this.spaces.push(space);
      return this.reply(200, { id: space.id, name: space.name, statuses: space.statuses });
    }
    // folders
    if (a === "space" && c === "folder") {
      if (method === "GET") return this.reply(200, { folders: this.folders.filter((x) => x.space === b) });
      const folder = { id: this.id("f"), space: b, name: String(body.name) };
      this.folders.push(folder);
      return this.reply(200, folder);
    }
    if (a === "folder" && !c && method === "PUT") {
      const folder = this.folders.find((x) => x.id === b);
      if (!folder) return notFound();
      folder.name = String(body.name);
      return this.reply(200, folder);
    }
    // lists
    if ((a === "folder" || a === "space") && c === "list") {
      const space = a === "space" ? b : this.folders.find((x) => x.id === b)?.space;
      if (!space) return notFound();
      const folder = a === "folder" ? b : null;
      if (method === "GET") return this.reply(200, { lists: this.lists.filter((l) => l.space === space && l.folder === folder).map((l) => ({ id: l.id, name: l.name })) });
      const list = { id: this.id("l"), space, folder, name: String(body.name), statuses: null };
      this.lists.push(list);
      return this.reply(200, { id: list.id, name: list.name, statuses: this.statusesOf(list.id) });
    }
    if (a === "list" && !c) {
      const list = this.lists.find((l) => l.id === b);
      if (!list) return notFound();
      if (method === "PUT") list.name = String(body.name);
      return this.reply(200, { id: list.id, name: list.name, statuses: this.statusesOf(list.id) });
    }
    // tasks
    if (a === "list" && c === "task" && method === "POST") {
      const list = this.lists.find((l) => l.id === b);
      if (!list) return notFound();
      const status = this.checkStatus(b, body.status);
      if (status === null) return this.reply(400, { err: "Status does not exist", ECODE: "CRTSK_001" });
      const task: FakeTask = {
        id: this.id("t"),
        list: b,
        name: String(body.name),
        markdown: String(body.markdown_content ?? ""),
        status,
        priority: (body.priority as number | null) ?? null,
        due_date: (body.due_date as number | null) ?? null,
        start_date: (body.start_date as number | null) ?? null,
        tags: ((body.tags as string[]) ?? []).map((t) => t.toLowerCase()),
        parent: (body.parent as string | null) ?? null,
        archived: !!body.archived,
      };
      if (task.parent && this.tasks.get(task.parent)?.list !== b) return this.reply(400, { err: "Parent must be in the same list", ECODE: "CRTSK_002" });
      this.tasks.set(task.id, task);
      return this.reply(200, { id: task.id, url: `https://app.clickup.com/t/${task.id}` });
    }
    if (a === "task" && !c && method === "PUT") {
      const task = this.tasks.get(b);
      if (!task) return notFound();
      if (body.status !== undefined) {
        const status = this.checkStatus(task.list, body.status);
        if (status === null) return this.reply(400, { err: "Status does not exist", ECODE: "ITEM_114" });
        task.status = status;
      }
      if (body.name !== undefined) task.name = String(body.name);
      if (body.markdown_content !== undefined) task.markdown = String(body.markdown_content);
      if (body.priority !== undefined) task.priority = body.priority as number | null;
      if (body.due_date !== undefined) task.due_date = body.due_date as number | null;
      if (body.start_date !== undefined) task.start_date = body.start_date as number | null;
      if (body.archived !== undefined) task.archived = !!body.archived;
      return this.reply(200, { id: task.id });
    }
    if (a === "task" && c === "tag") {
      const task = this.tasks.get(b);
      if (!task) return notFound();
      if (method === "POST" && !task.tags.includes(d.toLowerCase())) task.tags.push(d.toLowerCase());
      if (method === "DELETE") task.tags = task.tags.filter((t) => t !== d.toLowerCase());
      return this.reply(200, {});
    }
    if (a === "space" && c === "tag") {
      const space = this.spaces.find((s) => s.id === b);
      if (!space) return notFound();
      if (method === "GET") return this.reply(200, { tags: space.tags.map((name) => ({ name, tag_fg: "#fff", tag_bg: "#000" })) });
      space.tags.push(String((body.tag as { name: string }).name).toLowerCase());
      return this.reply(200, {});
    }
    // v3 move: /workspaces/{w}/tasks/{t}/home_list/{l}
    if (a === "workspaces" && c === "tasks" && e === "home_list" && method === "PUT") {
      const task = this.tasks.get(d);
      const list = this.lists.find((l) => l.id === f);
      if (!task || !list) return this.reply(404, { status: 404, message: "Not found" });
      if (!this.statusesOf(f).some((s) => s.status === task.status)) return this.reply(400, { status: 400, message: "status_mappings required" });
      task.list = f;
      return this.reply(200, { data: { task_id: task.id, new_list_id: f } });
    }
    return this.reply(404, { err: `No route for ${method} /${p.join("/")}`, ECODE: "ROUTE" });
  }

  /** The status a task gets: the one asked for if the list has it, its first status if none was asked; null if missing. */
  private checkStatus(listId: string, wanted: unknown): string | null {
    const statuses = this.statusesOf(listId);
    if (wanted === undefined) return statuses[0].status;
    return statuses.find((s) => s.status.toLowerCase() === String(wanted).toLowerCase())?.status ?? null;
  }
}
