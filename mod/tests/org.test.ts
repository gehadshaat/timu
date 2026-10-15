import { describe, expect, test } from 'claude-code/testing'

import {
  boardText, fileSessions, looksLikeQuestion, mapCloudSession, parseCloudList, parseFiling, parseTranscript,
  repoFromUrl, agoText, type FileInput, type Session,
} from '../hooks/org'

const NOW = Date.parse('2026-10-14T12:00:00Z')
const HOUR = 3_600_000

const transcript = (o: { id: string; cwd: string; prompt: string; reply: string; title?: string; at: string; stop?: string | null }) =>
  [
    o.title ? JSON.stringify({ type: 'ai-title', aiTitle: o.title }) : '',
    JSON.stringify({ type: 'user', sessionId: o.id, cwd: o.cwd, timestamp: o.at, message: { role: 'user', content: `<system-reminder>ignore</system-reminder>${o.prompt}` } }),
    JSON.stringify({ type: 'assistant', sessionId: o.id, cwd: o.cwd, timestamp: o.at, message: { role: 'assistant', stop_reason: o.stop === undefined ? 'end_turn' : o.stop, content: [{ type: 'text', text: o.reply }] } }),
    '{ not json',
  ].join('\n')

const local = (over: Partial<Session> & Pick<Session, 'id' | 'title'>): Session => ({
  source: 'local', repo: 'sunbeam-web', folder: '/work/sunbeam-web', status: 'idle', detail: null, firstPrompt: null,
  lastAt: '2026-10-14T10:00:00Z', open: `claude --resume ${over.id}`, isArchived: false, ...over,
})

const world = (sessions: Session[], over: Partial<FileInput> = {}): FileInput => ({
  sessions, filing: {}, companies: {}, owners: { '/work/sunbeam-web': 'sunbeam-co/sunbeam-web' },
  handled: {}, snoozed: {}, hereIds: ['here-1'], now: NOW, ...over,
})

describe('local transcripts', () => {
  test('a turn that ends on a question needs you, with the question as the ask', () => {
    const s = parseTranscript(
      transcript({ id: 'aaaa-1', cwd: '/work/sunbeam-web', title: 'Fix the checkout flow', prompt: 'Fix checkout', reply: 'Tests pass. Should I merge PR #40?', at: '2026-10-14T10:00:00Z' }),
      { fileId: 'aaaa-1', mtimeMs: NOW - 2 * HOUR, now: NOW },
    )!
    expect(s.status).toBe('needs_you')
    expect(s.detail).toBe('Should I merge PR #40?')
    expect(s.title).toBe('Fix the checkout flow')
    expect(s.firstPrompt).toBe('Fix checkout')
    expect(s.repo).toBe('sunbeam-web')
    expect(s.open).toBe('claude --resume aaaa-1')
  })

  test('a fresh transcript mid tool loop is working; an old finished one is idle', () => {
    const working = parseTranscript(
      transcript({ id: 'w', cwd: '/work/sunbeam-web', prompt: 'Build it', reply: 'Running the tests', at: '2026-10-14T11:59:00Z', stop: 'tool_use' }),
      { fileId: 'w', mtimeMs: NOW - 30_000, now: NOW },
    )!
    expect(working.status).toBe('working')
    const idle = parseTranscript(
      transcript({ id: 'i', cwd: '/work/sunbeam-web', prompt: 'Write FAQ', reply: 'Done: the FAQ is live.', at: '2026-10-13T10:00:00Z' }),
      { fileId: 'i', mtimeMs: NOW - 26 * HOUR, now: NOW },
    )!
    expect(idle.status).toBe('idle')
    expect(idle.detail).toBe(null)
  })

  test('questions are spotted by Timu\'s rules', () => {
    expect(looksLikeQuestion('Want me to ship it?')).toBe(true)
    expect(looksLikeQuestion('Let me know which option you prefer.')).toBe(true)
    expect(looksLikeQuestion('Shipped. The PR is merged.')).toBe(false)
  })
})

describe('cloud sessions', () => {
  test('a blocked session needs you; its repo comes from the outcome', () => {
    const s = mapCloudSession({
      id: 'session_01DUCK', title: 'Supplier onboarding', status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED',
      updated_at: '2026-10-14T09:00:00Z',
      session_context: { outcomes: [{ git_repository: { git_info: { repo: 'duckworks/procurement-app' } } }] },
      external_metadata: { post_turn_summary: { needs_action: 'Approve the supplier list', status_detail: 'list drafted' } },
    })
    expect(s.status).toBe('needs_you')
    expect(s.detail).toBe('Approve the supplier list')
    expect(s.repo).toBe('duckworks/procurement-app')
    expect(s.open).toBe('https://claude.ai/code/session_01DUCK')
  })

  test('the list tool\'s text is read through its envelope', () => {
    const text = `<other-session nonce="x">\nData:\n${JSON.stringify({ ccr: { data: [{ id: 'session_01A' }, { id: 'nope' }] } })}\n</other-session>`
    expect(parseCloudList(text)).toEqual({ records: [{ id: 'session_01A' }], hasMore: false, lastId: null })
    const page = JSON.stringify({ ccr: { data: [{ id: 'session_01B' }], has_more: true, last_id: 'session_01B' } })
    expect(parseCloudList(page)).toEqual({ records: [{ id: 'session_01B' }], hasMore: true, lastId: 'session_01B' })
    expect(parseCloudList('no json here').records).toEqual([])
  })

  test('remotes name their repository', () => {
    expect(repoFromUrl('git@github.com:sunbeam-co/sunbeam-web.git\n')).toBe('sunbeam-co/sunbeam-web')
    expect(repoFromUrl('https://github.com/duckworks/procurement-app')).toBe('duckworks/procurement-app')
    expect(repoFromUrl('')).toBe(null)
  })
})

describe('filing', () => {
  const login = local({ id: 'aaaa-1', title: 'Fix the login redirect', status: 'needs_you', detail: 'Should I merge PR #40?' })
  const seo = local({ id: 'bbbb-2', title: 'Improve SEO meta tags', lastAt: '2026-10-14T08:00:00Z' })
  const here = local({ id: 'here-1', title: 'Plan the launch', status: 'needs_you', detail: 'Which date?' })

  test('company from the remote owner, project from the repo, teammates by discipline', () => {
    const rows = fileSessions(world([login, seo, here]))
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(byId['aaaa-1']!.company).toBe('Sunbeam Co')
    expect(byId['aaaa-1']!.project).toBe('Sunbeam Web')
    expect(byId['aaaa-1']!.teammate.role).toBe('Software Engineer')
    expect(byId['bbbb-2']!.teammate.role).toBe('SEO Lead')
    expect(byId['bbbb-2']!.teammate.name).not.toBe(byId['aaaa-1']!.teammate.name)
    // The same input files the same way.
    expect(fileSessions(world([seo, here, login])).find(r => r.id === 'bbbb-2')!.teammate).toEqual(byId['bbbb-2']!.teammate)
  })

  test('this session never asks; the others do until handled or snoozed', () => {
    const asks = (over: Partial<FileInput> = {}) => fileSessions(world([login, here], over)).filter(r => r.ask).map(r => r.id)
    expect(asks()).toEqual(['aaaa-1'])
    expect(asks({ handled: { 'aaaa-1': '2026-10-14T10:00:00Z' } })).toEqual([])
    // New activity after it was handled opens it again.
    expect(asks({ handled: { 'aaaa-1': '2026-10-14T09:00:00Z' } })).toEqual(['aaaa-1'])
    expect(asks({ snoozed: { 'aaaa-1': NOW + HOUR } })).toEqual([])
    expect(asks({ snoozed: { 'aaaa-1': NOW - HOUR } })).toEqual(['aaaa-1'])
  })

  test('your filing and companies win over the guesses', () => {
    const rows = fileSessions(world([login, here], {
      filing: { 'here-1': { project: 'Launch', goal: 'Ship v2' } },
      companies: { Launch: 'Sunbeam Co' },
    }))
    const row = rows.find(r => r.id === 'here-1')!
    expect([row.company, row.project, row.goal]).toEqual(['Sunbeam Co', 'Launch', 'Ship v2'])
  })

  test('a cloud session\'s own transcript shows once, with the cloud record\'s repo', () => {
    const cloudHere: Session = { ...local({ id: 'session_01HERE', title: 'Plan the launch' }), source: 'cloud', repo: 'sunbeam-co/sunbeam-device', folder: null }
    const homeHere = local({ id: 'here-1', title: 'Plan the launch', repo: 'demo', folder: '/demo-home' })
    const rows = fileSessions(world([homeHere, cloudHere], { hereIds: ['here-1', 'session_01HERE'] }))
    expect(rows.length).toBe(1)
    expect(rows[0]!.project).toBe('Sunbeam Device')
    expect(rows[0]!.isHere).toBe(true)
  })

  test('a terminal session connected to claude.ai shows once, and a fork of it stays its own', () => {
    const remote = (url: string | null) => JSON.stringify({ type: 'attachment', sessionId: 'tty-1', attachment: { type: 'remote_session_change', url } })
    const text = [
      remote('https://claude.ai/code/cse_01SETUP'),
      transcript({ id: 'tty-1', cwd: '/work/sunbeam-web', prompt: 'Set up Sunbeam Web in one step', reply: 'Done.', at: '2026-10-14T10:00:00Z' }),
      remote(null),
    ].join('\n')
    const tty = parseTranscript(text, { fileId: 'tty-1', mtimeMs: NOW - 2 * HOUR, now: NOW })!
    expect(tty.cloudId).toBe('session_01SETUP')
    const web: Session = { ...local({ id: 'session_01SETUP', title: 'One-step setup' }), source: 'cloud', open: 'https://claude.ai/code/session_01SETUP' }
    const fork = local({ id: 'tty-2', title: 'One-step setup, with pnpm', cloudId: 'session_01SETUP' })
    const rows = fileSessions(world([web, tty, fork]))
    expect(rows.map(r => r.id).sort()).toEqual(['tty-1', 'tty-2'])
  })

  test('the board text lists asks first, then every project', () => {
    const rows = fileSessions(world([login, seo, here]))
    const text = boardText({ scannedAt: NOW, rows, notes: [] }, NOW)
    expect(text).toContain('1 need you · 0 working · 3 sessions in 1 projects')
    expect(text.indexOf('Needs you:')).toBeLessThan(text.indexOf('Sunbeam Co / Sunbeam Web'))
    expect(text).toContain('Should I merge PR #40?')
    expect(text).toContain('(this session)')
    expect(boardText({ scannedAt: NOW, rows, notes: [] }, NOW, { asksOnly: true })).not.toContain('Improve SEO')
  })
})

test('/timu-file arguments', () => {
  expect(parseFiling('Sunbeam Co > Sunbeam Web / Ship v2')).toEqual({ company: 'Sunbeam Co', project: 'Sunbeam Web', goal: 'Ship v2' })
  expect(parseFiling('Procurement App')).toEqual({ project: 'Procurement App' })
  expect(parseFiling(' / Ship v2')).toEqual({ goal: 'Ship v2' })
  expect(parseFiling('')).toEqual({})
})

test('ages read as words', () => {
  expect(agoText('2026-10-14T11:59:30Z', NOW)).toBe('just now')
  expect(agoText('2026-10-14T10:00:00Z', NOW)).toBe('2h ago')
  expect(agoText(null, NOW)).toBe('')
})
