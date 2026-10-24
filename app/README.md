# Grid app

The control room for making the model true to reality one 100 m cell at a time (brief: `docs/grid-app.md`): the
map of cells over the orthophoto (or the model from above), a page per cell (live preview, reference photos, notes,
bugs), Claude Code sessions on cells with an autopilot, and what they cost in tokens.

```sh
npx vite build      # the game the previews load (served at /game/)
npm run grid        # http://localhost:8030
```

Needs Node 22.5+ (built-in `node:sqlite`) and nothing else; screenshots use the repo's Playwright
(`npx playwright install chromium`). The orthophoto under the grid is `data/raw/ortho.jpg` (`node tools/fetch-data.mjs`).

## Settings

From the environment or `<GRID_DATA>/.env` (keep it `chmod 600`, never in git):

| Variable | Default | |
| --- | --- | --- |
| `PORT` | 8030 | |
| `GRID_DATA` | `~/vinko-grid-data` | SQLite file, uploaded screenshots, session logs, before/after shots; back it up |
| `GRID_CELL` | 100 | cell size in metres (changing it renames the cells) |
| `GRID_PASSWORD` | | HTTP Basic auth for every request when set (any user name); set it when public |
| `GRID_WORK` | | a second clone of this repo that sessions work in; without it the app runs without sessions |
| `GRID_BRANCH` | the work clone's branch | sessions branch off it and merge back into it |
| `CLAUDE_CODE_OAUTH_TOKEN` | | headless Claude Code on the owner's subscription (`claude setup-token`) |
| `MAPILLARY_TOKEN` | | optional, passed on to sessions |

## How a session runs

One at a time, as a server-side job (closing the browser doesn't stop it):

1. In the work clone: a fresh branch `cell/<cell>-<time>` off the base branch.
2. Screenshots of the published game: oblique, street level, straight down.
3. `claude -p` with the cell's prompt (bounds, contents, notes, open bugs, attached photos), streaming JSON into
   the session log; tokens are counted as they arrive.
4. Rebuild: `node tools/build-scene.mjs` when `tools/` or `data/` changed, `npx vite build`; commit.
5. Screenshots of the branch's build (served at `/preview/`).
6. Merge into the base branch (or wait for review, see settings), then the served checkout pulls it and rebuilds
   the game.

The autopilot repeats this: cells with bugs reported since their last session first, then outward from
Betlémské náměstí. It stops at the daily cap or at the set share of the weekly limit, and pauses for an hour when
Claude reports a usage limit.

Street View screenshots are optional reference for fine-tuning a cell; nothing depends on them. They stay in
`GRID_DATA`, never in the repo (Google's terms, see `CLAUDE.md`).

## Tokens and cost

Usage comes from each session's stream (and from any other Claude Code transcripts of this repo on the machine),
de-duplicated by message id, priced from the editable table on the settings page as an API-equivalent cost. The
weekly limit is estimated from the owner's calibration: the percentage Claude shows them against what the app
counted since the week began.

## On the Mac mini

`~/server/apps/vinkothegame/`: `live/` (served clone, runs the app), `work/` (sessions' clone), `data/` (GRID_DATA
with `.env`). launchd agent `com.kedlubna.vinko-grid` (`RunAtLoad`, `KeepAlive`), log `data/server.log`; public at
`mrizka.kedlubna.com` through the cloudflared tunnel. Update: `git -C live pull`, then
`launchctl kickstart -k gui/$(id -u)/com.kedlubna.vinko-grid`.
