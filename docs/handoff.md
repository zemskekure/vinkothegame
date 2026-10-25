# Handover: make the Old Town recognisable, tile by tile

Written for the next agent working on this repo. Read `CLAUDE.md` first (run, coordinates, pipeline map, data
rules); this file says what the owner wants, where things stand, and what went wrong so far.

**Current continuation:** Read `docs/claude-code-next.md` for the updated implementation status and art direction.
This handover records the original plan; its suggestions to use photographic facade crops are superseded by the
owner's request for a consistent drawn look.

## What the owner wants

A walkable model of Prague's Old Town (Betlémská čtvrť to Národní and the National Theatre) where **a player who
knows the place recognises it**. It doesn't need to be photorealistic; it needs to feel right:

1. **The urban layout must be right.** No streets, passages or arcades that don't exist, none missing, the right
   levels and steps. One wrong arcade breaks the illusion more than ten plain facades.
2. **The atmosphere comes from the ground floor**: the real shopfronts, signs, ATMs, doors, window frames, and
   the colours and materials of the facades. Generic text boards and generic shop windows read as fake. Low-res
   real-looking textures or signature pieces are better than clean generic ones.
3. **Landmarks people navigate by**: e.g. the MÁJ lettering and David Černý's butterfly on Máj, the domed tower
   of Národní 24, sv. Martin ve zdi, the piazzetta and Nová scéna.
4. **A pipeline that does this for every 100 m tile** (`x<i>_z<j>`, i −7…2, j −3…8, 120 tiles), unattended,
   with the owner approving one PR per tile. Hand-crafting tiles doesn't scale.
5. **Proof first:** two tiles done by the pipeline, convincing enough to commit to the whole map.

## Where things stand

Branches (GitHub `zemskekure/vinkothegame`):
- `main`: the game plus the square pipeline (`tools/square.mjs`, `docs/review-brief.md`).
- `app`: the grid dashboard (`app/`, see `app/README.md`), live at mrizka.kedlubna.com on the owner's Mac mini.
- `look/x0_z2`: this session's work, not merged. On top of main it has:
  - **Described ground floors**: `data/houses.json` → `edges.<i>.ground`, a list of openings left to right
    (`door`, `gate`, `shop`, `window`, `garage`, `niche`, `blank`) with `frame`, `arch`, `bars`, `glazed`,
    `door`, `size`. Laid out in `tools/build-scene.mjs` (`layoutGroundFloor`), drawn by `src/shading/facade.js`
    from a small half-float texture.
  - `edges.<i>.balconies` (`floor`, `from`, `to`, `depth`) → `src/decor.js`. House `style` (`curtain`,
    `gothic`, `bronze`…), `roof: "flat"`, `rustic: "clad" | "rubble"`.
  - `data/icons.json` + `src/icons.js`: one-off landmarks (big letters, the butterfly, a domed tower, a church
    tower).
  - `data/footprint-fixes.json`: hand corrections of OSM outlines that are off the aerial photo.
  - Street surfaces: cobbled crossings, setts laid in arcs, mosaic on pavement corners.
  - Piazzetta: the open undercroft under Nová scéna with steps from Národní, walk-throughs to the square.
  - Descriptions for tiles x0_z1, x0_z2, x1_z2, x0_z3, x-4_z1 (written by hand from photos).
- `cell/x0_z1-…`, `cell/x-4_z1-…`: PRs #2 and #3 from the first pipeline runs (colours and text signs only).

The pipeline today (`app/square.mjs` on the mini): fetch Street View for the tile's fronts → `claude -p` reads
the photos and writes `review.json` per `docs/review-brief.md` → merge into `houses.json` / `signs.json` →
rebuild → screenshots → PR. It **does not yet know the new fields above**, and it only produces colours, floor
counts and text-board signs. That's why its tiles look generic.

## Inputs available

- **Street View Static API** (key on the mini in `~/vinko-grid-data/.env`, `GMAPS_KEY`; daily quota capped).
  About $0.007 per image.
- **The owner's Street View screenshots** (~200), sorted per tile on the mini in
  `~/vinko-grid-data/streetview/<tile>/vlastni-*.jpg`, with position and heading in the file name when the
  URL was visible. Reference only, like all Street View imagery (see the rules below).
- **The owner's own photos**: `~/Documents/HOLUB/photos-export/` on the owner's MacBook, sorted per tile, with
  `manifest.json` (555 entries: position, heading, date, `keep`, `what`, `textureCandidate`). These are the
  owner's: they **may be cropped and used as textures**. 42 are marked as texture candidates.
- **Mapillary** (CC BY-SA, may be used as textures with attribution), ČÚZK aerial photo and surface model,
  OSM, RÚIAN (see `CLAUDE.md`).
- **Anthropic API credit** for headless review runs (about $67 left of the $70 the owner set aside); about
  $1–1.5 per tile per review run so far.

## Rules (from the owner and `CLAUDE.md`)

- Street View images are reference only: never commit them, never use them as textures, never measure geometry
  off them. Describing what you see, or drawing your own picture of a shopfront from looking at it, is fine.
- Never commit or log keys. Don't push to `main`; one PR per tile. No model names in commits.
- Facts about real places come from data or photos, with the source in a note. Don't invent shops or features.

## Known problems the owner found (not fixed)

- Husova: a podloubí (arcade) in the model where there is none.
- Na Perštýně: a street "around the corner" that doesn't exist (check the U Modrého kola outline fix in
  `data/footprint-fixes.json` and OSM building outlines there).
- Around sv. Martin ve zdi: the open space looks wrong.
- Platýz (Martinská / Národní): the arcade and passages are buggy.
- The piazzetta was rebuilt last; the owner hasn't seen the final version yet.
- Signs are generic text boards; shopfronts are generic.

## What went wrong so far (lessons)

- **Fixing tiles by hand doesn't converge.** Each fix took long and often broke something nearby.
- **Guessing geometry from data heuristics made new errors.** Treating every OSM footway inside a house as a
  passage cut fake passages (reverted). Placing steps by "edges that are lower" put them in the wrong place.
  Check every geometric change against a photo of that exact spot.
- **Screenshots from the model must be compared with photos from the same spot**, side by side, before calling
  anything done. Also walk the figure through every passage and arcade (a script that holds W and checks
  where it gets stuck caught most problems).
- **Text boards are not signs.** The owner wants the real look: colours, lettering style, logos, frames.

## Suggested approach (not built yet)

1. **Drawn shopfronts.** For each street front, the reviewer draws an SVG of the ground floor from the photos
   (viewBox in cm, width = front length, height = ground floor): the real windows, doors, frames, colours,
   fascia lettering in the right style, simplified logos, ATMs, plaques. Stored as `data/fronts/<code>_<edge>.svg`,
   named in `houses.json` (`edges.<i>.shopfront`), laid over the front as a texture slightly in front of the wall,
   with real passages left open. Where the owner has a straight-on photo of his own, a crop of it can be the
   texture instead. Projecting signs stay 3D (`data/signs.json`).
2. **Review brief v2** that writes all the new fields (ground floors, balconies, style, roof, shopfront SVGs) and
   a list of layout problems per tile. Layout problems are reported, not auto-fixed, until checked.
3. **Checks in the pipeline**: schema validation, a walk test through every passage/arcade in the tile, and
   model-vs-photo screenshot pairs from the photo positions, shown in the dashboard per tile.
4. **A second pass** that compares those pairs and corrects the description once.
5. Prove it on two photo-rich tiles, e.g. `x-1_z3` (Národní) and `x-4_z2` (Divadelní / Smetanovo nábřeží),
   then queue the rest.

## Running it

```sh
git checkout look/x0_z2
npm install && npx playwright install chromium
node tools/fetch-data.mjs && node tools/fetch-osm.mjs   # raw data, not in git
node tools/build-scene.mjs && npm run build && npx vite preview --port 4317
# street level: http://localhost:4317/?at=x,z,yaw   (V = first person)
# from above:   http://localhost:4317/?overview&view=camX,camY,camZ,targetX,targetY,targetZ
```

Screenshots: `tools/screenshot.mjs <url> <out.png>`; add `?webgl` in headless Chromium. Tile pipeline:
`npm run square -- prepare <tile>` then `merge` (see `docs/review-brief.md`, `app/README.md`).
