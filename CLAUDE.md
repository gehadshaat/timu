# CLAUDE.md — working on Timu

Timu imports a person's Claude sessions (Claude Code local + cloud, claude.ai chats) and runs them like a
small company: **companies → projects → teams → teammates**, with **goals**, **to-dos**, **asks** (what needs
the user), **routines** and **artifacts**. Every page is a board: coloured groups, one row per item, status
cells you click. It runs locally on one SQLite file, and Claude can drive all of it over MCP.

This file is the contract for changing it. **A feature is not done until the "Definition of done" list at the
bottom is satisfied** — code, tests, MCP, docs, setup and the website move together.

---

## Commands

```bash
npm run setup      # first run: installs deps, writes .env.local (tokens), checks for the Claude CLI. Safe to re-run.
npm run dev        # http://localhost:3100 (predev re-checks .env.local; never fails the server)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
npm test           # vitest run — src/**/*.test.ts, in-memory SQLite
npm run mcp        # Timu's MCP server over stdio (no web app needed)
npm run sync:local # push local transcripts to a Timu running elsewhere
npm run db:reset   # delete data/timu.db (+ -wal/-shm) and start over
```

Requirements: **Node ≥ 22.16** — `node:sqlite` built in, and `StatementSync.columns()` (22.16+) is what
`src/lib/db.ts` uses to decode `json`/`boolean` columns. Don't lower `engines` without replacing that.

Run `typecheck`, `lint` and `test` before every commit. All three must pass.

---

## Hard rules

1. **This repo is public.** Never commit real people's data: no real company/project/client names, emails,
   phone numbers, tokens, transcripts or screenshots of a real workspace. Examples, tests, fixtures, prompts and
   screenshots use the demo workspace: **Sunbeam Co** (🌞 Sunbeam Web, Sunbeam Device, Ops) and **Duckworks**
   (🦆 Procurement App), teammates like Maya, Leo, Iris, Kai, Nora, Theo, Omar, Sam, Lena, Pip.
   Before committing, scan the staged diff:
   ```bash
   git diff --cached | grep -iE '^\+.*(sk-ant-|Bearer [A-Za-z0-9]{20,}|@gmail\.com|/home/[a-z]+/)'
   ```
2. **Never touch credentials by hand.** Timu *reads* Claude Code's login at runtime (`src/lib/claude-auth.ts`)
   and must never refresh, print, log or store tokens. Don't add code that writes `~/.claude*`.
3. **`.env.local` and `data/` are never committed** (both are in `.gitignore`). New config goes in
   `.env.example` with a comment.
4. **Accounts share one org.** Several Claude accounts (`src/lib/claude-accounts.ts`) are only a source tag
   (`account` column) — never split companies, projects or goals by account.
5. **Model calls go through the Claude CLI.** Anything that asks Claude (organiser, triage, a new judge) uses
   `askClaude()` in `src/lib/claude-cli.ts` — `claude -p` with a Zod schema, on the user's own login, with
   tools, MCP and settings off. No Anthropic SDK and no API key. Gate it on `hasClaude()` and keep a
   rules-only fallback (`CLAUDE_CLI=off` forces it).
6. **Commits** are authored with the GitHub noreply address (`git config user.email
   6731998+gehadshaat@users.noreply.github.com`). Branch per feature; PRs against `main`.

---

## Map of the code

| Where | What |
| --- | --- |
| `db/schema.sql` | The schema a **fresh** database starts from (applied as version 1). |
| `db/migrations/NNNN_name.sql` | Every schema change after that, applied in order on open (`PRAGMA user_version`). |
| `src/lib/db.ts` | SQLite helpers: `all`, `get`, `scalar`, `run`, `insert` (with `on conflict`), `update`, `tx`, `getSetting`/`setSetting`. `IN` lists: `id in (select value from json_each(?))` with the array as one param. |
| `src/lib/types.ts` | Row types (`SessionRow`, `TaskRow`, `GoalRow`…). Keep in step with the schema. |
| `src/lib/queries.ts` | Read models for pages: `getOrg`, `getSessions` (`SESSION_LIST_COLUMNS`), `getGoals`, `getTodos`, `getInbox`, `getOffice`… |
| `src/lib/ops.ts` | Single-item writes (`ActionResult`), `syncAll`. |
| `src/lib/auto-sync.ts`, `src/instrumentation.ts` | The timed sync: started with the server, `syncNow` serialises every sync (timer, button, MCP), `syncStatus` for the UI. |
| `src/lib/live.ts`, `src/app/api/events/route.ts`, `components/LiveRefresh.tsx` | Live pages: a watcher polls `PRAGMA data_version`, `/api/events` streams `change`/`sync` (SSE), open tabs `router.refresh()`. |
| `src/lib/bulk.ts` | Many-item writes. Each returns a `BulkResult` with an `UndoSnapshot`; `applyUndo` restores it. |
| `src/lib/ingest.ts` | Upserts imported sessions, runs triage, opens/closes asks, links artifacts. |
| `src/lib/sources/*.ts` | One parser per source: `local` (transcripts), `cloud`, `claudeai`, `routines`, `artifacts`. Pure functions → easy to test. |
| `src/lib/claude-accounts.ts`, `claude-auth.ts`, `claude-auth-store.ts` | Which Claude accounts exist, their login (borrowed from Claude Code, re-read every pull, falls back on 401), and which one worked last. |
| `src/lib/routines.ts`, `src/lib/artifacts.ts` | Routines and artifacts: save, file under teammate/project, views for boards. |
| `src/lib/classify/`, `src/lib/organize.ts` | The organiser: files sessions into the org (Claude through the `claude -p` CLI in `src/lib/claude-cli.ts`, else heuristics). |
| `src/lib/triage/` | Does a session genuinely need the user? Rules → TypeSafe/Claude → status. |
| `src/lib/office-map.ts` | Layout maths for the walkable office (tested). |
| `src/lib/mcp/` | The MCP server: `server.ts` (instructions + registration), `tool.ts` (`defineTool`, refs), `resolve.ts` (id/slug/name lookup), `tools/*.ts`. |
| `src/app/actions.ts`, `src/app/_actions/*` | Server actions the UI calls. Wrap writes in `refreshing(...)` (revalidates the layout). |
| `src/app/(app)/**/page.tsx` | Pages (server components). |
| `src/components/board/` | **The board system**: `palette.ts` (every status/priority colour), `SessionStatusCell`, `PeopleBoard`. |
| `src/components/goals/GoalsTable.tsx` | Project/goal board rows (`TodoRow`, `SessionRowView`, `ColumnHeads`) — reuse them, don't fork them. |
| `src/components/ui/` | `Popover` (use `floating` inside tables), `Picker` (`OrgPicker`), `Renameable`, `BulkBar`, `useBulkRunner` (toast + Undo), `Toaster`. |
| `docs/` | The GitHub Pages site (`index.html`) and the README/site screenshots (`docs/images/`). |
| `scripts/setup.mjs` | One-command setup. Plain Node, no deps, safe to re-run, never fails `npm run dev`. |
| `extension/` | Chrome extension that syncs claude.ai chats to `/api/ingest/claude-ai`. |
| `mod/` | Timu as a Claude Code mod: a board pane, a "needs you" band, `/timu` and `/timu-file`, and tools for Claude, in a hooks module. Its filing (`mod/hooks/org.ts`) ports `sources/local.ts`, `sources/cloud.ts`, `classify/heuristic.ts` and `triage/rules.ts`: keep them in step. Tested with `claude plugin test mod`; left out of the app's `tsconfig.json` and ESLint. |

---

## How things are built here

### Data and migrations
- **Schema change = new migration file**, `db/migrations/000N_what.sql`, the next number. Do **not** also add the
  column to `db/schema.sql`: a fresh database applies `schema.sql` *and then* every migration, so it would be
  added twice. Write a comment in the migration explaining the column.
- Columns declared `json` or `boolean` are decoded automatically on read; booleans/objects are encoded on write.
- After adding a column, update `types.ts`, any `*_COLUMNS` list that should carry it, and `session-lite.ts`
  if boards need it.
- Restart the dev server after adding a migration — the connection migrates only when it opens.

### Syncs and live pages
- Syncs run on a timer (`auto-sync.ts`), and **every write refreshes every open page** (`live.ts` watches the database
  file). So a write path that runs on each sync must write nothing when nothing changed: compare before you upsert
  (see `ingestSessions`, `saveRoutines`), and don't record runs or timestamps that changed nothing.
- Anything that calls a model on each sync waits for the session to pause (`judgeOrDefer` / `triage_due_at`,
  `REFILE_QUIET_MS`), so a conversation in progress doesn't cost a call per sync.
- Server state shared between the instrumentation bundle and the app bundle lives on `globalThis` (Next loads the
  module twice).

### Writes, undo and the toast
- Bulk-style writes live in `src/lib/bulk.ts` and return an `UndoSnapshot`; the UI runs them through
  `useBulkRunner().run(...)`, which shows a toast with **Undo**. New destructive-ish actions should be undoable.
- A status the user sets on a session (`sessions.status_override`) wins until the session has new activity —
  `ingest.ts` clears it. Asks opened by "Needs me" are recorded closed in the undo snapshot.

### UI: everything is a board
- Every list is a board: a coloured group header, a column header row, rows with the same columns, solid
  status cells you click (`palette.ts`). New pages follow the same pattern and reuse the row components.
- Group colours: `groupColor(i)`. Status colours: `SESSION_STATUS`, `GOAL_STATUS`, `PRIORITY`, `ASK_KIND`,
  `POSE_TONE` in `palette.ts` — never hard-code a new status colour elsewhere.
- Menus inside tables use `<Popover floating>` (otherwise rows clip them).
- **Relative times** ("5m ago", "in 3h") render after mount (`useMounted`/`useNow` patterns) or are computed on
  the server and passed as strings — never `Date.now()` during client render (hydration mismatch).
- Must work at phone width: hide lesser columns with `hidden sm:flex`/`md:flex`, no horizontal page scroll.
- Every session row offers **Open** (`OpenSession`, with `resumeFor()` for local sessions) and its 🖼️ artifacts chip.
- The office (`/office`, `components/office/OfficeMap.tsx`) is the one non-board view; keep it memoised so only
  "you" re-renders while walking.

### Sources and filing
- A new source = a pure parser in `src/lib/sources/`, tests for it, and an import path that runs through
  `ingestSessions(source, sessions, account)`.
- Sign-in goes through `withClaudeToken` / `claudeTokens(account)`; never read `CLAUDE_SESSIONS_TOKEN` directly.
- Things are filed under a teammate/project via the session they belong to. Artifacts count only when a session
  **published** them (`publishedArtifactLinks`) — a session that merely lists or mentions them must not claim them.

### MCP
- Tools live in `src/lib/mcp/tools/<area>.ts`, defined with `defineTool(server, name, { title, kind, description, input }, handler)`:
  - `kind`: `"read"`, `"write"` or `"destructive"` (sets the MCP annotations).
  - Inputs that name things use `ref(COMPANY_REF | PROJECT_REF | TEAM_REF | TEAMMATE_REF | SESSION_REF)` and are
    resolved with `resolve.ts` (id, slug or exact name; "Project / Team" to disambiguate).
  - Bulk/undoable tools return an `undo_id` (see `tools/bulk.ts`).
  - Descriptions say what the tool returns and how to filter — Claude reads them to choose tools.
- Register new tool files in `src/lib/mcp/server.ts`, and **update `INSTRUCTIONS`** there when you add a new
  kind of thing or workflow.
- **Parity rule:** anything the UI can read or change, Claude can read or change over MCP. Read tools that
  describe an entity (`get_org`, `get_project`, `get_teammate`, `get_session`) include its new related data.
- Verify against a running dev server:
  ```bash
  curl -s localhost:3100/api/mcp -H "Authorization: Bearer $TIMU_MCP_TOKEN" -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
  ```

### Tests
- Vitest, `src/**/*.test.ts`. DB tests: `beforeAll(() => useDatabase(openDatabase(":memory:")))`,
  `afterAll(() => useDatabase(null))` — migrations run automatically.
- Test parsers (`sources/*`), layout/maths, filing rules and every bulk op with its undo. Demo names only.

---

## Docs, setup and website

| File | Keep it true about |
| --- | --- |
| `README.md` | Install (the **one** install path: clone → `npm run setup` → `npm run dev`), "Your first five minutes" (must match the setup wizard's real steps and button labels), "A tour" (screenshots), then reference sections: Sources (Cloud sessions, Several Claude accounts, Routines, Artifacts, Chrome extension), Let Claude run Timu (MCP), How organising works, Development. |
| `.env.example` | Every environment variable, commented, grouped by section. |
| `scripts/setup.mjs` | Anything a new user must have for the feature to work (generated tokens, prompts, printed next steps). |
| `src/components/SourcesPanel.tsx`, `McpPanel.tsx` | In-app setup help on the Settings page. |
| `docs/index.html` | The website: install terminal, first five minutes, tour, FAQ. Keep claims accurate (data, cost, sign-in). |
| `docs/images/*.png` | Screenshots, from the **demo workspace only**. |

### Retaking screenshots (demo workspace, never real data)
1. Run an isolated Timu on another port so it can't see the real login or transcripts:
   ```bash
   TIMU_DB_PATH=/tmp/timu-demo/demo.db CLAUDE_ACCOUNTS=/tmp/timu-demo/no-account \
   CLAUDE_CREDENTIALS_PATH=/tmp/timu-demo/no-account/.credentials.json CLAUDE_CONFIG_PATH=/tmp/timu-demo/no-account/.claude.json \
   CLAUDE_PROJECTS_DIR=/tmp/timu-demo/empty CLAUDE_SESSIONS_TOKEN= CLAUDE_CLI=off TYPESAFE_API_KEY= TIMU_PASSWORD= \
   npx next dev -p 3102
   ```
   (Stop other `next dev` servers in the same checkout first — they share `.next/`.)
2. Seed it through the MCP tools: `import_cloud_sessions` with `fixtures/demo-cloud-sessions.json` (timestamps
   shifted to recent), `create_company`/`create_project`/`create_team`/`hire_teammates`, `add_goals`,
   `add_milestones`, `assign_sessions`, `move_sessions`, `add_todos`, `import_routines`, `import_artifacts`.
   Then set `setup_complete` to `true` in the demo DB's `settings` table to skip the wizard.
3. Capture at **1440×900**, hiding the Next.js dev badge (`nextjs-portal { display: none }`), into
   `docs/images/<page>.png`. Re-shoot only the pages the change affects. The social card is `docs/images/og.png` (1280×640).

---

## Definition of done (every feature)

- [ ] **Code** follows the patterns above; board UI reuses `palette.ts` and the shared rows.
- [ ] **Schema** changes are a new migration (+ `types.ts`, column lists).
- [ ] **Tests** cover the new logic (demo names); `npm run typecheck && npm run lint && npm test` pass.
- [ ] **MCP**: new reads/writes exposed as tools (or added to existing `get_*` results); registered in
      `server.ts`; `INSTRUCTIONS` updated if it's a new kind of thing; tried with `tools/list` / `tools/call`.
- [ ] **README**: the relevant reference section added or updated; the tour/first-five-minutes still accurate.
- [ ] **Setup**: new config in `.env.example`; `scripts/setup.mjs` and the Settings panels updated if a new
      user needs to do something.
- [ ] **Website** (`docs/index.html`): updated if the feature changes what Timu does, how to install it, or a
      FAQ answer; screenshots re-taken from the demo workspace if a pictured page changed.
- [ ] **Checked in the browser** at desktop and phone width; no new console errors.
- [ ] **Public-safety scan** of the staged diff (Hard rule 1) is clean.
- [ ] **PR description**: what changed, what's left out, how it was tested.
