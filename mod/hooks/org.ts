import type { AskKind, Board, Row, Status, Teammate } from '../types'

/**
 * Timu's filing as pure functions: read a session (a local transcript or a
 * cloud record), file it under company → project → teammate, and decide
 * whether it needs you. Ported from Timu's sources/local.ts, sources/cloud.ts,
 * classify/heuristic.ts and triage/rules.ts.
 */

export type Session = {
  id: string
  source: 'local' | 'cloud'
  title: string
  /** `owner/name` when known, else the folder's name. */
  repo: string | null
  folder: string | null
  status: Status
  /** The question it asked, or the cloud session's own "needs action" line. */
  detail: string | null
  firstPrompt: string | null
  lastAt: string | null
  open: string
  isArchived: boolean
  /** A local transcript's claude.ai/code session (Remote Control, teleport): the same conversation. */
  cloudId?: string | null
}

export type Filing = { project?: string; goal?: string }

export type FileInput = {
  sessions: readonly Session[]
  /** Session id → the project and goal you filed it under. */
  filing: Readonly<Record<string, Filing>>
  /** Project → the company you put it in. */
  companies: Readonly<Record<string, string>>
  /** Local folder → its GitHub `owner/name`, read from its git remote. */
  owners: Readonly<Record<string, string | null>>
  /** Session id → its last activity when you handled its ask. */
  handled: Readonly<Record<string, string>>
  /** Session id → when its snooze ends (ms). */
  snoozed: Readonly<Record<string, number>>
  /** This session's ids (its transcript id, and its cloud id in a cloud session). */
  hereIds: readonly string[]
  /** This session's repository, `owner/name`, when it runs in one. */
  hereRepo?: string | null
  now: number
}

const DAY = 86_400_000
/** A transcript written this recently, mid tool loop, is still working. */
const WORKING_WINDOW_MS = 3 * 60 * 1000

export const clip = (text: string | null | undefined, max: number): string | null => {
  if (!text) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

export const hash = (text: string): number => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** `cse_01X…`, `session_01X…` and `01X…` are one session. */
export const idKey = (id: string): string => id.replace(/^(cse|session)_/, '')

const stripHarnessTags = (text: string): string =>
  text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .trim()

/** Did the assistant end its turn by asking the user something? */
export function looksLikeQuestion(text: string): boolean {
  const tail = text.trim().split('\n').slice(-6).join('\n')
  if (/\?\s*\**\s*$/.test(tail)) return true
  return /\b(should I|shall I|do you want|would you like|let me know|which (one|option)|confirm|say ["“]?go)\b/i.test(tail)
}

function lastQuestion(text: string): string {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/)
  return [...sentences].reverse().find(s => s.includes('?')) ?? sentences.slice(-2).join(' ')
}

type Block = { type?: string; text?: string }
type Line = {
  type?: string
  isSidechain?: boolean
  isMeta?: boolean
  sessionId?: string
  cwd?: string
  timestamp?: string
  aiTitle?: string
  summary?: string
  attachment?: { type?: string; url?: string | null }
  message?: { stop_reason?: string | null; content?: string | Block[] }
}

/** The claude.ai/code session a link names, spelled `session_…` (Claude Code also writes `cse_…`). */
export function cloudIdFromUrl(url: string | null | undefined): string | null {
  const id = url?.match(/\/code\/((?:session|cse)_[A-Za-z0-9]+)/)?.[1]
  return id ? id.replace(/^cse_/, 'session_') : null
}

/** A local Claude Code transcript (`~/.claude/projects/<folder>/<id>.jsonl`), one JSON object per line. */
export function parseTranscript(jsonl: string, opts: { fileId: string; mtimeMs: number; now: number }): Session | null {
  let id = opts.fileId
  let cwd: string | null = null
  let title: string | null = null
  let firstUser: string | null = null
  let lastText: { role: 'user' | 'assistant'; text: string } | null = null
  let lastRole: 'user' | 'assistant' | null = null
  let lastStop: string | null = null
  let lastAt: string | null = null
  // Claude Code writes the session's claude.ai/code link (Remote Control, cloud) as a
  // `remote_session_change` line; it goes back to null when Remote Control is switched off.
  let cloudId: string | null = null

  for (const raw of jsonl.split('\n')) {
    if (!raw.trim()) continue
    let line: Line
    try {
      line = JSON.parse(raw) as Line
    } catch {
      continue
    }
    if (line.type === 'ai-title' && line.aiTitle) title = line.aiTitle
    if (line.type === 'summary' && line.summary) title ??= line.summary
    if (line.type === 'attachment' && line.attachment?.type === 'remote_session_change' && !line.isSidechain) {
      cloudId = cloudIdFromUrl(line.attachment.url) ?? cloudId
    }
    if (line.type !== 'user' && line.type !== 'assistant') continue
    if (line.isSidechain) continue
    if (line.sessionId) id = line.sessionId
    if (line.cwd) cwd = line.cwd
    if (line.timestamp) lastAt = line.timestamp
    const content = line.message?.content

    if (line.type === 'user') {
      if (line.isMeta) continue
      if (Array.isArray(content) && content.some(b => b.type === 'tool_result')) {
        lastRole = 'user'
        continue
      }
      const text = typeof content === 'string'
        ? content
        : (content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
      const clean = stripHarnessTags(text)
      if (!clean) continue
      firstUser ??= clean
      lastText = { role: 'user', text: clean }
      lastRole = 'user'
    } else {
      lastRole = 'assistant'
      lastStop = line.message?.stop_reason ?? lastStop
      const blocks = Array.isArray(content) ? content : []
      const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
      if (text) lastText = { role: 'assistant', text }
    }
  }
  if (!firstUser && !lastText) return null

  const endedTurn = lastRole === 'assistant' && lastStop === 'end_turn'
  const isRecent = opts.now - opts.mtimeMs < WORKING_WINDOW_MS
  const asked = endedTurn && lastText?.role === 'assistant' && looksLikeQuestion(lastText.text)
  const status: Status = !endedTurn && isRecent ? 'working' : asked ? 'needs_you' : 'idle'

  return {
    id,
    source: 'local',
    title: clip(title ?? firstUser, 120) ?? 'Local session',
    repo: cwd ? (cwd.split('/').filter(Boolean).pop() ?? null) : null,
    folder: cwd,
    status,
    detail: asked && lastText ? clip(lastQuestion(lastText.text), 300) : null,
    firstPrompt: clip(firstUser, 600),
    lastAt: lastAt ?? new Date(opts.mtimeMs).toISOString(),
    open: `claude --resume ${id}`,
    isArchived: false,
    cloudId,
  }
}

export type CloudRecord = {
  id: string
  title?: string
  session_status?: string
  status_bucket?: string
  created_at?: string
  updated_at?: string
  task_summary?: string
  session_context?: {
    sources?: { git_repository?: { url?: string } }[]
    outcomes?: { git_repository?: { git_info?: { repo?: string } } }[]
  }
  post_turn_summary?: PostTurn
  external_metadata?: { post_turn_summary?: PostTurn; task_summary?: string }
}
type PostTurn = { status_category?: string; status_detail?: string; recent_action?: string; needs_action?: string }

const BUCKET: Record<string, Status> = {
  SESSION_STATUS_BUCKET_WORKING: 'working',
  SESSION_STATUS_BUCKET_BLOCKED: 'needs_you',
  SESSION_STATUS_BUCKET_REVIEW_READY: 'review',
  SESSION_STATUS_BUCKET_COMPLETED: 'done',
  SESSION_STATUS_BUCKET_FAILED: 'failed',
}

/** `owner/name` from a git remote URL (`https://…/owner/name.git`, `git@host:owner/name`). */
export function repoFromUrl(url: string | null | undefined): string | null {
  const m = url?.trim().replace(/\/$/, '').replace(/\.git$/, '').match(/[/:]([^/:\s]+)\/([^/:\s]+)$/)
  return m ? `${m[1]}/${m[2]}` : null
}

/** A claude.ai/code session record, as the `list_sessions` tool returns it. */
export function mapCloudSession(rec: CloudRecord): Session {
  const pts = rec.post_turn_summary ?? rec.external_metadata?.post_turn_summary
  const needsAction = pts?.needs_action?.trim() || null
  let status: Status = (rec.status_bucket && BUCKET[rec.status_bucket]) ||
    (rec.session_status === 'SESSION_STATUS_RUNNING' ? 'working' : 'idle')
  const canAsk = status !== 'working' && status !== 'failed'
  if (canAsk && (needsAction || pts?.status_category === 'blocked')) status = 'needs_you'

  const repo = rec.session_context?.outcomes?.[0]?.git_repository?.git_info?.repo ??
    repoFromUrl(rec.session_context?.sources?.[0]?.git_repository?.url)
  const detail = [needsAction, pts?.status_detail, pts?.recent_action, rec.task_summary ?? rec.external_metadata?.task_summary]
    .find(p => p && p.trim())

  return {
    id: rec.id,
    source: 'cloud',
    title: clip(rec.title, 120) ?? 'Untitled cloud session',
    repo,
    folder: null,
    status,
    detail: clip(detail, 300),
    firstPrompt: null,
    lastAt: rec.updated_at ?? rec.created_at ?? null,
    open: `https://claude.ai/code/${rec.id}`,
    isArchived: rec.session_status === 'SESSION_STATUS_ARCHIVED',
  }
}

export type CloudPage = { records: CloudRecord[]; hasMore: boolean; lastId: string | null }

/** One page of the `list_sessions` tool's text: `{ccr: {data, has_more, last_id}}`, `{data}` or an array, possibly inside an envelope. */
export function parseCloudList(text: string): CloudPage {
  const none: CloudPage = { records: [], hasMore: false, lastId: null }
  const start = text.search(/[[{]/)
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (start < 0 || end < start) return none
  let payload: unknown
  try {
    payload = JSON.parse(text.slice(start, end + 1))
  } catch {
    return none
  }
  const page = (v: unknown): { data: unknown[]; hasMore: boolean; lastId: string | null } => {
    if (Array.isArray(v)) return { data: v, hasMore: false, lastId: null }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (o.ccr) return page(o.ccr)
      if (Array.isArray(o.data)) {
        return { data: o.data, hasMore: o.has_more === true, lastId: typeof o.last_id === 'string' ? o.last_id : null }
      }
    }
    return { data: [], hasMore: false, lastId: null }
  }
  const { data, hasMore, lastId } = page(payload)
  const records = data.filter((r): r is CloudRecord =>
    !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' &&
    (r as { id: string }).id.startsWith('session_'))
  return { records, hasMore, lastId }
}

type Discipline = { team: string; role: string; emoji: string; words: RegExp }

const DISCIPLINES: Discipline[] = [
  { team: 'Marketing', role: 'SEO Lead', emoji: '🔎', words: /\b(seo|search console|keyword|sitemap|meta tags?|rank(ing)?)\b/i },
  { team: 'Marketing', role: 'Growth Marketer', emoji: '📣', words: /\b(ads?|landing pages?|campaigns?|marketing|funnel|conversion)\b/i },
  { team: 'Marketing', role: 'Content Writer', emoji: '📝', words: /\b(blog|copy(writing)?|newsletter|content|article|social post)\b/i },
  { team: 'Hardware', role: 'Hardware Engineer', emoji: '🔌', words: /\b(pcb|firmware|circuit|esp32|hardware|schematic|solder)\b/i },
  { team: 'Commerce', role: 'E-commerce Manager', emoji: '🛍️', words: /\b(shopify|storefront|e-?commerce|product listings?|checkout|cart)\b/i },
  { team: 'Media', role: 'Video Producer', emoji: '🎥', words: /\b(video|youtube|photo(shoot)?|reel|tiktok|thumbnail)\b/i },
  { team: 'Travel', role: 'Trip Planner', emoji: '🗺️', words: /\b(trip|travel|itinerary|flight|hotel|hike|packing)\b/i },
  { team: 'Design', role: 'Product Designer', emoji: '🎨', words: /\b(design|ui|ux|logo|figma|brand(ing)?|mockup)\b/i },
  { team: 'Finance', role: 'Finance Manager', emoji: '🧮', words: /\b(invoices?|accounting|tax|bookkeeping|finance|budget|expenses?)\b/i },
  { team: 'Data', role: 'Data Analyst', emoji: '📊', words: /\b(analytics|reports?|dashboards?|metrics|kpis?)\b/i },
  { team: 'Operations', role: 'Operations Manager', emoji: '📦', words: /\b(inventory|shipments?|suppliers?|logistics|procurement|orders?)\b/i },
  { team: 'Sales', role: 'Sales Lead', emoji: '📞', words: /\b(outreach|sales|crm|leads?|prospects?|deals?)\b/i },
  { team: 'Support', role: 'Support Lead', emoji: '🎧', words: /\b(support|tickets?|helpdesk|customer service)\b/i },
]
const ENGINEERING: Discipline = { team: 'Engineering', role: 'Software Engineer', emoji: '💻', words: /./ }
const STUDIO: Discipline = { team: 'Studio', role: 'Research Assistant', emoji: '☕', words: /./ }

const NAMES = [
  'Maya', 'Omar', 'Lena', 'Kofi', 'Ines', 'Ravi', 'Sofia', 'Yusuf', 'Aiko', 'Mateo', 'Nadia', 'Theo',
  'Zara', 'Hugo', 'Amara', 'Felix', 'Leila', 'Jonah', 'Priya', 'Elias', 'Noor', 'Diego', 'Hana', 'Sami',
]
const PROJECT_EMOJI = ['🚀', '🛍️', '🦆', '🧪', '🌿', '🏗️', '🎯', '📦', '🧭', '🎨', '🌞', '🐝']

export const prettify = (label: string): string =>
  label.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

/** Needs you first, then what's stuck, ready, running, idle and done. */
export const STATUS_RANK: Record<Status, number> = { needs_you: 0, failed: 1, review: 2, working: 3, idle: 4, done: 5 }

const ASK_OF: Partial<Record<Status, AskKind>> = { needs_you: 'respond', review: 'review', failed: 'unblock' }
const ASK_DEFAULT: Record<AskKind, string> = { respond: 'Waiting on your reply', review: 'Ready for your review', unblock: 'Stopped with an error' }

/** Files every session and decides its ask. Deterministic: the same input files the same way. */
export function fileSessions(input: FileInput): Row[] {
  const here = new Set(input.hereIds.map(idKey))
  // One conversation, one row: a cloud session's own transcript sits in its container too, and a
  // terminal session connected with Remote Control (or teleported) is also a cloud session.
  // Only the first transcript to name a cloud session is that session; a fork of it is its own.
  const seen = new Set<string>()
  const claimed = new Set<string>()
  const keyOf = (s: Session): string => {
    if ([s.id, s.cloudId].some(id => id && here.has(idKey(id)))) return 'here'
    const cloud = s.cloudId ? idKey(s.cloudId) : null
    if (!cloud || claimed.has(cloud)) return idKey(s.id)
    claimed.add(cloud)
    return cloud
  }
  const sessions = [...input.sessions]
    .sort((a, b) => (a.source === b.source ? 0 : a.source === 'local' ? -1 : 1))
    .filter(s => {
      const k = keyOf(s)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })

  // In a cloud session the claude.ai record knows the repository its transcript's folder may not.
  const hereRepo = input.hereRepo ??
    input.sessions.find(s => s.source === 'cloud' && here.has(idKey(s.id)) && s.repo?.includes('/'))?.repo ?? null

  const usedNames = new Map<string, string>()
  const nameFor = (key: string): string => {
    const known = usedNames.get(key)
    if (known) return known
    const taken = new Set(usedNames.values())
    let i = hash(key) % NAMES.length
    for (let n = 0; n < NAMES.length && taken.has(NAMES[i]!); n++) i = (i + 1) % NAMES.length
    const name = NAMES[i]!
    usedNames.set(key, name)
    return name
  }

  // Name teammates in a fixed order, so adding a session never renames anyone.
  const drafts = sessions.map(s => {
    const isHere = here.has(idKey(s.id))
    const filed = input.filing[s.id] ?? (isHere ? input.hereIds.map(id => input.filing[id]).find(Boolean) : undefined)
    const owned = s.folder ? input.owners[s.folder] : null
    const repo = (isHere ? hereRepo : null) ?? (s.repo?.includes('/') ? s.repo : owned ?? s.repo)
    const projectName = filed?.project ?? (repo ? prettify(repo.split('/').pop()!) : 'Personal')
    const company = input.companies[projectName] ?? (repo?.includes('/') ? prettify(repo.split('/')[0]!) : 'Personal')
    const text = [s.title, s.firstPrompt].filter(Boolean).join(' ')
    const d = DISCIPLINES.find(x => x.words.test(text)) ?? (s.repo ? ENGINEERING : STUDIO)
    return { s, isHere, filed, projectName, company, d, memberKey: `${projectName}:${d.team}:${d.role}` }
  })
  for (const key of [...new Set(drafts.map(d => d.memberKey))].sort()) nameFor(key)

  return drafts.map(({ s, isHere, filed, projectName, company, d, memberKey }) => {
    const teammate: Teammate = { name: nameFor(memberKey), role: d.role, team: d.team, emoji: d.emoji }
    return {
      id: s.id,
      source: s.source,
      title: s.title,
      status: s.status,
      company,
      project: projectName,
      projectEmoji: PROJECT_EMOJI[hash(projectName) % PROJECT_EMOJI.length]!,
      goal: filed?.goal ?? null,
      teammate,
      lastAt: s.lastAt,
      open: s.open,
      ask: askOf(s, isHere, input),
      isHere,
    }
  })
}

function askOf(s: Session, isHere: boolean, input: FileInput): Row['ask'] {
  const kind = ASK_OF[s.status]
  if (!kind || isHere || s.isArchived) return null
  const handledAt = input.handled[s.id]
  if (handledAt !== undefined && handledAt >= (s.lastAt ?? '')) return null
  if ((input.snoozed[s.id] ?? 0) > input.now) return null
  return { kind, text: s.detail ?? ASK_DEFAULT[kind] }
}

/** Asks first, oldest wait first; then every row by company, project, status and recency. */
export function sortRows(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) =>
    a.company.localeCompare(b.company) ||
    a.project.localeCompare(b.project) ||
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}

export const asksOf = (rows: readonly Row[]): Row[] =>
  rows.filter(r => r.ask).sort((a, b) => (a.lastAt ?? '').localeCompare(b.lastAt ?? ''))

/** "5m", "3h", "2d": how long ago. */
export function ago(iso: string | null, now: number): string {
  if (!iso) return ''
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  if (ms < 60_000) return 'now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / DAY)}d`
}

/** "5m ago", "just now": `ago` for a sentence. */
export function agoText(iso: string | null, now: number): string {
  const a = ago(iso, now)
  return a === 'now' ? 'just now' : a ? `${a} ago` : ''
}

/** `[Company >] Project [/ Goal]`, the argument of /timu-file. */
export function parseFiling(args: string): { company?: string; project?: string; goal?: string } {
  const [left, ...goalParts] = args.split('/')
  const goal = goalParts.join('/').trim()
  const [a, b] = (left ?? '').split('>').map(p => p.trim())
  const out: { company?: string; project?: string; goal?: string } = {}
  if (b !== undefined) {
    if (a) out.company = a
    if (b) out.project = b
  } else if (a) out.project = a
  if (goal) out.goal = goal
  return out
}

/** The board as text: what /timu prints where no pane can open, and what Claude reads from the board tool. */
export function boardText(board: Board, now: number, opts: { asksOnly?: boolean; project?: string } = {}): string {
  const match = (r: Row) => !opts.project || r.project.toLowerCase() === opts.project.toLowerCase()
  const rows = board.rows.filter(match)
  const asks = asksOf(rows)
  const lines: string[] = [summaryLine(board.rows), ...board.notes.map(n => `(${n})`)]
  if (asks.length) {
    lines.push('', 'Needs you:')
    for (const r of asks) {
      lines.push(`- [${r.ask!.kind}] ${r.teammate.name} (${r.project}): ${r.ask!.text} — "${r.title}" ${agoText(r.lastAt, now)} · id ${r.id} · open: ${r.open}`)
    }
  } else lines.push('', 'Nothing needs you.')
  if (!opts.asksOnly) {
    let group = ''
    for (const r of sortRows(rows)) {
      const g = `${r.company} / ${r.project}`
      if (g !== group) lines.push('', `${r.projectEmoji} ${g}`)
      group = g
      const goal = r.goal ? ` · goal: ${r.goal}` : ''
      const here = r.isHere ? ' (this session)' : ''
      lines.push(`- ${r.status.replace('_', ' ')}: "${r.title}"${here} · ${r.teammate.name}, ${r.teammate.role}${goal} · ${ago(r.lastAt, now)} · id ${r.id}`)
    }
  }
  return lines.join('\n')
}

export function summaryLine(rows: readonly Row[]): string {
  const asks = rows.filter(r => r.ask).length
  const working = rows.filter(r => r.status === 'working').length
  const projects = new Set(rows.map(r => `${r.company}/${r.project}`)).size
  return `${asks} need you · ${working} working · ${rows.length} sessions in ${projects} projects`
}
