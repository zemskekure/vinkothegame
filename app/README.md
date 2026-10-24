# Grid app

The control room for making the model true to reality one 100 m cell at a time (brief: `docs/grid-app.md`).

```sh
npx vite build      # the game the cell previews load (served at /game/)
npm run grid        # http://localhost:8030
```

Needs Node 22.5+ (built-in `node:sqlite`), no other dependencies. The orthophoto under the grid is
`data/raw/ortho.jpg` (`node tools/fetch-data.mjs`).

| Variable | Default | |
| --- | --- | --- |
| `PORT` | 8030 | |
| `GRID_DATA` | `~/vinko-grid-data` | SQLite file and uploaded screenshots; outside git, back it up |
| `GRID_CELL` | 100 | cell size in metres (changing it renames the cells) |
| `GRID_PASSWORD` | | HTTP Basic auth for every request when set |

Street View screenshots are optional reference for fine-tuning a cell; nothing depends on them. They stay in
`GRID_DATA`, never in the repo (Google's terms, see `CLAUDE.md`).
