/** Where a session stands, as Timu's boards colour it. */
export type Status = 'working' | 'needs_you' | 'review' | 'idle' | 'done' | 'failed'

/** What a session wants from you. */
export type AskKind = 'respond' | 'review' | 'unblock'

/** The teammate who owns a stream of sessions in one project. */
export type Teammate = { name: string; role: string; team: string; emoji: string }

/** One session, filed: company → project → teammate (and goal, when you set one). */
export type Row = {
  id: string
  source: 'local' | 'cloud'
  title: string
  status: Status
  company: string
  project: string
  projectEmoji: string
  goal: string | null
  teammate: Teammate
  lastAt: string | null
  /** `claude --resume <id>` for a local session, its claude.ai URL for a cloud one. */
  open: string
  ask: { kind: AskKind; text: string } | null
  isHere: boolean
}

export type Board = { scannedAt: number; rows: Row[]; notes: string[] }

export type View = 'all' | 'asks'

declare module 'claude-code' {
  interface PluginState {
    timu: {
      board: Board | null
      view: View
      /** The asks the band was hidden for; a new ask shows it again. */
      bandHiddenFor: string
    }
  }
}
