import type { EngineInterface } from 'claude-code'

import { idKey, mapCloudSession, parseCloudList, parseTranscript, repoFromUrl, type CloudRecord, type Session } from './org'

/** What one transcript parsed to, kept while its file is unchanged. */
export type ParseCache = Map<string, { stamp: string; session: Session | null }>

const DAY = 86_400_000
/** The newest transcripts read per scan; older ones wait for a quieter board. */
const MAX_LOCAL = 80
/** `$.fs.read` takes up to 4 MiB; a larger transcript is read as its head and tail. */
const WHOLE_READ_LIMIT = 3_500_000
/** Cloud sessions per `list_sessions` call, and the most calls per scan. */
const CLOUD_PAGE = 10
const CLOUD_PAGES = 5

/** Where Claude Code keeps local transcripts: CLAUDE_PROJECTS_DIR, else <config dir>/projects. */
async function projectsDir($: EngineInterface): Promise<string | null> {
  const explicit = await $.env.get('CLAUDE_PROJECTS_DIR')
  if (explicit) return explicit
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  if (config) return `${config.replace(/\/$/, '')}/projects`
  const home = await $.env.get('HOME')
  return home ? `${home.replace(/\/$/, '')}/.claude/projects` : null
}

async function readTranscript($: EngineInterface, path: string, size: number): Promise<string> {
  if (size <= WHOLE_READ_LIMIT) return String(await $.fs.read(path))
  // The head has the folder and first prompt, the tail the latest turn; a cut line fails to parse and is skipped.
  const [head, tail] = await Promise.all([
    $.process.run(['head', '-c', '300000', path], { timeoutMs: 10_000 }),
    $.process.run(['tail', '-c', '1500000', path], { timeoutMs: 10_000 }),
  ])
  return `${head.stdout}\n${tail.stdout}`
}

/** Local Claude Code sessions active in the last `days` days, newest first. */
export async function scanLocal($: EngineInterface, opts: { days: number; now: number; cache: ParseCache }): Promise<{ sessions: Session[]; notes: string[] }> {
  const dir = await projectsDir($)
  if (!dir || !(await $.fs.exists(dir))) return { sessions: [], notes: [] }
  const since = opts.now - opts.days * DAY
  const files: { path: string; id: string; size: number; mtimeMs: number }[] = []
  for (const folder of await $.fs.list(dir)) {
    if (folder.kind !== 'dir') continue
    // Subagent transcripts live one level deeper and are skipped.
    const entries = await $.fs.list(`${dir}/${folder.name}`).catch(() => [])
    for (const f of entries) {
      if (f.kind !== 'file' || !f.name.endsWith('.jsonl') || f.mtimeMs < since) continue
      files.push({ path: `${dir}/${folder.name}/${f.name}`, id: f.name.replace(/\.jsonl$/, ''), size: f.size, mtimeMs: f.mtimeMs })
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const sessions: Session[] = []
  const notes: string[] = []
  for (const f of files.slice(0, MAX_LOCAL)) {
    const stamp = `${f.size}:${f.mtimeMs}`
    const cached = opts.cache.get(f.path)
    // A recent transcript's "working" depends on the time too, so it is parsed again.
    const isFresh = opts.now - f.mtimeMs < 5 * 60_000
    if (cached?.stamp === stamp && !isFresh) {
      if (cached.session) sessions.push(cached.session)
      continue
    }
    try {
      const text = await readTranscript($, f.path, f.size)
      const session = parseTranscript(text, { fileId: f.id, mtimeMs: f.mtimeMs, now: opts.now })
      opts.cache.set(f.path, { stamp, session })
      if (session) sessions.push(session)
    } catch {
      notes.push(`Could not read ${f.id}`)
    }
  }
  if (files.length > MAX_LOCAL) notes.push(`Showing the newest ${MAX_LOCAL} of ${files.length} local sessions`)
  return { sessions, notes }
}

/**
 * Your claude.ai/code sessions, through the `claude-code-remote` server's
 * `list_sessions` tool, or why they could not be read (the call failed, or
 * its answer did not parse); null where this session has no such server.
 */
export async function scanCloud($: EngineInterface, since: string): Promise<{ sessions: Session[] } | { reason: string } | null> {
  // Only a cloud session has this server; anywhere else there is nothing to read and nothing to say.
  const tools = await $.tool.list().catch(() => [])
  if (!tools.some(t => t.name === 'mcp__claude-code-remote__list_sessions')) return null
  const records: CloudRecord[] = []
  let after: string | null = null
  // Small pages: a long answer is cut or set aside by the engine, and its JSON no longer parses.
  for (let page = 0; page < CLOUD_PAGES; page++) {
    const failed = (reason: string) => (records.length ? null : { reason: reason.slice(0, 200) })
    let listed: Awaited<ReturnType<EngineInterface['mcp']['call']>>
    try {
      listed = await $.mcp.call('claude-code-remote', 'list_sessions', after ? { limit: CLOUD_PAGE, after_id: after } : { limit: CLOUD_PAGE })
    } catch (err) {
      const stop = failed(String(err instanceof Error ? err.message : err))
      if (stop) return stop
      break
    }
    const text = listed.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
    let parsed = listed.isError ? null : parseCloudList(text)
    // A server that declares an output schema answers in structuredContent too.
    if (parsed && !parsed.records.length && listed.structuredContent !== undefined) parsed = parseCloudList(JSON.stringify(listed.structuredContent))
    if (!parsed || (!parsed.records.length && !/"data"\s*:\s*\[\s*\]/.test(text))) {
      const stop = failed(listed.isError ? `list_sessions failed: ${text}` : `could not read list_sessions' answer (${text.length} characters)`)
      if (stop) return stop
      break
    }
    records.push(...parsed.records)
    // Pages run newest first: once a whole page is older than the window, the rest are too.
    const isOld = parsed.records.every(r => (r.updated_at ?? r.created_at ?? '') < since)
    if (!parsed.hasMore || !parsed.lastId || isOld) break
    after = parsed.lastId
  }
  return { sessions: records.map(mapCloudSession) }
}

/** `owner/name` of each folder's git remote, for the folders not looked up yet. */
export async function lookUpOwners($: EngineInterface, folders: readonly string[], known: Readonly<Record<string, string | null>>): Promise<Record<string, string | null>> {
  const found: Record<string, string | null> = {}
  for (const folder of folders) {
    if (folder in known) continue
    const ran = await $.process
      .run(['git', '-C', folder, 'config', '--get', 'remote.origin.url'], { timeoutMs: 5_000 })
      .catch(() => null)
    found[folder] = ran && ran.exitCode === 0 ? repoFromUrl(ran.stdout) : null
  }
  return found
}

/** This session's ids: its transcript's, and in a cloud session its claude.ai one. */
export async function hereIds($: EngineInterface): Promise<string[]> {
  const ids = [await $.session.id()]
  const remote = await $.env.get('CLAUDE_CODE_REMOTE_SESSION_ID')
  if (remote) ids.push(`session_${idKey(remote)}`)
  return ids
}

