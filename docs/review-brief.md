# Reviewing a grid square's house fronts from street photos

You are helping make a stylised 3D model of Prague's Old Town true to reality: the right house colours, floors,
ground floors, and the real signs. Read street photos of one grid square's house fronts and write down what you
see. Do not edit the repository. Write `review.json` and, where a front is clear enough, an original SVG drawing
in the square work folder's `fronts/` directory. The merge validates both before copying any drawing into git.

Run first: `npm run square -- prepare x<i>_z<j>` (see `tools/square.mjs`). It writes the inventory to the square's
work folder (`SQUARE_WORK`, default `.square/<square>/`) and the photos to `STREETVIEW_DIR` (default
`../vinko-streetview/`). Afterwards `npm run square -- merge x<i>_z<j>` checks your file and merges it.

## Inputs

- Use the fetched Street View images as the main reference. The owner's own photos and saved screenshots add
  detail where they cover the same frontage.
- `inventory.json` → `fronts`: one entry per house front: `front` ("code_edge"), `code` (RÚIAN building code), `number`
  (house register number), `street` (the street it faces), `mid` (position in the scene, m), `addresses` (from OpenStreetMap), `places` (named businesses OSM puts in this house:
  use them to read signs correctly, but only report a sign you can SEE), `len` (front length, m), `photos`
  (file names in the photos folder `photosDir`; a long front has `…a.jpg` and `…b.jpg`, each showing about half of it), `views`
  (the Street View camera position, heading, pitch, field of view and capture date used for model/photo proof), `aIsLeft`
  (ignore), and `current` (what the model has now for this house, or null).
- `ownPhotos`: the owner's own photos of this square (absolute paths from `OWNER_PHOTOS_DIR`, when present), and
  manual Street View screenshots dropped in `<photosDir>/<square>/`. `ownerPhotoMeta` gives the owner's position,
  heading, date and description. Use these as supplementary drawing references for this tile pass.
- Photos: Street View images are reference only: look; never copy them into the repository, crop them into new
  files, or use them as textures. (A temporary contact sheet outside the repository to view several at once is
  fine; delete it when done.) Each photo was aimed at the middle of its front from across the street, but the camera may be off:
  check the house in the middle of the frame is plausibly the one described (length, position on the street,
  neighbours, house numbers on enamel plates if readable). If a photo clearly shows something else (a courtyard,
  a parked van, a different house), say so in `issues` and don't describe from it.

## Output

Write `review.json` in the square's work folder, next to `inventory.json`: an object with

```json
{
  "houses": {
    "<code>": {
      "fronts": [ "<code_edge>", ... ],          // the fronts you based this on
      "colour": "#rrggbb",                      // main plaster colour as it looks in daylight (not shadow)
      "trim": "#rrggbb",                        // window surrounds / cornices / string courses
      "floors": 4,                              // above-ground storeys up to the main cornice (not attic dormers)
      "ground": "shops|restaurant|gate|windows|blank|default",
      "rustic": "none|banded|ornate|clad|rubble", // banded = horizontal rustication on the ground floor; ornate = rich stucco
      "style": "default|theatre|maj|chapel|glassBlock|curtain|bronze|gothic",
      "roof": "flat",                         // only when visibly flat; otherwise omit
      "grilles": true,                          // iron grilles on ground-floor windows
      "graffiti": false,                        // tagged ground floor
      "edges": { "<edge>": {
        "awning": "#rrggbb", "lanterns": true,
        "banner": { "text": "…", "board": "#rrggbb", "ink": "#rrggbb" },
        "ground": [ "shop", { "kind": "door", "frame": "wood", "glazed": true }, "window" ],
        "balconies": [ { "floor": 1, "from": 0.1, "to": 0.6, "depth": 0.8 } ],
        "shopfront": "<code>_<edge>.svg", "shopfrontHeight": 5.5
      } },
      "note": "Konviktská 24: ochre four-storey baroque house, … (Street View 2025)",
      "confidence": "high|medium|low"
    }
  },
  "signs": [
    {
      "front": "<code_edge>",
      "fromLeft": 0.3,                          // centre of the sign, fraction across the front from its LEFT end as seen in the photo
      "height": 3.2,                            // centre height above the pavement, m (ground floor is ~3.5 m tall)
      "kind": "board|letters|hanging|plaque",   // board = fascia/name board on the wall; letters = letters on the wall itself;
                                                // hanging = sign projecting from the wall on a bracket; plaque = small plate by a door
      "text": "EXACT TEXT AS WRITTEN",          // keep capitals and diacritics as on the sign; main line only
      "sub": "second line, if any",
      "width": 3.0,                             // m, estimated
      "bg": "#rrggbb",                          // board colour (omit for letters)
      "ink": "#rrggbb",                         // letter colour
      "font": "serif|sans|script",
      "what": "restaurant name board over the door"
    }
  ],
  "issues": [ "photos that don't match, unreadable signs, other uncertainty" ],
  "layoutIssues": [ { "kind": "street|passage|arcade|steps|building|surface|other", "where": "place and position", "evidence": "which photo shows the mismatch and what is visible" } ],
  "visualIssues": [ { "front": "<code_edge>", "what": "prominent remaining mismatch in the model", "evidence": "which photo and model pair shows it" } ]
}
```

## Rules

- Report only what you can see. If unsure, lower `confidence` or leave the field out; never invent a sign or a
  name. A business in `places` that has no visible sign gets no sign.
- One entry per house (`code`), merging its fronts; give per-front details through `edges` (edge = the number
  after the underscore in `front`).
- Colours: sample by eye from sunlit plaster; Prague plaster is usually muted (ochre, cream, pale green, pink,
  grey). Give hex values.
- Signs: the big readable ones that define the street: shop and restaurant names, hotel names, institutions.
  Skip tiny stickers, opening-hours boards, menus, parking signs. At most ~4 signs per house.
- Where `current` exists, check it against the photos and correct it (say what changed in `note`).
- Keep notes short and factual; end with "(Street View <year>)" — the year isn't in the file, write the year
  only if visible, else "(Street View)".
- Only houses and fronts from this square's inventory are merged; anything else is rejected (say it in `issues`).
- `confidence: "low"` keeps only your `note` and edges; the colours and floors are left as they are.
- `ground` on an edge lists visible openings **from left to right as seen from the street**. Kinds: `door`, `gate`,
  `shop`, `window`, `garage`, `niche`, `blank`. Optional `frame`: `wood`, `dark`, `white`, `green`, `grey`, `red`;
  `size`: `narrow`, `normal`, `wide`; booleans `arch`, `bars`, `glazed`, `door`. The renderer spaces them across
  the measured front. Do not put a painted gate over a real passage.
- Drawn fronts are original, simplified SVGs based on what is seen. Make the viewBox `0 0 W H` in centimetres,
  with `W` about `inventory.fronts[].len × 100` and `H` 200–650. Use basic shapes, paths and text with literal
  colours. Make spaces without painted content transparent; real passage openings are cut out by the scene build.
  Put SVGs at `<work>/fronts/<code>_<edge>.svg` and name them in the matching edge's `shopfront`. No `<image>`,
  CSS, external links, scripts, filters, embedded photos or remote resources. Do not trace Street View pixels.
  `npm run build` rasterizes these checked SVG drawings into ignored PNG textures for the game.
  Set `shopfrontHeight` only when the pictured ground floor is taller than the normal 4.2 m overlay, so the
  drawing covers the underlying procedural openings.
- Read the photos through `node tools/square-marks.mjs <square>` first: `<work>/marked/` copies show where each
  RÚIAN front starts and ends (labelled `<code>_<edge>`, the photographed one in yellow) and metre ticks along it,
  counted from its left end. Describe a facade under the front the marks put it on; a house often spans the end
  of one front and the start of the next.
- One RÚIAN building can join houses that look nothing alike (a glass corner office and the baroque houses behind
  it). An edge can then carry its own `style`, `colour`, `trim` and `rustic`, which win over the house's.
- Owner photos can clarify signs, doors and material details when Street View is ambiguous. Translate those
  details into original SVG drawings that match the game's painted style; do not place raw photo patches on facades.
- Report layout problems in `layoutIssues`, with the exact photo evidence. Geometry is **not** changed by review.
  The owner decides whether to fix a passage, street or steps after looking at the comparison and walk report.
- After the model/photo correction pass, list every prominent frontage mismatch still visible in `visualIssues`.
  Use an empty array only after checking the pairs. The unattended pipeline stops before a PR if this array
  is nonempty, so a generic facade is not presented as a finished tile.
- When done, reply with a 5-line summary: houses described, signs found, notable issues.
