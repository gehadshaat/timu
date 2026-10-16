/**
 * A small client for ClickUp's REST API (v2, plus v3 for moving a task), with a personal token.
 *
 * ClickUp allows 100 requests a minute per token on most plans. Every response says how many are left
 * (X-RateLimit-Remaining) and when the window resets (X-RateLimit-Reset): when none are left the client
 * waits for the reset, and a 429 is waited out and retried. A wait that would run past `deadline` throws
 * a 429 ClickUpError instead, so a push stops for this sync and carries on at the next.
 */
export class ClickUpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ClickUpError";
  }
}

export interface ClickUpStatus {
  status: string;
  type: string;
  orderindex?: number;
}

export interface ClickUpTaskBody {
  name?: string;
  description?: string;
  markdown_content?: string;
  markdown_description?: string;
  status?: string;
  priority?: number | null;
  due_date?: number | null;
  due_date_time?: boolean;
  start_date?: number | null;
  start_date_time?: boolean;
  tags?: string[];
  parent?: string | null;
  archived?: boolean;
}

export interface ClickUpOptions {
  token: string;
  /** The v2 base URL; v3 calls swap the trailing /v2 for /v3. */
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const CLICKUP_API_URL = "https://api.clickup.com/api/v2";

/** Longest wait for a rate-limit window that says nothing about when it resets. */
const DEFAULT_WAIT_MS = 60_000;

export class ClickUpClient {
  private readonly token: string;
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** When the current window resets, once a response said no requests are left in it. */
  private blockedUntil = 0;
  /** Waits that would end after this (ms since epoch) throw a 429 instead. */
  deadline = Infinity;
  /** Requests sent, for reporting. */
  requests = 0;

  constructor(opts: ClickUpOptions) {
    this.token = opts.token;
    this.base = (opts.baseUrl || CLICKUP_API_URL).replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  private async wait(until: number): Promise<void> {
    const ms = until - this.now();
    if (ms <= 0) return;
    if (until > this.deadline) throw new ClickUpError("ClickUp's rate limit is used up for this minute", 429, "RATE_LIMIT");
    await this.sleep(ms);
  }

  /** The reset header is a Unix timestamp; read it as seconds or milliseconds, whichever it looks like. */
  private resetAt(res: Response): number {
    const raw = Number(res.headers.get("x-ratelimit-reset"));
    if (!Number.isFinite(raw) || raw <= 0) return this.now() + DEFAULT_WAIT_MS;
    const at = raw > 1e12 ? raw : raw * 1000;
    // A reset in the past or absurdly far off: fall back to a minute.
    return at > this.now() && at - this.now() <= 5 * DEFAULT_WAIT_MS ? at : this.now() + DEFAULT_WAIT_MS;
  }

  async request<T>(method: string, path: string, body?: unknown, opts: { v3?: boolean } = {}): Promise<T> {
    const base = opts.v3 ? this.base.replace(/\/v2$/, "/v3") : this.base;
    for (let attempt = 0; ; attempt++) {
      await this.wait(this.blockedUntil);
      this.requests++;
      let res: Response;
      try {
        res = await this.fetchFn(`${base}${path}`, {
          method,
          headers: { Authorization: this.token, "Content-Type": "application/json", Accept: "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
        });
      } catch (err) {
        if (attempt < 1) {
          await this.sleep(2000);
          continue;
        }
        throw new ClickUpError(`Couldn't reach ClickUp: ${err instanceof Error ? err.message : String(err)}`, 0, "NETWORK");
      }
      if (res.headers.get("x-ratelimit-remaining") === "0") this.blockedUntil = this.resetAt(res);
      if (res.status === 429 && attempt < 3) {
        this.blockedUntil = this.resetAt(res);
        continue;
      }
      if (res.status >= 500 && attempt < 1) {
        await this.sleep(2000);
        continue;
      }
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        // not JSON: keep the text for the error below
      }
      if (!res.ok) {
        const message = String(json.err ?? json.message ?? text.slice(0, 200) ?? res.statusText);
        const code = typeof json.ECODE === "string" ? json.ECODE : null;
        throw new ClickUpError(
          res.status === 401 ? `ClickUp rejected the token (CLICKUP_API_TOKEN): ${message}` : `ClickUp ${method} ${path} → ${res.status}: ${message}`,
          res.status,
          code,
        );
      }
      return json as T;
    }
  }

  // ---------- workspaces and spaces ----------

  async workspaces(): Promise<{ id: string; name: string }[]> {
    const r = await this.request<{ teams?: { id: string | number; name: string }[] }>("GET", "/team");
    return (r.teams ?? []).map((t) => ({ id: String(t.id), name: t.name }));
  }

  async spaces(workspaceId: string): Promise<{ id: string; name: string }[]> {
    const r = await this.request<{ spaces?: { id: string | number; name: string }[] }>("GET", `/team/${workspaceId}/space?archived=false`);
    return (r.spaces ?? []).map((s) => ({ id: String(s.id), name: s.name }));
  }

  async createSpace(workspaceId: string, name: string): Promise<{ id: string; name: string }> {
    const on = { enabled: true };
    const r = await this.request<{ id: string | number; name: string }>("POST", `/team/${workspaceId}/space`, {
      name,
      multiple_assignees: true,
      features: {
        due_dates: { enabled: true, start_date: true, remap_due_dates: false, remap_closed_due_date: false },
        time_tracking: { enabled: false },
        tags: on,
        time_estimates: { enabled: false },
        checklists: on,
        custom_fields: on,
        remap_dependencies: { enabled: false },
        dependency_warning: { enabled: false },
        portfolios: { enabled: false },
      },
    });
    return { id: String(r.id), name: r.name };
  }

  // ---------- folders and lists ----------

  async folders(spaceId: string): Promise<{ id: string; name: string }[]> {
    const r = await this.request<{ folders?: { id: string | number; name: string }[] }>("GET", `/space/${spaceId}/folder?archived=false`);
    return (r.folders ?? []).map((f) => ({ id: String(f.id), name: f.name }));
  }

  async createFolder(spaceId: string, name: string): Promise<string> {
    return String((await this.request<{ id: string | number }>("POST", `/space/${spaceId}/folder`, { name })).id);
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    await this.request("PUT", `/folder/${folderId}`, { name });
  }

  /** Lists in a folder, or (folder null) the lists straight in the space. */
  async lists(where: { folder: string } | { space: string }): Promise<{ id: string; name: string }[]> {
    const path = "folder" in where ? `/folder/${where.folder}/list?archived=false` : `/space/${where.space}/list?archived=false`;
    const r = await this.request<{ lists?: { id: string | number; name: string }[] }>("GET", path);
    return (r.lists ?? []).map((l) => ({ id: String(l.id), name: l.name }));
  }

  /** Make a list; ClickUp answers with its statuses too, which saves asking for them. */
  async createList(where: { folder: string } | { space: string }, name: string): Promise<{ id: string; statuses: ClickUpStatus[] | null }> {
    const path = "folder" in where ? `/folder/${where.folder}/list` : `/space/${where.space}/list`;
    const r = await this.request<{ id: string | number; statuses?: ClickUpStatus[] }>("POST", path, { name });
    return { id: String(r.id), statuses: r.statuses?.length ? r.statuses : null };
  }

  async renameList(listId: string, name: string): Promise<void> {
    await this.request("PUT", `/list/${listId}`, { name });
  }

  /** The task statuses a list offers (its own, or the ones it inherits from its space). */
  async listStatuses(listId: string): Promise<ClickUpStatus[]> {
    return (await this.request<{ statuses?: ClickUpStatus[] }>("GET", `/list/${listId}`)).statuses ?? [];
  }

  // ---------- tasks ----------

  async createTask(listId: string, body: ClickUpTaskBody): Promise<{ id: string; url: string | null }> {
    const r = await this.request<{ id: string; url?: string }>("POST", `/list/${listId}/task`, body);
    return { id: String(r.id), url: r.url ?? null };
  }

  async updateTask(taskId: string, body: ClickUpTaskBody): Promise<void> {
    await this.request("PUT", `/task/${taskId}`, body);
  }

  /** Move a task to another home list (v3). */
  async moveTask(workspaceId: string, taskId: string, listId: string): Promise<void> {
    await this.request("PUT", `/workspaces/${workspaceId}/tasks/${taskId}/home_list/${listId}`, {}, { v3: true });
  }

  async spaceTags(spaceId: string): Promise<string[]> {
    const r = await this.request<{ tags?: { name: string }[] }>("GET", `/space/${spaceId}/tag`);
    return (r.tags ?? []).map((t) => t.name);
  }

  async createSpaceTag(spaceId: string, name: string): Promise<void> {
    await this.request("POST", `/space/${spaceId}/tag`, { tag: { name, tag_fg: "#ffffff", tag_bg: "#6366f1" } });
  }

  async addTag(taskId: string, tag: string): Promise<void> {
    await this.request("POST", `/task/${taskId}/tag/${encodeURIComponent(tag)}`);
  }

  async removeTag(taskId: string, tag: string): Promise<void> {
    await this.request("DELETE", `/task/${taskId}/tag/${encodeURIComponent(tag)}`);
  }
}
