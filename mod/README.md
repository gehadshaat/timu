# Timu, as a Claude Code mod 🐝

The Timu idea, inside Claude Code itself: every Claude session you have is filed under a **company → project → teammate**, and the few that need you sit on top. No web app, no database: the mod reads your sessions where Claude Code keeps them and draws the board in a pane next to your conversation.

| | |
| --- | --- |
| **Board pane** (`/timu`) | **Needs you** first: each ask with its teammate, project and age, and **Done**, **Snooze 4h** and **Open** buttons. Then every company, its projects and their sessions, with a status chip (needs you, failed, review, working, idle, done). Press a session to copy how to open it (`claude --resume <id>`, or its claude.ai link). **Undo** reverses the last Done or Snooze. |
| **Band above the prompt** | `🐝 2 need you · Maya (Sunbeam Web): Should I merge PR #40?` with **Board** and **Hide**. Hidden stays hidden until a new ask arrives. |
| **Status line** | This session's teammate and project: `🐝 Leo · Sunbeam Web / Ship v2 · 2 need you`. |
| **`/timu-file`** | Files this session: `/timu-file Sunbeam Co > Sunbeam Web / Ship v2`. Any part can be left out (`/timu-file / Ship v2` sets just the goal). With no arguments it says where the session is filed. |
| **`/timu [asks \| all \| sync]`** | Opens the board (on the asks, or everything), or rescans now. Where no pane can open, prints the board instead. |
| **Tools for Claude** | `board` (read: "what needs me?"), `handle_ask` (done or snooze), `file_session` (project, company, goal). Same parity rule as Timu's MCP server: what you can do on the board, Claude can do too. |

## Where the sessions come from

- **Claude Code on this machine:** `~/.claude/projects/*/*.jsonl` (or `CLAUDE_PROJECTS_DIR`, or `$CLAUDE_CONFIG_DIR/projects`), the newest 80 with activity in the last 14 days. A session is **working** while its transcript is still being written mid-turn, and **needs you** when its last reply ends on a question, using Timu's own rules.
- **claude.ai/code cloud sessions:** inside a cloud session, through the `claude-code-remote` server's `list_sessions` tool, with the session's own status (blocked, review-ready, failed) and its "needs action" line. Archived sessions are left out. Elsewhere this source is skipped.
- **This session** is on the board, marked *here*, but never raises an ask: you're already looking at it.

## How filing works

The same rules-based organiser as Timu without the Claude CLI:

- **Company:** the GitHub owner of the session's repository (read from the folder's git remote, or the cloud session's repo), else *Personal*. Set your own with `/timu-file Company > Project`.
- **Project:** the repository's name, else *Personal*. Yours wins once you file a session.
- **Teammate:** one per project and discipline (SEO Lead, Growth Marketer, Hardware Engineer, Software Engineer, …), chosen from keywords in the session's title and first prompt, with a stable cartoon name.
- **Asks:** *respond* (it asked you something), *review* (cloud: ready for review) and *unblock* (cloud: failed). **Done** closes an ask until that session has new activity; **Snooze** hides it for 4 hours.

Your filing, companies, handled asks and snoozes live in the mod's own store, so they last across sessions.

## Try it

From this repository:

```bash
claude --plugin-dir mod
```

Then type `/timu`.

Options (`/config`, or `pluginConfigs.timu.options` in settings): **Days to look back** (default 14) and **Include cloud sessions** (default on).

## Developing

```bash
claude plugin validate mod   # what the module hooks and calls, and anything the engine would refuse
claude plugin test mod       # tests/*.test.ts against the engine, demo workspace only
tsc -p mod                   # once the engine has laid .claude-plugin/types (it does when it loads the mod)
```

- `hooks/org.ts`: pure functions. Parsing transcripts and cloud records, filing, asks, the board as text. Ported from Timu's `src/lib/sources/local.ts`, `sources/cloud.ts`, `classify/heuristic.ts` and `triage/rules.ts`.
- `hooks/scan.ts`: reading the sources through `$` (files, the remote MCP server, `git`).
- `hooks/register.tsx`: the hooks: pane, band, status line, commands, tools, a rescan every 2 minutes, and after a turn when the last scan is over a minute old.
- `types/index.d.ts`: the board's types and the `$.state` contract.

What it leaves out, for now: claude.ai chats, routines, artifacts, goals with milestones and to-dos, and Claude-judged triage. Those stay in the Timu web app.
