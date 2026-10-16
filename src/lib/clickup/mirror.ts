import "server-only";
import { createHash } from "node:crypto";
import { all, get, now, run, tx } from "../db";
import type { AgentRow, CompanyRow, GoalRow, MilestoneRow, ProjectRow, TeamRow } from "../types";
import { CLICKUP_API_URL, ClickUpClient, ClickUpError, type ClickUpStatus, type ClickUpTaskBody } from "./client";
import { planMirror, type MirrorAsk, type MirrorArtifact, type MirrorSession, type MirrorSnapshot, type MirrorTodo, type PlannedTask } from "./plan";
import { pickStatus } from "./statuses";

/**
 * The ClickUp mirror: with CLICKUP_API_TOKEN set, each sync pushes the org into one ClickUp Space
 * (see plan.ts for the layout). It only ever writes what changed: clickup_links remembers what each
 * thing looked like when it was last written, so a quiet workspace costs no requests, and the links
 * themselves are written in batches, so open pages don't refresh on every task.
 *
 * It is one-way. Edits made in ClickUp stay until the same thing changes in Timu, which overwrites them.
 * Things that leave Timu (a deleted to-do, a removed goal) are archived in ClickUp, never deleted.
 */
export interface ClickUpConfig {
  token: string;
  /** The Space to write into; when null, Timu finds or makes one called `spaceName`. */
  spaceId: string | null;
  spaceName: string;
  /** Which workspace, if the token can see several (else the first). */
  workspaceId: string | null;
  baseUrl: string;
}

export function clickupConfigFromEnv(env: Record<string, string | undefined> = process.env): ClickUpConfig | null {
  const token = env.CLICKUP_API_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    spaceId: env.CLICKUP_SPACE_ID?.trim() || null,
    spaceName: env.CLICKUP_SPACE_NAME?.trim() || "Timu",
    workspaceId: env.CLICKUP_WORKSPACE_ID?.trim() || null,
    baseUrl: env.CLICKUP_API_URL?.trim() || CLICKUP_API_URL,
  };
}

export interface PushResult {
  ok: boolean;
  message: string;
  created: number;
  updated: number;
  moved: number;
  archived: number;
  /** Things still to write when the push stopped (time budget or rate limit); the next push carries on. */
  left: number;
  requests: number;
}

export interface MirrorStatus {
  configured: boolean;
  running: boolean;
  lastAt: string | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  workspaceId: string | null;
  spaceId: string | null;
  /** What is in ClickUp now, by kind. */
  mirrored: { sessions: number; goals: number; milestones: number; todos: number; folders: number; lists: number };
}

interface LinkRow {
  key: string;
  clickup_id: string;
  parent: string | null;
  hash: string;
  tags: string[];
  url: string | null;
}

interface State {
  chain: Promise<unknown>;
  running: boolean;
  lastAt: string | null;
  lastOk: boolean | null;
  lastMessage: string | null;
  /** Statuses per ClickUp list, kept a while: lists in one space rarely change them. */
  statuses: Map<string, { at: number; statuses: ClickUpStatus[] }>;
}

const state = (): State =>
  ((globalThis as { __timuClickUp?: State }).__timuClickUp ??= {
    chain: Promise.resolve(),
    running: false,
    lastAt: null,
    lastOk: null,
    lastMessage: null,
    statuses: new Map(),
  });

const STATUS_TTL_MS = 10 * 60_000;
/** A timed sync spends at most this long pushing, so local transcripts keep syncing on time. */
export const SYNC_BUDGET_MS = 25_000;
/** Links are saved in batches of this many, so a long push doesn't refresh open pages per task. */
const FLUSH_EVERY = 20;

const TASK_KINDS = ["session", "goal", "milestone", "todo"] as const;
const isTaskKey = (key: string) => TASK_KINDS.some((k) => key.startsWith(`${k}:`));

const SESSION_COLUMNS =
  "id, source, external_id, title, url, repo, branch, status, status_override, status_detail, summary, started_at, last_activity_at, project_id, team_id, agent_id, goal_id, archived, account, local_id";

/** Timu's rows the plan needs. Archived sessions and finished to-dos only matter once they are in ClickUp. */
export function loadSnapshot(): MirrorSnapshot {
  return {
    companies: all<CompanyRow>("select * from companies order by name"),
    projects: all<ProjectRow>("select * from projects order by name"),
    teams: all<TeamRow>("select * from teams order by name"),
    agents: all<AgentRow>("select * from agents order by name"),
    goals: all<GoalRow>("select * from goals order by created_at"),
    milestones: all<MilestoneRow>("select * from goal_milestones order by goal_id, position"),
    sessions: all<MirrorSession>(
      `select ${SESSION_COLUMNS} from sessions
       where archived = 0 or id in (select substr(key, 9) from clickup_links where key like 'session:%')`,
    ),
    asks: all<MirrorAsk>("select session_id, kind, title, detail, status, snoozed_until from tasks where session_id is not null and status <> 'done'"),
    todos: all<MirrorTodo>(
      `select id, title, detail, status, snoozed_until, agent_id, project_id, goal_id, due_date, priority from tasks
       where origin = 'manual' and (status <> 'done' or id in (select substr(key, 6) from clickup_links where key like 'todo:%'))
       order by created_at`,
    ),
    artifacts: all<MirrorArtifact>("select url, title, session_id from artifacts where session_id is not null order by updated_at, id"),
  };
}

const hashOf = (t: PlannedTask) =>
  createHash("sha1")
    .update(JSON.stringify([t.list, t.parent, t.name, t.markdown, t.status, t.tags, t.priority, t.dueDate, t.startDate, t.archived]))
    .digest("hex");

const bodyOf = (t: PlannedTask, status: string | null): ClickUpTaskBody => ({
  name: t.name,
  // ClickUp's reference names markdown_content, its guide markdown_description: send both.
  markdown_content: t.markdown,
  markdown_description: t.markdown,
  ...(status ? { status } : {}),
  priority: t.priority,
  due_date: t.dueDate,
  due_date_time: false,
  start_date: t.startDate,
  start_date_time: t.startDate !== null,
  archived: t.archived,
});

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function describePush(r: Pick<PushResult, "created" | "updated" | "moved" | "archived" | "left">): string {
  const parts = [
    r.created && `${r.created} created`,
    r.updated && `${r.updated} updated`,
    r.moved && `${r.moved} moved`,
    r.archived && `${r.archived} archived`,
  ].filter(Boolean);
  const done = parts.length ? parts.join(", ") : "up to date";
  return `ClickUp: ${done}${r.left ? ` · ${plural(r.left, "change")} left for the next sync` : ""}`;
}

/** One push. `client` is for tests; normally it's made from the config. */
async function push(config: ClickUpConfig, client: ClickUpClient, budgetMs: number): Promise<PushResult> {
  const deadline = Date.now() + budgetMs;
  client.deadline = deadline;
  const counts = { created: 0, updated: 0, moved: 0, archived: 0, left: 0 };
  const links = new Map(all<LinkRow>("select key, clickup_id, parent, hash, tags, url from clickup_links").map((l) => [l.key, l]));
  const dirty = new Map<string, LinkRow | null>();
  const flush = () => {
    if (!dirty.size) return;
    tx(() => {
      for (const [key, l] of dirty) {
        if (!l) run("delete from clickup_links where key = ?", key);
        else
          run(
            `insert into clickup_links (key, clickup_id, parent, hash, tags, url, synced_at) values (?, ?, ?, ?, ?, ?, ?)
             on conflict (key) do update set clickup_id = excluded.clickup_id, parent = excluded.parent, hash = excluded.hash,
               tags = excluded.tags, url = excluded.url, synced_at = excluded.synced_at`,
            key,
            l.clickup_id,
            l.parent,
            l.hash,
            l.tags,
            l.url,
            now(),
          );
      }
    });
    dirty.clear();
  };
  const save = (l: LinkRow) => {
    links.set(l.key, l);
    dirty.set(l.key, l);
    if (dirty.size >= FLUSH_EVERY) flush();
  };
  const drop = (key: string) => {
    if (!links.has(key)) return;
    links.delete(key);
    dirty.set(key, null);
  };
  const outOfTime = () => Date.now() >= deadline;

  try {
    // ---- the space ----
    const known = links.get("space");
    let spaceId: string;
    let workspaceId: string;
    if (known && known.parent && (!config.spaceId || config.spaceId === known.clickup_id) && (!config.workspaceId || config.workspaceId === known.parent)) {
      spaceId = known.clickup_id;
      workspaceId = known.parent;
    } else {
      ({ spaceId, workspaceId } = await findSpace(config, client));
      if (known && known.clickup_id !== spaceId) {
        // A different space: start a fresh mirror there.
        run("delete from clickup_links");
        links.clear();
      }
      save({ key: "space", clickup_id: spaceId, parent: workspaceId, hash: "", tags: [], url: null });
      flush();
    }

    const plan = planMirror(loadSnapshot());

    // ---- folders and lists (no requests when nothing changed) ----
    let spaceFolders: Promise<{ id: string; name: string }[]> | null = null;
    const folderIds = new Map<string, string>();
    for (const f of plan.folders) {
      if (outOfTime()) break;
      let link = links.get(f.key);
      if (link && link.hash !== f.name) {
        try {
          await client.renameFolder(link.clickup_id, f.name);
          save({ ...link, hash: f.name });
        } catch (err) {
          if (!(err instanceof ClickUpError && err.status === 404)) throw err;
          link = undefined; // deleted in ClickUp: make it again
        }
      }
      if (!link) {
        spaceFolders ??= client.folders(spaceId);
        const taken = new Set([...links.values()].map((x) => x.clickup_id));
        const same = (await spaceFolders).find((x) => x.name === f.name && !taken.has(x.id));
        const id = same?.id ?? (await client.createFolder(spaceId, f.name));
        // Its lists were in the folder that's gone (or are found again below).
        for (const l of plan.lists) if (l.folder === f.key) drop(l.key);
        save({ key: f.key, clickup_id: id, parent: spaceId, hash: f.name, tags: [], url: null });
        link = links.get(f.key)!;
      }
      folderIds.set(f.key, link.clickup_id);
    }

    const listsIn = new Map<string, Promise<{ id: string; name: string }[]>>();
    const listIds = new Map<string, string>();
    for (const l of plan.lists) {
      if (outOfTime()) break;
      const parent = l.folder ? folderIds.get(l.folder) : spaceId;
      if (!parent) continue;
      let link = links.get(l.key);
      if (link && link.parent !== parent) link = undefined;
      if (link && link.hash !== l.name) {
        try {
          await client.renameList(link.clickup_id, l.name);
          save({ ...link, hash: l.name });
        } catch (err) {
          if (!(err instanceof ClickUpError && err.status === 404)) throw err;
          link = undefined;
        }
      }
      if (!link) {
        const where = l.folder ? { folder: parent } : { space: parent };
        if (!listsIn.has(parent)) listsIn.set(parent, client.lists(where));
        const same = (await listsIn.get(parent)!).find((x) => x.name === l.name);
        let id = same?.id;
        if (!id) {
          const made = await client.createList(where, l.name);
          id = made.id;
          if (made.statuses) state().statuses.set(id, { at: Date.now(), statuses: made.statuses });
        }
        save({ key: l.key, clickup_id: id, parent, hash: l.name, tags: [], url: null });
        link = links.get(l.key)!;
      }
      listIds.set(l.key, link.clickup_id);
    }

    // ---- tags (teammates) ----
    let spaceTags: Promise<Set<string>> | null = null;
    const ensureTags = async (tags: string[]) => {
      if (!tags.length) return;
      spaceTags ??= client.spaceTags(spaceId).then((t) => new Set(t.map((x) => x.toLowerCase())));
      const have = await spaceTags;
      for (const tag of tags) {
        if (have.has(tag)) continue;
        await client.createSpaceTag(spaceId, tag);
        have.add(tag);
      }
    };

    // ---- statuses ----
    const statusFor = async (listId: string, t: PlannedTask, fresh = false) => {
      const cache = state().statuses;
      let entry = cache.get(listId);
      if (fresh || !entry || Date.now() - entry.at > STATUS_TTL_MS) {
        entry = { at: Date.now(), statuses: await client.listStatuses(listId) };
        cache.set(listId, entry);
      }
      return pickStatus(t.status, entry.statuses);
    };

    // ---- tasks ----
    /** Write with the list's status for the task; if ClickUp says the list lacks it, read its statuses again and retry once. */
    const withStatus = async <T>(listId: string, t: PlannedTask, write: (status: string | null) => Promise<T>): Promise<T> => {
      try {
        return await write(await statusFor(listId, t));
      } catch (err) {
        if (!(err instanceof ClickUpError && err.status === 400 && /status/i.test(err.message))) throw err;
        return write(await statusFor(listId, t, true));
      }
    };
    const create = async (t: PlannedTask, listId: string, hash: string) => {
      const parent = t.parent ? links.get(t.parent)?.clickup_id ?? null : null;
      await ensureTags(t.tags);
      const made = await withStatus(listId, t, (status) => client.createTask(listId, { ...bodyOf(t, status), tags: t.tags, ...(parent ? { parent } : {}) }));
      save({ key: t.key, clickup_id: made.id, parent: listId, hash, tags: t.tags, url: made.url });
      counts.created++;
    };
    const update = async (t: PlannedTask, link: LinkRow, listId: string, hash: string) => {
      await withStatus(listId, t, (status) => client.updateTask(link.clickup_id, bodyOf(t, status)));
      const gone = link.tags.filter((x) => !t.tags.includes(x));
      const added = t.tags.filter((x) => !link.tags.includes(x));
      if (added.length) await ensureTags(added);
      for (const tag of added) await client.addTag(link.clickup_id, tag);
      for (const tag of gone) await client.removeTag(link.clickup_id, tag).catch(() => undefined);
      save({ ...link, parent: listId, hash, tags: t.tags });
      counts.updated++;
    };

    const work: { t: PlannedTask; listId: string; hash: string }[] = [];
    for (const t of plan.tasks) {
      const listId = listIds.get(t.list);
      const hash = hashOf(t);
      const link = links.get(t.key);
      if (link ? link.hash === hash && link.parent === listId : t.skipIfNew) continue;
      // Its list wasn't reached before the time ran out: next push.
      if (!listId) counts.left++;
      else work.push({ t, listId, hash });
    }

    for (let i = 0; i < work.length; i++) {
      if (outOfTime()) {
        counts.left += work.length - i;
        break;
      }
      const { t, listId, hash } = work[i];
      const link = links.get(t.key);
      try {
        if (t.parent && !links.get(t.parent)) continue; // its goal isn't in ClickUp (yet)
        if (!link) {
          await create(t, listId, hash);
          continue;
        }
        if (link.parent !== listId && !t.parent) {
          try {
            await client.moveTask(workspaceId, link.clickup_id, listId);
            counts.moved++;
          } catch (err) {
            if (!(err instanceof ClickUpError) || err.status === 429 || err.status === 401) throw err;
            // Gone, or ClickUp won't move it (say, a status the new list lacks): archive it and start over there.
            if (err.status !== 404) await client.updateTask(link.clickup_id, { archived: true }).catch(() => undefined);
            drop(t.key);
            if (!t.skipIfNew) await create(t, listId, hash);
            continue;
          }
        }
        await update(t, link, listId, hash);
      } catch (err) {
        if (err instanceof ClickUpError && err.status === 404 && link) {
          // Deleted in ClickUp: make it again (unless it's only kept to be archived).
          drop(t.key);
          if (!t.skipIfNew) await create(t, listId, hash);
          continue;
        }
        if (err instanceof ClickUpError && err.status === 429) {
          counts.left += work.length - i;
          break;
        }
        throw err;
      }
    }

    // ---- things that left Timu: archive their tasks, forget their folders and lists ----
    const planned = new Set<string>(["space", ...plan.folders.map((f) => f.key), ...plan.lists.map((l) => l.key), ...plan.tasks.map((t) => t.key)]);
    for (const [key, link] of [...links]) {
      if (planned.has(key)) continue;
      if (!isTaskKey(key)) {
        drop(key);
        continue;
      }
      if (outOfTime()) {
        counts.left++;
        continue;
      }
      try {
        await client.updateTask(link.clickup_id, { archived: true });
        counts.archived++;
      } catch (err) {
        if (!(err instanceof ClickUpError && err.status === 404)) {
          if (err instanceof ClickUpError && err.status === 429) {
            counts.left++;
            continue;
          }
          throw err;
        }
      }
      drop(key);
    }

    return { ok: true, message: describePush(counts), ...counts, requests: client.requests };
  } catch (err) {
    // Out of requests for this minute while making folders or lists: carry on next time.
    if (err instanceof ClickUpError && err.status === 429)
      return { ok: true, message: `${describePush(counts)} · paused for ClickUp's rate limit`, ...counts, requests: client.requests };
    const message = err instanceof Error ? err.message : String(err);
    const done = describePush(counts);
    return { ok: false, message: `${done === "ClickUp: up to date" ? "ClickUp" : done} · ${message.replace(/^ClickUp:?\s*/, "")}`, ...counts, requests: client.requests };
  } finally {
    flush();
  }
}

/** The space to write into: CLICKUP_SPACE_ID, or the one named CLICKUP_SPACE_NAME (made if missing). */
async function findSpace(config: ClickUpConfig, client: ClickUpClient): Promise<{ spaceId: string; workspaceId: string }> {
  const workspaces = await client.workspaces();
  if (!workspaces.length) throw new ClickUpError("this token can't see any ClickUp workspace", 403);
  const candidates = config.workspaceId ? workspaces.filter((w) => w.id === config.workspaceId) : workspaces;
  if (!candidates.length) throw new ClickUpError(`CLICKUP_WORKSPACE_ID ${config.workspaceId} isn't a workspace this token can see`, 404);
  if (config.spaceId) {
    for (const w of candidates) {
      if ((await client.spaces(w.id)).some((s) => s.id === config.spaceId)) return { spaceId: config.spaceId, workspaceId: w.id };
    }
    throw new ClickUpError(`CLICKUP_SPACE_ID ${config.spaceId} isn't a space this token can see`, 404);
  }
  const workspace = candidates[0];
  const wanted = config.spaceName.toLowerCase();
  const same = (await client.spaces(workspace.id)).find((s) => s.name.trim().toLowerCase() === wanted);
  const space = same ?? (await client.createSpace(workspace.id, config.spaceName));
  return { spaceId: space.id, workspaceId: workspace.id };
}

/**
 * Push now, after any push already running (a timed sync, the Settings button, MCP). `budgetMs` caps
 * how long it writes; what's left goes at the next push.
 */
export function pushToClickUp(opts: { budgetMs?: number; config?: ClickUpConfig | null; client?: ClickUpClient } = {}): Promise<PushResult> {
  const s = state();
  const next = s.chain.then(async (): Promise<PushResult> => {
    const config = opts.config === undefined ? clickupConfigFromEnv() : opts.config;
    if (!config) return { ok: false, message: "ClickUp isn't set up: add CLICKUP_API_TOKEN to .env.local.", created: 0, updated: 0, moved: 0, archived: 0, left: 0, requests: 0 };
    s.running = true;
    let result: PushResult;
    try {
      result = await push(config, opts.client ?? new ClickUpClient({ token: config.token, baseUrl: config.baseUrl }), opts.budgetMs ?? 60_000);
    } catch (err) {
      result = { ok: false, message: `ClickUp: ${err instanceof Error ? err.message : String(err)}`, created: 0, updated: 0, moved: 0, archived: 0, left: 0, requests: 0 };
    }
    Object.assign(s, { running: false, lastAt: new Date().toISOString(), lastOk: result.ok, lastMessage: result.message });
    return result;
  });
  s.chain = next.catch(() => undefined);
  return next;
}

export function mirrorStatus(): MirrorStatus {
  const s = state();
  const space = get<{ clickup_id: string; parent: string | null }>("select clickup_id, parent from clickup_links where key = 'space'");
  const rows = all<{ kind: string; n: number }>("select substr(key, 1, instr(key, ':') - 1) as kind, count(*) as n from clickup_links where key <> 'space' group by kind");
  const n = (kind: string) => rows.find((r) => r.kind === kind)?.n ?? 0;
  return {
    configured: !!clickupConfigFromEnv(),
    running: s.running,
    lastAt: s.lastAt,
    lastOk: s.lastOk,
    lastMessage: s.lastMessage,
    workspaceId: space?.parent ?? null,
    spaceId: space?.clickup_id ?? null,
    mirrored: { sessions: n("session"), goals: n("goal"), milestones: n("milestone"), todos: n("todo"), folders: n("folder"), lists: n("list") },
  };
}

/** The ClickUp task a session (or goal, milestone, to-do) is mirrored to, if it is. */
export function clickupLink(kind: (typeof TASK_KINDS)[number], id: string): { id: string; url: string | null } | null {
  const row = get<{ clickup_id: string; url: string | null }>("select clickup_id, url from clickup_links where key = ?", `${kind}:${id}`);
  return row ? { id: row.clickup_id, url: row.url ?? `https://app.clickup.com/t/${row.clickup_id}` } : null;
}
