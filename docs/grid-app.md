# Grid app: brief for Claude Code

Build a small web app, run on the owner's Mac mini ("kedlubna"), for making this model true to reality one grid
square at a time, and for seeing what that costs in Claude tokens. Read `CLAUDE.md` first: it explains the model,
the pipeline, the coordinate frame and the rules for reference imagery.

The owner is a designer, not a developer: the app is their control room. Keep it simple to run (one command,
starts on login), simple to look at, and honest about state and cost.

## What it does

### 1. The grid

- Slice the play area into square cells. Default 100 m (10 columns × 12 rows over the 920 × 1120 m area in
  `tools/area.mjs`); cell size configurable. Name cells like a map: columns A… west to east, rows 1… north to
  south (scene frame: +x east, +z south).
- For each cell, derive what's in it from `public/data/scene.json` and `data/raw/` (buildings with RÚIAN codes and
  house numbers, named streets, places/landmarks), so a cell can be described to a Claude Code session in words.

### 2. The admin / overview page

- The map from above with the grid over it. Use the orthophoto (`data/raw/ortho.jpg`, georeferenced to `AREA`, 0.25
  m/px) and/or a top-down render of the model; let the owner toggle between them (real vs model is the point).
- Each cell coloured by status: **todo**, **in progress**, **done**, **needs fix** (has open bugs). Click a cell to
  open it.
- A totals bar: cells done, open bugs, tokens and cost so far, share of the plan (see 5).

### 3. The cell page

- **Preview**: the live game in an iframe aimed at the cell: overview via `?overview&view=x,y,z,tx,ty,tz` and
  street level via `?at=x,z,yaw` (see `CLAUDE.md`); plus a few saved screenshots (Playwright, headless) so
  progress over time is visible as before/after.
- **Reference**: the orthophoto crop, Mapillary views (`tools/look-at.mjs`, may be stored), and the owner's own
  **Street View screenshots**, uploaded by drag and drop and attached to the cell (several per cell, with an
  optional caption such as "Betlémské nám. 9 from the square"). Store them on the server outside the git repo
  (Google's terms: reference only, never committed or used as textures; see `CLAUDE.md`).
- **Notes and bugs**: free text per cell, and a bug list (open / fixed) the owner fills in while walking the model.
- **Status** set by hand (and moved to "in progress" automatically while a session works on the cell).
- **Work on this cell**: start a Claude Code session on it (see 4), and the history of the sessions that touched
  it, each with its prompt, summary, commit(s), tokens and cost.

### 4. Running Claude Code on a cell

- Start sessions from the app with Claude Code in headless mode or the Claude Agent SDK (TypeScript:
  `@anthropic-ai/claude-agent-sdk`, docs at code.claude.com/docs/en/agent-sdk) in a checkout of this repo, signed
  in with the owner's Claude subscription on the Mac mini.
- The prompt is assembled from the cell: its bounds and contents, the owner's notes and open bugs, the attached
  reference images (passed as image inputs), and the standing instruction "make this cell as true to reality as
  possible: houses, facades, signs, pavements, furniture; follow CLAUDE.md and docs/realism-workflow.md". The owner can edit it before sending.
- One git branch per cell session (e.g. `cell/C4-…`), so work can be reviewed and merged; show the diff summary.
- After the session: rebuild (`node tools/build-scene.mjs` when tools/ or data/ changed, `npx vite build`), take
  new screenshots, attach them to the session record.
- Sessions are long (tens of minutes) and the app must survive the browser closing: run them as server-side jobs
  with a log the page can follow.

### 5. Tokens and cost

The owner wants to know how token-hungry this is, per cell and in total, against their plan.

- Per session record input, output, cache-write and cache-read tokens and the model(s) used. Sources: the Agent
  SDK's result message (usage and cost), or Claude Code's transcripts (`~/.claude/projects/<project>/<session>.jsonl`:
  each assistant message carries `message.usage`; de-duplicate by message id, since a message can appear in
  several lines).
- Show tokens and an **API-equivalent cost** (what the same tokens would cost on the API) from an editable price
  table. Prices per million tokens at the time of writing: Claude Opus 5.5 $4 input, $20 output, $0.20 cache read,
  cache write 1.25× input (5-minute cache) or 2× (1-hour cache); Claude Haiku 5.5 $0.10 / $0.50. Keep them
  editable: prices change.
- **Against the plan**: the owner is on a $100/month subscription with a weekly usage limit. Anthropic does not
  publish that limit as a token number, so don't hard-code one. Let the owner calibrate: they type in the
  percentage of the weekly limit that Claude shows them (Claude Code `/usage`, or claude.ai settings) together with
  the tokens the app counted that week, and the app estimates the weekly budget from that and shows each cell's
  share of the week and of the monthly $100.
- Per cell: total tokens, cost, share of the week, and tokens per "done" cell, so the cost of finishing the whole
  map can be extrapolated.

Baseline, measured from the transcript of the session that built most of the current model (on disk from
2026-10-23 19:35 to 2026-10-24 17:49 UTC; earlier sessions' transcripts were not kept, so the real total is
higher): about 1,020 model responses; 1.32 M output tokens, 3.39 M cache-write tokens, 390 M cache-read tokens,
~2 k uncached input tokens, almost all on Claude Opus 5.5. At the API prices above that is roughly $26 (output) +
$27 (cache writes, 1-hour) + $78 (cache reads) ≈ **$130**. Cache reads dominate: every turn re-reads the whole
conversation, so long sessions get expensive. One fresh session per cell keeps that down.

## Technical guidance

- Stack: whatever is simplest to keep alive on macOS; Node is already needed for the model (Node 22+, the repo
  is ESM). A single server (e.g. Node + a small web framework) serving the admin UI and the built game, with a
  SQLite file for cells, notes, bugs, sessions and usage. No cloud services required.
- Run under `launchd` so it starts on login and restarts on failure; reachable on the home network (and, if the
  owner wants, over Tailscale). Basic auth at least if it's reachable beyond the LAN.
- Keep the app in its own directory (e.g. `app/`) of this repo or a sibling repo; never make the game depend on it.
- Uploaded Street View screenshots and other reference files go in a data directory outside git, backed up with
  the SQLite file.
- Playwright on macOS: use Playwright's bundled Chromium (the screenshot tool in `tools/` hard-codes a Linux path).

## First milestone

1. Grid over the orthophoto with clickable cells and status colours.
2. Cell page with the live preview, reference uploads, notes and bugs.
3. Token accounting from existing Claude Code transcripts, shown per session, with the price table and the plan
   calibration.
4. Then: starting Claude Code sessions from a cell.
