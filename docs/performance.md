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

## Files the game fetches at startup

Before `__ready`: `data/scene.json`, `data/walls.bin`, `data/walls-table.bin`, `data/roofs.bin`,
`data/roofs-table.bin`, `data/terrain.bin`, `data/surfaces.bin`, `data/pavement.bin`, `data/footprints.bin`,
`data/embankment.bin`, `data/ground-detail.jpg`, `data/ground-detail-wide.jpg`, the drawn fronts (bundled assets),
`models/vehicles/scooter.glb` (the walker's ride, in the background). After: `data/life.json`, the people
(`models/people/…`), `models/vehicles/tram-atlas.json` + `.png`, the boats.

## Scaling with the area

Nothing assumes the current bounds: the RTIN grid is the next 2^k + 1 above the area (up to 4096 m a side at 1 m
before it doubles; the build needs about 3 × 4 × n² bytes for it), the 200 m squares, fog culling and the zone grid
follow whatever is there. Rough cost per km² of city at today's density (first area and the rest averaged):

- download ~2.6 MB gzipped until playable (pavements ~0.5, street maps 0.4, walls ~0.4, roofs 0.25, terrain 0.25,
  ground detail 0.3), plus ~0.15 MB of `life.json`;
- JS heap ~30 MB (street maps 8 B/m², height grid 4 B/m², the pigeon's roof grid 16 B/m², footprints) on top of a
  ~150 MB base;
- GPU memory ~25 MB of vertex buffers; per frame, only what is within the fog (1 km on foot) is drawn, so frame cost
  grows with the density within a kilometre, not with the area.

## Measuring

```sh
npm run build
node tools/perf/serve.mjs dist 4182 &                       # gzip + ETag, as the grid app's server
node tools/perf/measure.mjs http://localhost:4182/ label all <shots dir>   # load (1.5 MB/s) + every view
node tools/perf/measure.mjs http://localhost:4182/ label narodni,holub     # some views
node tools/perf/shots.mjs http://localhost:4182/ <prefix> name=query …     # screenshots
node tools/perf/lab.mjs <url> experiments.json              # switch things off one by one, frame time each
node tools/perf/profile.mjs <url> 5                         # CPU profile, self time (FLY=x,z,heading flies)
node tools/perf/heap.mjs <url> 10                           # heap after GC, live memory by allocating function
node tools/perf/inventory.mjs <url>                         # meshes and triangles by origin
```

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
- Stream the city by square: today the whole area loads before play; per-square files nearest first would make the
  start square playable in ~3 s and keep the download per visit proportional to where one goes.
- Shadow redraws as the pigeon (the remaining 40 ms frames): split the map into cascades, or redraw it over several
  frames, or bake the city's shadows into the ground once a game hour.
- `renderer.compileAsync()` before `__ready`, so first sights of new materials don't hitch.
- Textured one-off meshes (signs, plates, boards: ~350 draw calls on Betlémské náměstí) into a few atlases.
