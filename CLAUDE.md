# vinkothegame: project context

A walkable, stylised but faithful 3D model of Prague's Old Town around Betlémské náměstí (south to Národní,
Spálená and Žofín), played as a third-person game with a minimap. three.js r0.186 (`three/webgpu`, TSL node
materials, WebGL 2 fallback), Vite. All of it was built by Claude Code sessions; this file is what a new session
needs to know. The current task built on top of it, the grid app, is specified in `docs/grid-app.md`.

For the current tile work, read `docs/claude-code-next.md` after this file. It records the latest art direction,
the two proof tiles, exact commands, and open visual issues. Earlier suggestions in `docs/handoff.md` about
putting photo crops on facades have been superseded by the owner's drawn-style direction.

## Run

```sh
npm install
npm run dev            # http://localhost:5173 ; the built scene is committed in public/data/
npm run build && npx vite preview --port 4173   # production build
```

URL parameters (`src/main.js`): `?at=x,z,yaw` start on foot there (scene frame, see below; the camera looks along
(−sin yaw, −cos yaw)); `?overview` start in the view from above; `?view=x,y,z,tx,ty,tz` aim the overview camera
(camera position, target); `?webgl` force WebGL 2; `?signs` show the generic OSM shop name boards (off by
default: the art direction is real signs only); `?cars` show cars. Without `?at`, you start on Betlémské náměstí.

## Rebuilding the scene

The generated scene (`public/data/`, ~90 MB) is committed; the raw source data (`data/raw/`, ~130 MB) is not
(gitignored) and must be fetched before `tools/build-scene.mjs` can run:

```sh
NODE_USE_ENV_PROXY=1 node tools/fetch-data.mjs        # ČÚZK: RÚIAN buildings, ZABAGED, DMR 5G terrain, DMP 1G surface, orthophoto (no key)
node tools/fetch-osm.mjs                              # OpenStreetMap (no key)
MAPILLARY_TOKEN=… node tools/fetch-mapillary.mjs      # Mapillary image metadata (free token)
MAPILLARY_TOKEN=… node tools/facades.mjs && node tools/facade-params.mjs   # facade colours / window rhythm from photos
node tools/build-scene.mjs                            # → public/data/ (a few minutes)
```

`NODE_USE_ENV_PROXY=1` is only needed behind an HTTP proxy. `node tools/pack-artifact.mjs` packs a build into
`artifact/` for publishing as a single claude.ai artifact (not needed on a server).

## Coordinates

- Source data: S-JTSK / Krovak East North (EPSG:5514), metres. Play area `AREA` in `tools/area.mjs`:
  x −743720 … −742800, y −1044180 … −1043060 (920 × 1120 m).
- Scene ("local") frame: `x = X − ORIGIN.x`, `z = −(Y − ORIGIN.y)`, `ORIGIN = (−743087, −1043282)`; y up (metres,
  relative to `baseHeight`). **+x is east, +z is south** (north is −z, up on the minimap and the top view).
  Bounds x −633 … 287, z −222 … 898.
- `tools/geo.mjs` → `lonLatToSJTSK()` (async; returns `project( lon, lat ) → [ X, Y ]`).
- RÚIAN building code (`kod`, e.g. 21643792) identifies a house everywhere (houses.json, street facades).

## Pipeline map

Build time (`tools/`, Node):
- `build-scene.mjs`: the orchestrator. Terrain grid (1 m), buildings (RÚIAN footprints + OSM buildings RÚIAN
  lacks), walls split around openings, roofs (DSM-fitted; landmark overrides in `LANDMARKS`), surfaces, furniture,
  then `collectPlaces()`; writes `public/data/scene.json` + binary buffers.
- `streets.mjs`: carriageways, kerbs, pavements, furniture from OSM (benches/bins/bike stands kept off the road).
- `kerbs.mjs`, `quay.mjs` (Smetanovo nábřeží railing and Čapadlo terrace), `terraces.mjs` (Národní over
  Divadelní, the theatre piazzetta), `openings.mjs` (arcades/podloubí and passages through houses).
- `places.mjs` (`collectPlaces`): hand-modelled places, bridges, tram stops, people and traffic lines; calls
  `walls.mjs` (OSM garden walls with gates) and `dress.mjs` (Betlémské náměstí signs, clock, terrace, enamel
  house-number and street-name plates).
- `facades.mjs`, `facade-params.mjs`: measured facade colours / window rhythm from Mapillary photos.

Run time (`src/`, browser): `main.js` (renderer, sun, terrain, buildings, walk barriers, minimap), `walker.js`,
`shading/facade.js` (TSL facade shader: styles 0 default, 1 theatre, 2 Máj, 3 chapel, 4 glass blocks, 5 curtain
wall, 6 bronze), `places.js` (dispatches to `openings.js`, `stops.js`, `bridges.js`, `landmarks.js`,
`flights.js`, `venues.js`, `dress.js`), `decor.js` (awnings, lanterns, banners, embankment), `trams.js`,
`life.js`, `figures.js`, `furniture.js`, `kit.js` (shared materials/geometry helpers, `SUN`).

## How realism is added (the levers, cheapest first)

The step-by-step workflow used on Betlémské náměstí, to repeat for every grid cell: `docs/realism-workflow.md`.

1. `data/houses.json`, keyed by RÚIAN code: `colour`, `trim`, `floors`, `ground` (default/gate/blank/restaurant/
   shops/windows), `rustic` (none/banded/ornate), `grilles`, `graffiti`, `signs: false` (hide OSM name boards),
   `edges: { <edge index>: { awning, lanterns, banner: { text, board, ink } } }` (street-facing edges only), and a
   `note` saying what was seen and when ("(Street View 2024)"). Most per-house fixes are here.
2. Signs and fixtures on fronts: `tools/dress.mjs` → `src/dress.js` (kinds: board, letters, badge, lantern,
   flags, portal, canopy, clock; plates). Fronts are found by `frontFacing(point, facing-point)`, not edge indices.
3. Landmarks needing geometry: `LANDMARKS` in `build-scene.mjs` (OSM way id → style/roof), plus hand-built
   pieces in `src/landmarks.js` (Betlémská kaple front with the "Za pravdu" shadow ledges, piazzetta, Šítkov
   tower, bandstand) fed by data from `places.mjs`.
4. Walkability: zones (heights), barriers `[x0, z0, x1, z1, above]`, ceilings; see `places.mjs`.

After any change: `node tools/build-scene.mjs` (only if tools/ or data/ changed), `npm run build`, then look at
it (screenshots below). Check the console summary lines the build prints.

## Looking at the result

Headless Chromium via Playwright renders the game: `tools/screenshot.mjs <url> <out.png>` (its
`executablePath` is the Linux container's; on macOS remove it to use Playwright's own browser). Use
`?webgl&at=x,z,yaw` for street level, `?overview&view=…` from above. Waiting ~10 s after load is needed.

## Reference imagery and its rules

- Mapillary (CC BY-SA 4.0): may be stored, cropped and reused with attribution; `tools/look-at.mjs` fetches views
  of a point. Credited in the game.
- Google Street View: **reference to look at only**. Google's terms forbid storing, caching beyond use, tracing
  or reusing its imagery. Never commit Street View images (or screenshots of them) to this repo, never texture the
  model with them, never measure geometry off them. Read them, then describe what you saw in `houses.json` notes
  and code. The owner provides their own Street View screenshots for this; keep them outside git.
- Keys (`MAPILLARY_TOKEN`, a Google Maps key if used) live in environment variables or files outside the repo.
  Never commit a key.

## Conventions

- Code style: tabs, spaces inside parentheses and brackets (mrdoob style), comments as plain prose sentences
  explaining the real-world thing being modelled. Match surrounding code.
- Facts about real places come from data (RÚIAN, OSM, orthophoto) or photos, and the source is said in a comment
  or note. Don't invent shop names, signs or features that weren't seen.
- No model identifiers in commits or code.

## Known gaps / ideas (good first cells)

- Drivable vs pedestrian: use OSM `highway` + `access`/`motor_vehicle`, `area:highway` and the street-side
  parking polygons (`amenity=parking`, `parking=street_side`) to separate carriageway, parking and pedestrian
  surfaces; place parked cars only on parking polygons; draw pedestrian squares as one paved surface.
- U Halánků (Betlémské nám. 1): the curved gable with its painted medallion.
- Seasonal wooden market stalls in front of Betlémská kaple.
- The garden of the Náprstek museum (playground, trees) behind the new wall.
- Karoliny Světlé by the rotunda; Most Legií visuals.

## Improving a grid square

`npm run square -- prepare|merge x<i>_z<j>` (tools/square.mjs) runs the street-photo review for one 100 m square;
the reviewer instructions are in docs/review-brief.md and the whole workflow in docs/realism-workflow.md. Needs
`GMAPS_KEY` in the environment for Street View (never in the repo); photos go to `STREETVIEW_DIR`
(default ../vinko-streetview/), work files to `.square/` (gitignored).
