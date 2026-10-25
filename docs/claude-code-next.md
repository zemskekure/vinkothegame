# Claude Code continuation: drawn, recognisable Prague tiles

Read `CLAUDE.md`, `docs/handoff.md`, `docs/review-brief.md`, and this file before changing a tile. This file
records the latest owner feedback and the current local work. The working branch is `look/x0_z2` in
`/Users/jancervenka/Documents/ChatGPT/PRAGA/vinkothegame`.

## The owner's direction

- Make each street feel like the real Prague location while retaining the game's restrained painted look.
- Use fetched Google Street View as the **primary visual reference**. The owner's own photos are supplementary
  references for details or ambiguous views. Never use Street View pixels as a texture or commit its images.
- Ground floors carry recognition: reproduce real door and window rhythm, distinctive frames, awnings, portals,
  logos and the actual sign shape and placement. A generic shop name board does not count.
- Draw those details in original, simplified SVGs. Match the adjacent procedural facade's palette and visual
  weight. The owner rejected a sharp photographic blue-portal patch because it broke the game's style. Keep raw
  photo patches out of these tiles and future pipeline output.
- Preserve real street geometry and walkable passages. Report uncertain geometry in `layoutIssues` with evidence;
  change it only after checking the authoritative map and the exact camera view.
- Show same-camera Street View/model pairs and the passage walk result before calling a tile complete. Put any
  prominent remaining mismatch in `visualIssues`; the unattended app stops before a PR while that list is nonempty.

## What is implemented

The pipeline on `look/x0_z2` prepares a 100 m square, fetches Street View views, inventories fronts and optional
owner photos, validates a review plus SVGs, merges house/front data, rebuilds the scene, renders paired proof,
checks mapped passages in both directions, and runs one correction pass. `app/square.mjs` drives unattended
sessions; `tools/square.mjs`, `tools/square-schema.mjs`, `tools/build-scene.mjs`, `tools/render-fronts.mjs`,
`tools/square-proof.mjs`, and `src/fronts.js` implement the local path. The grid dashboard is in `app/`.

The two local proof branches are `codex/tile-x-1-z3` at
`/Users/jancervenka/Documents/ChatGPT/PRAGA/vinko-tile-x-1-z3` and `codex/tile-x-4-z2` at
`/Users/jancervenka/Documents/ChatGPT/PRAGA/vinko-tile-x-4-z2`. They are regenerated from the current
`look/x0_z2` pipeline base. Work inventories and reference images remain outside Git under
`/Users/jancervenka/Documents/ChatGPT/PRAGA/vinkothegame/.square/<tile>/` and
`/Users/jancervenka/Documents/ChatGPT/PRAGA/vinko-streetview/`. Owner photos are under
`/Users/jancervenka/Documents/HOLUB/photos-export/`. Local branches have symlinks to the main checkout's
`node_modules` and ignored `data/raw`.

Tile `x-1_z3` has drawn KAMERA (`21651248_6.svg`) and the navy and gold Dům U dvou zlatých lvů portal
(`21651256_2.svg`). Tile `x-4_z2` has drawn Hollar (`21649553_4.svg`), DEELIVE (`21644471_0.svg`), and
Academy (`21649651_36.svg`). Keep these drawings stylistically coherent with the rest of the street.

## Continue a tile

Set `TILE` and `TILE_CHECKOUT` for the square you are editing. Run these from that checkout. No key is needed to
reuse the already prepared inventories and views. For a new tile, set `GMAPS_KEY` from a local secret outside Git
before `prepare`; never print or commit it.

```sh
export TILE=x-1_z3
export TILE_CHECKOUT=/Users/jancervenka/Documents/ChatGPT/PRAGA/vinko-tile-x-1-z3
export SQUARE_WORK=/Users/jancervenka/Documents/ChatGPT/PRAGA/vinkothegame/.square/$TILE
cd "$TILE_CHECKOUT"

# Inspect inventory.json, review.json and its referenced Street View views.
# Draw or correct SVGs in "$SQUARE_WORK/fronts/" and update review.json.
node tools/square.mjs merge "$TILE"
node tools/build-scene.mjs
npm run build
npx vite preview --host 127.0.0.1 --port 4174
```

In another terminal, render same-camera proof from the built preview:

```sh
cd "$TILE_CHECKOUT"
SQUARE_WORK=/Users/jancervenka/Documents/ChatGPT/PRAGA/vinkothegame/.square/$TILE \
  node tools/square-proof.mjs "$TILE" --url http://127.0.0.1:4174/ \
  --out "/Users/jancervenka/Documents/ChatGPT/PRAGA/vinkothegame/.square/$TILE/proof-current"
```

Open `proof-current/index.html`, inspect every pair that includes a distinctive front, and keep the comparison
images outside Git. For fast portal iteration on x-1_z3 use `--only 20,21` with the 1-based pair numbers shown in
the full proof; use `--only 12` for KAMERA. Pair numbers differ by tile;
rerun the full proof before claiming the tile is complete. Check `proof.json` for blocked mapped openings. A
passing build and clear walk are necessary but do not establish visual fidelity.

## Current proof and remaining work

- Earlier full Street View proof on `x-1_z3` produced 21 pairs and found 4/4 mapped openings traversable.
  Its images predate removal of the raw blue-portal photo patch; regenerate and inspect the portal close-up.
- Earlier full Street View proof on `x-4_z2` produced 25 pairs and found 0 mapped openings in this square.
  Continue visual correction on the same-camera pairs.
- The ignored `.square/x-1_z3/review.json` lists the ornate upper-storey mismatch at `21651256_2`, the wrong
  bay rhythm and passage on `21651396_4`, and the Pilsner Urquell entrance at `21651396_7`, which needs a drawn
  shopfront after its photo patch was removed.
- The ignored `.square/x-4_z2/review.json` lists generic upper Academy arches and rustication
  (`21649651_36`), plain upper Hollar (`21649553_4`), and flat DEELIVE bays plus the neighbouring carved
  surrounds (`21644471_0`). Read each entry against the referenced proof pair and correct what the views support.
- Keep `layoutIssues` separate from facade art. One x-1_z3 issue describes a footprint/frontage mismatch near
  Mikulandská 135/7. Do not hide it with a facade drawing.

When the visual issues are resolved, merge, rebuild, inspect full proof, run `git diff --check`, and commit one
tile branch per square. Ask the owner to review the side-by-side proof before publishing a PR. This checkout
currently has local commits only: a push to `origin/look/x0_z2` was rejected by automatic approval review over
the unverified remote destination, and GitHub authentication for PR creation was unavailable. Do not treat a
local commit or generated proof as a published tile.
