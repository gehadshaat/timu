import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

/**
 * The mod end to end on a demo workspace: Sunbeam Co's transcripts on disk,
 * a Duckworks session in the cloud, this session among them.
 */

const NOW = Date.parse('2026-10-14T12:00:00Z')
const PROJECTS = '/demo-home/.claude/projects'
const FOLDER = `${PROJECTS}/-work-sunbeam-web`

const transcript = (id: string, title: string, reply: string) =>
  [
    JSON.stringify({ type: 'ai-title', aiTitle: title }),
    JSON.stringify({ type: 'user', sessionId: id, cwd: '/work/sunbeam-web', timestamp: '2026-10-14T10:00:00Z', message: { role: 'user', content: title } }),
    JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/work/sunbeam-web', timestamp: '2026-10-14T10:00:00Z', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: reply }] } }),
  ].join('\n')

const FILES: Record<string, string> = {
  [`${FOLDER}/aaaa-1.jsonl`]: transcript('aaaa-1', 'Fix the login redirect', 'Tests pass. Should I merge PR #40?'),
  [`${FOLDER}/bbbb-2.jsonl`]: transcript('bbbb-2', 'Improve SEO meta tags', 'Done: titles and descriptions are updated.'),
  [`${FOLDER}/here-1.jsonl`]: transcript('here-1', 'Plan the launch', 'Which launch date works for you?'),
}

const CLOUD = {
  ccr: {
    data: [
      {
        id: 'session_01DUCK', title: 'Supplier onboarding', status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED',
        updated_at: '2026-10-14T09:00:00Z',
        session_context: { outcomes: [{ git_repository: { git_info: { repo: 'duckworks/procurement-app' } } }] },
        external_metadata: { post_turn_summary: { needs_action: 'Approve the supplier list' } },
      },
      { id: 'session_01OLD', title: 'Old archived work', session_status: 'SESSION_STATUS_ARCHIVED', updated_at: '2026-10-14T09:00:00Z' },
    ],
  },
}

const PANE_PROPS = { title: '🐝 Timu', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

/** Everything beneath the mod: a disk, a cloud, a clipboard, a status line. */
function world(on: On, opts: { hasCloud?: boolean; cloudFails?: boolean } = { hasCloud: true }) {
  const said = { statuses: [] as (string | undefined)[], toasts: [] as string[], copied: [] as string[], opened: [] as string[], cloudCalls: [] as unknown[] }
  mock.store(on)
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/demo-home' })
  const entry = (name: string, kind: FsEntry['kind']): FsEntry => ({ name, kind, size: 100, mtimeMs: NOW - 2 * 3_600_000, isLink: false })
  on('fs.exists', ($, e) => ({ value: e.path === PROJECTS || e.path in FILES }))
  on('fs.list', ($, e) => {
    if (e.path === PROJECTS) return { value: [entry('-work-sunbeam-web', 'dir')] }
    if (e.path === FOLDER) return { value: Object.keys(FILES).map(p => entry(p.split('/').pop()!, 'file')) }
    return { deny: 'ENOENT' }
  })
  on('fs.read', ($, e) => (e.path in FILES ? { value: FILES[e.path]! } : { deny: 'ENOENT' }))
  on('process.run', ($, e) => ({
    value: e.argv[0] === 'git' && e.argv[2] === '/work/sunbeam-web'
      ? { exitCode: 0, stdout: 'git@github.com:sunbeam-co/sunbeam-web.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
      : { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  // The cloud answers 10 sessions a page; the second page is asked for by the first's last id.
  on('tool.list', () => ({ value: opts.hasCloud ? [{ name: 'mcp__claude-code-remote__list_sessions', description: 'List sessions', mcp: true }] : [] }))
  on('mcp.call', ($, e) => {
    said.cloudCalls.push(e.args)
    if (opts.cloudFails) return { value: { content: [{ type: 'text', text: 'Output too large; saved to a file' }], isError: false } }
    const [first, archived] = CLOUD.ccr.data
    const page = e.args.after_id === 'session_01DUCK'
      ? { ccr: { data: [archived], has_more: false } }
      : { ccr: { data: [first], has_more: true, last_id: 'session_01DUCK' } }
    return { value: { content: [{ type: 'text', text: `<other-session nonce="n">\n${JSON.stringify(page)}\n</other-session>` }], isError: false } }
  })
  on('session.id', () => ({ value: 'here-1' }))
  on('session.repo', () => ({ value: null }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__timu__${e.name}` } }))
  on('ui.status', ($, e) => (said.statuses.push(e.text), { value: undefined }))
  on('ui.toast', ($, e) => (said.toasts.push(e.text), { value: undefined }))
  on('ui.copy', ($, e) => (said.copied.push(e.text), { value: { isCopied: true as const } }))
  on('ui.open', ($, e) => (said.opened.push(e.id), { value: { isPlaced: true as const } }))
  // What the engine draws in the band when the mod leaves it alone.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ dimColor: true, children: 'the engine\'s band' }))
  return said
}

async function start($: Engine) {
  await $.session.start({ cwd: '/work/sunbeam-web', surface: 'terminal', isInteractive: true })
  return $.command.run(typed('timu', 'sync'))
}

const toolText = (ran: { result?: unknown }) => String(ran.result)

/** A slash command as the person types it at the prompt. */
const typed = (command: string, args = '') =>
  ({ command, args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 140 } })

test('it files every session and finds what needs you', async ($, on) => {
  const said = world(on)
  const synced = await start($)
  expect(synced.text).toBe('Timu synced: 2 need you · 0 working · 4 sessions in 2 projects.')

  const board = toolText(await $.tool.call({ tool: 'mcp__timu__board' }))
  expect(board).toContain('Sunbeam Co / Sunbeam Web')
  expect(board).toContain('Duckworks / Procurement App')
  expect(board).toContain('Should I merge PR #40?')
  expect(board).toContain('Approve the supplier list')
  expect(board).not.toContain('Old archived work')
  // This session asked a question too, but you are here: it is not an ask.
  expect(toolText(await $.tool.call({ tool: 'mcp__timu__board', needs_me_only: true }))).not.toContain('Which launch date')
  expect(said.statuses.at(-1)).toMatch(/^🐝 \w+ · Sunbeam Web · 2 need you$/)
})

test('/timu opens the board pane; it draws on every surface and clears asks with undo', async ($, on) => {
  const said = world(on)
  await start($)
  const opened = await $.command.run(typed('timu'))
  expect(opened.text).toBe('Timu board opened: 2 need you · 0 working · 4 sessions in 2 projects.')
  expect(said.opened).toEqual(['timu'])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'timu', surface, component: 'Pane', requestId: 'timu', props: PANE_PROPS })
    expect(await ui.find({ text: /2 need you · 0 working/ })).toBeDefined()
    expect(await ui.find({ text: /Should I merge PR #40\?/ })).toBeDefined()
    expect(await ui.find({ text: /🏢 Duckworks/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'timu', surface: 'terminal', component: 'Pane', requestId: 'timu', props: PANE_PROPS })
  await ui.press({ key: 'done-aaaa-1' })
  expect(await ui.find({ text: /Should I merge PR #40\?/ })).toBeUndefined()
  expect(await ui.find({ text: /1 need you/ })).toBeDefined()
  expect(await ui.find({ key: 'undo' })).toBeDefined()

  await ui.press({ key: 'undo' })
  expect(await ui.find({ text: /Should I merge PR #40\?/ })).toBeDefined()

  await ui.press({ key: 'view-asks' })
  expect(await ui.find({ text: /🏢 Sunbeam Co/ })).toBeUndefined()

  await ui.press({ key: 'open-session_01DUCK' })
  expect(said.copied).toEqual(['https://claude.ai/code/session_01DUCK'])
  expect(said.toasts.at(-1)).toBe('Copied: https://claude.ai/code/session_01DUCK')
})

test('the band above the prompt shows what needs you until hidden', async ($, on) => {
  world(on)
  await start($)
  const band = await $.ui.mount({ plugin: 'timu', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ text: /🐝 2 need you/ })).toBeDefined()
  await band.press({ key: 'band-hide' })
  expect(await band.find({ text: /need you/ })).toBeUndefined()
  expect(await band.find({ text: "the engine's band" })).toBeDefined()
})

test('Claude can clear an ask and file a session', async ($, on) => {
  world(on)
  await start($)
  const handled = toolText(await $.tool.call({ tool: 'mcp__timu__handle_ask', session: 'session_01DUCK', action: 'snooze', hours: 2 }))
  expect(handled).toBe('Snoozed "Supplier onboarding" for 2h.')
  const asks = toolText(await $.tool.call({ tool: 'mcp__timu__board', needs_me_only: true }))
  expect(asks).not.toContain('Approve the supplier list')

  const ambiguous = await $.tool.call({ tool: 'mcp__timu__handle_ask', session: 'nothing-like-it', action: 'done' })
  expect(ambiguous.isError).toBe(true)

  const filed = await $.command.run(typed('timu-file', 'Sunbeam Co > Launch / Ship v2'))
  expect(filed.text).toMatch(/^Filed "Plan the launch" under Sunbeam Co \/ Launch, goal "Ship v2" \(\w+, /)
  const moved = toolText(await $.tool.call({ tool: 'mcp__timu__file_session', session: 'bbbb-2', project: 'Launch' }))
  expect(moved).toMatch(/^Filed "Improve SEO meta tags" under Sunbeam Co \/ Launch \(\w+, SEO Lead\)\.$/)
})

test('cloud sessions come in pages; without the cloud server it says nothing', async ($, on) => {
  const said = world(on)
  await start($)
  expect(said.cloudCalls).toEqual([{ limit: 10 }, { limit: 10, after_id: 'session_01DUCK' }])
})

test('local only: no cloud server, no cloud calls and no note', async ($, on) => {
  const said = world(on, {})
  const synced = await start($)
  expect(synced.text).toBe('Timu synced: 1 need you · 0 working · 3 sessions in 1 projects.')
  expect(said.cloudCalls).toEqual([])
  expect(toolText(await $.tool.call({ tool: 'mcp__timu__board' }))).not.toContain('Cloud sessions:')
})

test('a cloud answer it cannot read shows why, and the local board still works', async ($, on) => {
  world(on, { hasCloud: true, cloudFails: true })
  const synced = await start($)
  expect(synced.text).toBe('Timu synced: 1 need you · 0 working · 3 sessions in 1 projects.')
  expect(toolText(await $.tool.call({ tool: 'mcp__timu__board' }))).toContain("(Cloud sessions: could not read list_sessions' answer (33 characters))")
})
