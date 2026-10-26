# Performance: load and frame budgets

The game was built like a survey model (every metre of ground, every roof sample, every hand-made sign its own draw
call); this is how it is now built like a late-90s game, what it costs, and how to measure it. Work of branch
`perf/ps1` (October 2026).

## Before / after

Measured on the owner's MacBook Pro (M-series), Chrome with WebGPU (headless, `tools/perf/measure.mjs`), the build
served gzipped with ETags like the grid app's server (`tools/perf/serve.mjs`). Load with the network throttled to the
Cloudflare tunnel's ~1.5 MB/s. Frame times with the frame cap lifted (`?fps=1000`): how long a frame takes, i.e. the
headroom under the game's cap of 60 (30 as the pigeon). Draw calls and triangles per frame.

| | before | after |
|---|---|---|
| transferred, first visit | 52.3 MB | 8.6 MB until playable, 15.1 MB with people, trams, boats |
| ready (playable) at 1.5 MB/s | 44.6 s | 8.2 s (people, trams, boats in by 12.7 s) |
| repeat visit (ETag) | 18.7 s, 10.2 MB (terrain.bin too big for the cache) | 2.4 s, 0.04 MB |
| JS heap after garbage collection | ~590 MB on foot | ~250 MB on foot, ~310 MB as the pigeon |
| triangles per frame | 14.2 M everywhere (shadow map redrawn every frame) | 1.1–1.7 M |

| view (`tools/perf/measure.mjs`) | before avg / p95 ms | after avg / p95 ms | draw calls before → after | triangles before → after |
|---|---|---|---|---|
| start (Betlémské náměstí, west end) | 16.4 / 50.8 | 2.1 / 2.8 | 1192 → 254 | 14.2 M → 1.1 M |
| Národní, trams | 17.7 / 54.6 | 2.4 / 2.8 | 1553 → 441 | 14.2 M → 1.3 M |
| Betlémské náměstí, looking west | 16.8 / 22.7 | 3.8 / 4.3 | 1812 → 738 | 14.3 M → 1.7 M |
| Malá Strana from above | 18.8 / 179 | 2.5 / 4.0 | 304 → 309 | 14.1 M → 1.4 M |
| overview | 20.6 / 53.4 | 3.9 / 5.3 | 1771 → 646 | 14.2 M → 1.5 M |
| pigeon, on the nest | 21.3 / 26.8 | 6.0 / 9.7 | 2078 → 786 | 14.4 M → 1.6 M |
| pigeon flying over the river | 21.5 / 28.2 | 6.2 / 10.3 | 2075 → 786 | 14.4 M → 1.6 M |

Frames over 20 ms: before 6–27 %, after under 1.5 % (one-off pipeline compiles when something first comes into
view, and the pigeon's shadow redraws). No `Render pipeline creation failed` in any view, WebGPU or `?webgl`.
Screenshots before/after are kept outside the repo (the session's scratchpad `perf/shot-before-*.png`,
`shot-after-*.png`).

Download after (gzipped, as the server sends it): pavement 1.6 MB, street maps 1.3, walls 1.1 + 0.3 table, roofs 0.8,
terrain 0.8, aerial ground detail 1.0, scene.json 0.35, footprints + embankment 0.4, JS 0.4, drawn fronts ~0.4; after
the city is up: life.json 0.5, people ~4.5 (twelve modular bodies ~0.28 each, the rest small), the steamer 0.5, tram
atlas 0.2.

## What changed

**The look.** The console picture (`src/holub/ps1.js`: 300 lines, colour levels, dither, grain, contrast, saturation,
exposure from `public/game-settings.json` `look`) is the whole game's now: on foot, on the scooter, from above and as
the pigeon. `?hd` gives the plain full-resolution picture; `tools/screenshot.mjs` and `tools/square-proof.mjs` ask for
it, so the tile proofs look as before. On foot the haze is the pigeon game's (thick at 1 km, × `look.fog`); from above
it stays at 1.6 km. People are faceted with cut colours everywhere (except under `?hd`), trees are 20-sided blobs.

**Shadows.** three's WebGPU renderer reads the light's own `shadow.autoUpdate` / `shadow.needsUpdate`, not the
renderer's: the old "every third frame" never worked and the whole city went through the shadow pass every frame.
Now the map is drawn when the shadowed square (400 m on foot and as the pigeon, 900 m from above, following in 50 m
steps) moves or when the pigeon's sun has turned half a degree; whatever is added after the still city (people, trams,
boats, the walker, the pigeon, food) casts no shadow.

**Draw calls** (`src/batch.js`). The still city's small meshes are merged per material and 150 m square; plain
colour materials (no textures, no shader nodes) are merged across colours, the colour moved into the vertices. The
terrain, pavements, walls and roofs are cut into 200 m squares sharing one vertex buffer. Each frame every still mesh
whose sphere lies past the fog's far end is hidden. Trees are batched per 300 m square. Instanced people (walkers far
off, everyone seated or standing) take the first places in their batches only when in view and nearer than the haze
(`src/life.js`); a batch built for many people keeps drawing at least two (three's morph node needs that).

**The data** (`tools/build-scene.mjs` → `tools/pack.mjs` → `src/unpack.js`). Integer columns: millimetres (heights in
centimetres), walked in order and stored as differences, folded to small unsigned numbers, as few bytes a value as the
column needs, bytes stored by significance, so the server's gzip finds long runs.

- Terrain (`terrain.bin`): a right-triangulated irregular network of the 1 m grid (`tools/rtin.mjs`), within 5 cm over
  the first area and 10 cm beyond, every grid point near the retaining walls (the client still snaps those): 244 k
  triangles instead of 6.6 M. Its corners carry their heights; the client fills the 1 m height grid (walking, people,
  trams) back in from the triangles, so the ground one walks on is the ground one sees.
- Pavements (`pavement.bin`): on the 1 m grid (was 0.5 m over the first area), flat stretches meshed the same way and
  allowed to run unseen under the houses (not under arcades or passages); the kerb faces follow the kerb lines,
  chained and straightened to 4 cm; the road strips beside the kerbs (the terrain drawn twice) are gone, the faces go
  20 cm into the road instead.
- Walls (`walls.bin` + `walls-table.bin`): a quad is its two bottom corners, two heights a side and u; the 20 values
  that are the same for a stretch of wall in a table. Unpacked into the same 24-float layout, so the facade shader is
  unchanged.
- Roofs (`roofs.bin` + `roofs-table.bin`): every second roof sample each way in the mesh (the heights are still
  measured from all), the eaves every 4 m (6 m beyond the first area); kind, seed and colour in a table.
- Street maps (`surfaces.bin`): both RGBA maps, each channel on its own as the change from the texel to the left.
- Aerial ground detail: 50 cm over the first area, 1 m over the whole (was 25 / 50 cm).
- Drawn fronts: WebP at 3 cm a pixel (was PNG at 1 cm), loaded at once instead of one after another.
- `life.json`: walking lines, lanes, parked cars and tram routes, out of `scene.json`.

**Loading order.** The city first (`window.__ready`); then `life.json`, the people, trams and boats
(`window.__complete`). The downloads are released once unpacked, and the big meshes' vertex arrays once the GPU has
them (an empty array of the same kind stays for the layout three reads when it builds a pipeline).

**CPU.** Walk zones (404 of them, asked by every person, tram and step) are found in an 8 m grid instead of a scan.

## The owner's textures (branch `look/textures`, October 2026)

Cars, boats, street furniture, trees, graffiti and the sky made from the owner's pictures (`docs/game.md` section 5,
`tools/textures/`). Measured against `integrate/all` the same way (`measure.mjs`, views only; cars on by default in
both):

| view | before avg / p95 / max ms | after avg / p95 / max ms | draw calls | triangles |
|---|---|---|---|---|
| Národní | 4.3 / 6.0 / 59.9 | 3.8 / 5.1 / 10.3 | 430 → 465 | 3.4 M → 1.4 M |
| Betlémské náměstí | 5.6 / 9.0 / 30.5 | 5.7 / 7.3 / 13.4 | 747 → 787 | 3.8 M → 1.8 M |
| pigeon on the nest | 5.6 / 6.9 / 76.2 | 4.5 / 6.1 / 13.2 | 339 → 374 | 3.2 M → 1.2 M |
| pigeon over the river | 4.5 / 7.1 / 34.6 | 4.6 / 6.6 / 19.1 | 316 → 335 | 3.4 M → 1.3 M |

The triangles halve because the ~2400 parked cars were all drawn every frame as downloaded models; now they are
~150-triangle picture cars and only those in view and nearer than the haze are drawn. The extra draw calls are the
graffiti (one per 150 m square), the sky dome and the atlases' materials. Download: +0.63 MB of atlases (cars 0.13,
boats 0.16, graffiti 0.15, trees 0.08, sky 0.08, furniture 0.04), −0.98 MB of car and boat models no longer fetched:
0.35 MB less in all. No `Render pipeline creation failed`.

## Streaming by square (branch `map/prague1`, October 2026)

Prague 1 is 3.8 × 2.35 km (9 km², 1.8 × the Old Town extension). Loaded whole as before it would have been
~25 MB to download and ~600 MB of heap before play; now the city comes by square.

**Build time.** `tools/build-scene.mjs` writes the whole scene to `data/scene/` (gitignored: the same packed files
as before, plus which house each wall quad and roof corner belongs to) and then runs `tools/tiles.mjs`, which cuts
it into 256 m squares from the area's north-west corner (15 × 10 = 150): `public/data/tiles/<i>_<j>.bin`, one file
a square with all its layers ('VT01', a JSON header, 4-byte aligned sections):

| section | what | gzipped, all 150 |
|---|---|---|
| terrain | the ground's corners on the square's 1 m grid (257²), heights in cm, triangles (drawn first, then the ones left out at retaining walls, which only fill the walking heights), normals (2 × int8, worked out on the whole mesh, so no seams), the corners moved onto the walls | 2.6 MB |
| pavement | corners (mm from the square's corner), triangles, normals (3 × int8, whole mesh) | 5.7 MB |
| walls + wallTable | the houses whose middle is in the square, as `walls.bin` was, with a table of their own | 2.8 MB |
| roofs + roofTable | the same for the roofs | 2.0 MB |
| surfaces | the two street maps over the square, 1 m, 8 channels as the change from the texel to the left | 3.6 MB |
| detail | the aerial ground detail over the square, 1 m, a grey JPEG | 1.4 MB |
| footprints | the house mask, 0.5 m, a bit a cell | 0.4 MB |
| embankment | the river wall's stones (mm) | 0.2 MB |
| header | street furniture and trees (each tree with its number in the whole city, which turns its crown), garden and retaining walls, the river railing's pillars, posts and rails | 0.5 MB |

A square is 130 KB gzipped on average (largest 285 KB, Na Příkopě); 19.5 MB in all. The ground and pavement meshes
are triangulated so that no triangle crosses a square's edge (`tools/rtin.mjs` `maxSize`), so the squares meet
without cracks. Global, in `public/data/`: `scene.json`, the index (bounds, the list of squares, the hand-made
places, zones, barriers, retaining-wall lines, streets, signs, decor, ground-floor rows: 0.5 MB gzipped),
`map.png` (the minimap and big map, 1 px a metre, paletted, drawn at build time with the bridges: 0.4 MB),
`heights.bin` (the ground every 8 m, Int16 cm: 0.2 MB), `ground-detail.jpg` (the first area at 50 cm, 0.47 MB),
`life.json` (2.2 MB, after play begins).

**Run time** (`src/stream.js`, `src/tile-worker.js`, `src/main.js`):

- The index, the map and the coarse heights first; then the squares within **600 m** of where one starts, nearest
  first, four downloads at a time (`priority: 'high'` within 400 m, `'low'` beyond); play begins once they are in.
  The ring is 600 m, not the 1 km first planned: on foot the haze is thick from 1 km, and the 1 km ring round
  Betlémské náměstí alone is 62 squares, 10 MB, ~7 s at 1.5 MB/s before anything else. The rest within **1.5 km**
  of where one is (and of where one will be in 4 s, by the current speed) streams in during the first seconds of
  play; squares beyond **1.75 km** are let go (meshes and their GPU buffers disposed, the walking data dropped).
- Two workers fetch and unpack (the meshes' arrays, normals, plaster colours, the street fronts for the graffiti,
  the walking heights grid, the grey detail decoded through an OffscreenCanvas) and hand the arrays over. The main
  thread puts one square in a frame: its ground, pavements, houses and roofs as four meshes sharing the city's four
  materials, and its street maps and detail copied (`copyTextureToTexture`) into three city-wide GPU textures
  (3806 × 2352, 81 MB of GPU memory, nothing of them in the heap); 2–4 ms. Its furniture (one mesh per material),
  garden walls, graffiti (one mesh), river railing and the trams' overhead line follow as chores, 3 ms a frame.
  A square's buffers and pipelines are prepared in the background (`compileAsync` of its group), so its first
  sight costs nothing, and its arrays go once on the GPU (WebGPU; under WebGL 2 they stay).
- Walking, the ground's height, the kerbs, the scooter's roughness and the house mask are answered from the squares
  that are in. Where a square isn't: the walker is blocked at its edge (`isBlocked`) and holds still if standing on
  it (`groundHeight( …, strict )` is NaN, the walker keeps its height); trams, cars and people take the coarse 8 m
  grid. The big map's teleport and coming down from the view from above wait for the target's squares
  (`stream.whenLoaded`, which pulls them first; a second or two), then place one. The pigeon's roof grid (0.5 m)
  is worked out in a worker for the squares within 350 m and dropped beyond 600 m. The overhead line is planned
  once for the whole network and built per square, with the square's ground and houses.
- Each square is shown only within the haze (its distance to the camera); the shadows are redrawn for squares
  coming in near at most every 2 s (the pigeon's shadowed square moves in 100 m steps).
- The hand-made places (Karlův most, the landmarks, the Old Town's, the theatre, the signs…) stay whole: built at
  start, batched per 150 m, shown within the haze as before. They have hundreds of shaders of their own, so they
  compile in rings round the start: before play those within 250 m, then 600 m, 1.2 km and the rest in the
  background; a piece whose ring isn't done is hidden rather than stalling a frame. Under `?hd` (the model's
  screenshots, `tools/screenshot.mjs`, `square-proof.mjs`, the grid app) play waits for every square within 1.5 km
  and every shader.

**Before / after** (same MacBook, same day, busy with other work: load average 5–9, so absolute times are slow; the
server throttled to one 1.5 MB/s pipe with 40 ms latency, `RATE=1.5e6 node tools/perf/serve.mjs`, which also slows
the workers' downloads; heap after a forced GC, `usedJSHeapSize` before it in brackets):

| | before: Old Town extension, 5 km², loaded whole | after: Prague 1, 9 km², by square |
|---|---|---|
| ready from Betlémské náměstí (cold) | 22.6 s, 13.5 MB | 16.7 s, 8.4 MB (26 squares) |
| ready at Hradčanské náměstí (cold) | — | 10.2 s, 7.3 MB |
| ready at Hlavní nádraží (cold) | — | 10.4 s, 7.6 MB |
| repeat visit (ETag), Betlémské náměstí | 14.8 s | 12.9 s (5.7–6.1 s at the other two) |
| downloaded by the time people and trams are in | 19.3 MB | 20–27 MB (the squares within 1.5 km keep coming) |
| JS heap after GC, once all is in | 337 MB (464) | 229–268 MB (445–544) |

Betlémské náměstí is the slow start because its 250 m ring holds most of the hand-made places' shaders (the
compile is about half of those 16.7 s on this machine; the download of the 8.4 MB about 6 s).

Frame times (`?fps=1000`, unthrottled server, 1440 × 900):

| view | before avg / p95 ms, draw calls, triangles | after avg / p95 ms, draw calls, triangles |
|---|---|---|
| start (Betlémské náměstí, west end) | 4.5 / 8.0, 415, 1.94 M | 5.4 / 6.9, 522, 1.17 M |
| Národní, trams | 5.4 / 7.6, 602, 2.09 M | 5.8 / 7.0, 679, 1.28 M |
| Betlémské náměstí, looking west | 6.4 / 9.3, 833, 2.26 M | 7.0 / 8.1, 990, 1.55 M |
| overview | 7.6 / 20.9, 998, 2.48 M | 8.9 / 10.0, 1440, 2.41 M |
| pigeon on the nest | 6.4 / 8.5, 609, 1.96 M | 5.5 / 6.1, 565, 1.17 M |
| pigeon over the river | 5.0 / 6.8, 340, 1.77 M | 4.8 / 5.3, 381, 0.93 M |
| Karlův most | 3.6 / 5.5, 288, 1.92 M | 4.2 / 5.2, 445, 1.07 M |
| Hradčanské náměstí (new) | — | 5.3 / 7.8, 599, 1.33 M |
| Václavské náměstí (new) | — | 2.8 / 3.8, 277, 0.75 M |
| Na Příkopě (new) | — | 4.2 / 4.9, 446, 1.01 M |
| the Castle from above (new) | — | 3.4 / 4.1, 294, 0.95 M |

No `Render pipeline creation failed` in any view, WebGPU or `?webgl`. Triangles fall (only the squares within the
haze are drawn, the furniture merged); draw calls rise by a quarter where many squares are in view (each square
has its own ground, pavement, walls, roofs, furniture by material, graffiti, overhead line).

A fast pigeon flight across the whole map (`tools/perf/flight.mjs`, Strahov to the east edge at ~42 m/s, four
times the pigeon's cruise, 95 s): 99 squares came in, put in 2.4 ms on average (10.5 at most); frames avg 6.1 ms, p95 11.5, p99 19.8; 0.9 % over
20 ms, 13 over 50 ms: the shadow redraws and the first shadow pass of hand-made pieces, not the squares.

Per km² of city now: ~2.2 MB of squares gzipped (fetched when one comes within 1.5 km), ~0.45 MB of JS heap per
square while it is in (the 1 m walking heights 264 KB, kerb and roughness bytes 128 KB, house mask 32 KB), ~9 MB of
GPU memory for the city-wide textures. The heap no longer grows with the map: what is in is what lies within
1.75 km, at most ~110 squares however big the city.

What's rough:

- The squares in the ring between 600 m and 1 km come in during the first seconds of play; on a slow line one can
  see houses appear in the haze at the far end of a long street in that time.
- The hand-made places still load and build whole (0.5 MB of index, ~1.5 s of building, hundreds of shaders): they
  are fixed cost, not per km², but they are the biggest share of the time to play now. Moving them into the squares
  (their pieces are positioned already) and giving their materials shared shaders (colours as attributes) would
  cut both.
- The pigeon's shadow redraws when its 400 m shadowed square moves: 50–80 ms frames every few seconds at speed
  (13 frames over 50 ms in the 95 s fast flight), and the first time a hand-made piece is drawn into the shadow map
  its shadow shader is built. Cascades or a baked shadow would fix it.
- The pavement index is the biggest single part of a square (2.4 MB of the 5.7); an index codec (meshopt's) would
  roughly halve it.
- GPU memory for the city-wide textures grows with the map (81 MB for 9 km²); a larger map would want them as a
  ring of textures wrapping round the player (the copies already go by square).
- Under WebGL 2 the squares keep their arrays in the heap (dropping them lost the buffers there).
- Git: each rebuild touches only the squares whose content changed (the build is deterministic), so a tile
  review on the grid app adds a few squares' worth (~100 KB–1 MB) to the history rather than the whole 120 MB.
  If it gets heavy anyway: stop committing `public/data/` and build it on deploy (the grid app's server can run
  `tools/build-scene.mjs` on the mini, 6 min), or keep it in git LFS.

## Files the game fetches at startup

Before `__ready`: `data/scene.json`, `data/heights.bin`, `data/map.png`, `data/ground-detail.jpg`, the squares
within 600 m (`data/tiles/<i>_<j>.bin`, by the workers), the drawn fronts (bundled assets), the player's model,
`models/vehicles/scooter.glb`; `textures/graffiti-atlas.json` + `.png`, `textures/furniture-atlas.png`,
`textures/tree-atlas.png`, `textures/sky/*.jpg`. After: the rest of the squares within 1.5 km, `data/life.json`, the
people (`models/people/…`), `models/vehicles/tram-atlas.json` + `.png`, `car-atlas.json` + `.png`,
`boat-atlas.json` + `.png`.

## Scaling with the area

The squares, the stream's radii, fog culling and the zone grid follow whatever is there; `tools/area.mjs` `TILE`
sets the square's size. The build's RTIN grid is the next 2^k + 1 above the area (4097 for Prague 1; the next
step, 8193, would need ~0.8 GB more for it). What still grows with the map: `scene.json` (the hand-made places,
zones, barriers, streets: 0.5 MB gzipped for Prague 1), `map.png` and `heights.bin` (0.6 MB), `life.json` (2.2 MB,
the people's lines, lanes, parked cars and tram routes over the whole area), and the city-wide GPU textures.

## Measuring

```sh
npm run build
node tools/perf/serve.mjs dist 4182 &                       # gzip + ETag, as the grid app's server
RATE=1.5e6 node tools/perf/serve.mjs dist 4183 &            # the same through one 1.5 MB/s pipe (workers too)
SERVER_RATE=1 node tools/perf/measure.mjs http://localhost:4183/ label load   # load from Betlémské náměstí
AT=-1503,-742,-1.9 SERVER_RATE=1 node tools/perf/measure.mjs http://localhost:4183/ label load   # from elsewhere
node tools/perf/measure.mjs http://localhost:4182/ label all <shots dir>   # load (1.5 MB/s) + every view
node tools/perf/measure.mjs http://localhost:4182/ label narodni,holub     # some views
node tools/perf/shots.mjs http://localhost:4182/ <prefix> name=query …     # screenshots
node tools/perf/lab.mjs <url> experiments.json              # switch things off one by one, frame time each
node tools/perf/profile.mjs <url> 5                         # CPU profile, self time (FLY=x,z,heading flies)
node tools/perf/heap.mjs <url> 10                           # heap after GC, live memory by allocating function
node tools/perf/inventory.mjs <url>                         # meshes and triangles by origin
node tools/perf/flight.mjs <url> out.json 95 30 -1950 -300 1.571   # the pigeon across the map at 30 m/s cruise
```

The bare URL stops at the start screen: the load test starts with `?at` (Betlémské náměstí, or `AT=x,z,yaw`).
`?ready=…&load=…` (metres) try other rings; `window.__debug.stream.stats()` tells what is in.

All run Google Chrome headless with WebGPU (`tools/perf/browser.mjs`). Headless animation frames don't tick at a
display's rate, so measure with the cap lifted (`?fps=1000`); `window.__debug.setFps( n )` changes the cap live.

## For the server (`app/server.mjs`, branch look/x0_z2)

Revalidation with ETags works and is now near-instant (0.04 MB). Two cheap improvements, if wanted: gzip level 9 for
`.bin` and `.json` once per file version (they are cached in memory already), and `cache-control: public,
max-age=31536000, immutable` for `assets/*` (Vite gives them content names when `vite.config.js` drops its fixed
`assets/[name]` file names) — `tools/perf/serve.mjs` shows the header logic. The data files keep `no-cache` + ETag.

## Next

- People's models: ~4.5 MB of the 15. The modular bodies carry the modelled heads the game replaces with block
  heads, and the Run and Wave clips it never plays; rewriting them without those (gltf-transform: prune, re-encode
  with meshopt) and dropping vertices to a PS1 budget (~1 k triangles) would roughly halve it and the people's vertex
  cost (still the biggest share of the triangles in busy views).
- Shadow redraws as the pigeon (the remaining 40 ms frames): split the map into cascades, or redraw it over several
  frames, or bake the city's shadows into the ground once a game hour.
- Textured one-off meshes (signs, plates, boards: ~350 draw calls on Betlémské náměstí) into a few atlases.
