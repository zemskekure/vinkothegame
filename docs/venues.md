# Sponsored venues: adding the next walk-in interior

A sponsored venue is a real business modelled outside and in: its shopfront drawn on the house, a room behind the
door you can walk into, outdoor tables, a minimap marker. Bjukitchen (Jungmannova 33/27) is the first and the
reference; copy its entries.

## What goes where

| What | Where |
| --- | --- |
| The shopfront and any other drawn ground floor (panels, logo, lettering, windows) | `data/fronts/<code>_<edge>.svg`, named in `data/houses.json` → `<code>.edges.<edge>.shopfront` |
| House colour, notes, `signs: false` | `data/houses.json` → `<code>` |
| Room, door, windows, tables, plates, marker, palette, layout | `data/venues.json` → one entry |
| Furniture | `src/sponsored.js`: a layout preset (`LAYOUTS`), plus an optional function for the venue (`FURNISH[style]`) |

`tools/venues.mjs` reads `data/venues.json` at build time and writes the room into `places.interiors` (with walk
zones, wall cut-outs, tables, plates); `src/venues.js` hands rooms with `shell: true` to `src/sponsored.js`.

## Step by step

1. **Find the house and its fronts.** The RÚIAN code (`kod`) of the building, then its street-facing edges:
   `data/raw/street-facades.json` lists `{ code, edge, a, b, n }` (S-JTSK; scene `x = X + 743087`,
   `z = −(Y + 1043282)`). Distances along a front are always measured **from its left end as seen from the
   street**, in metres; the drawn SVGs run the same way.

2. **Draw the front.** An SVG per edge, `viewBox="0 0 <len·100> 420"` (centimetres, the ground at the bottom,
   the overlay is 4.2 m high). Flat shapes in the game's drawn style; allowed elements and attributes are checked by
   `validateShopfrontSvg` in `tools/square-schema.mjs` (no images, styles or ids). Leave the **door transparent**
   and draw glass translucent (`fill-opacity` about 0.3): the house wall behind is cut away there, so the room
   shows through. The logo and lettering are drawn as vector shapes or text, not photo crops (Bjukitchen's B mark is
   four `A` arcs). Name the file in `houses.json` under the edge, set `signs: false`, and write a `note` with the
   photo source. `npm run build` rasterises the SVGs (`tools/render-fronts.mjs`).

3. **Add the entry** to `data/venues.json`:

   ```json
   "myvenue": {
     "name": "…", "note": "what the photos show, and when",
     "house": 21650608, "style": "myvenue", "layout": "longCafe",
     "room": { "edge": 2, "to": 27.4, "inFrom": 0.7, "inTo": 7.4, "h": 3.75, "end": 3 },
     "door": { "edge": 3, "from": 5.64, "to": 6.75, "h": 2.3 },
     "glazing": [ { "edge": 3, "from": 0.84, "to": 2.44, "y0": 1.15, "y1": 2.86 } ],
     "terrace": { "edge": 3, "kind": "garden", "colour": "#5d6b4b", "spots": [ [ 2.0, 2.3 ] ] },
     "doorstep": { "edge": 3, "plants": [ 5.2 ], "pumpkins": [] },
     "plates": [ { "edge": 3, "at": 7.9, "y": 4.55, "kind": "street", "text": "…", "sub": "…" } ],
     "marker": { "icon": "B", "colour": "#e8483c" },
     "palette": { "wall": "#f4f1e9", "floor": [ "#7d776d", "#5d5850" ], "counter": "#e7d9a1", … }
   }
   ```

   - `room`: a rectangle along front `edge`, from `inFrom` to `inTo` m back from it (stay ~0.6 m inside the
     outer walls), from `from` to `to` m along it (it may run past the front's ends where the house goes on). With
     `end: <edge>` one end of the room is that front instead (the shopfront the door is in, even if it is not square
     to the room). `h` is the vault's crown.
   - `door`: the opening you walk through (`from`/`to` along its front, `h` its height). It gets a walk zone from
     the pavement into the room and the house wall is cut away.
   - `glazing`: each window or glazed bay that should show the room: `from`/`to` along its front, `y0`/`y1` above
     the pavement. Match the SVG's glass. Windows on any front facing the same way as the room's front, or on the
     `end` front, also get an opening with reveals in the room's wall.
   - `terrace`: outdoor tables at `[ along, out ]` metres; `kind: "garden"` is the round metal table with three
     upholstered chairs in `colour`; the older kinds (`fold`, `bistro`, `champagne`) work too.
   - `plates`: enamel plates on the front (`street`, `cp` red register number, `or` blue street number).
   - `palette`: the colours the layout preset uses (see `longCafe` in `src/sponsored.js` for every key).

4. **Furnish it.** Pick a layout preset; `longCafe` is a long vaulted room entered at one end: the counter and coffee
   bar and open kitchen in front, an arch, an upholstered bench with tables under the windows, shelving on the
   opposite wall, accent tables at the far end. Write a new preset only for a genuinely different plan. For what is
   particular to the place add `FURNISH.<style>` (Bjukitchen: the curtain on its green rail, the coffee-bag shelf,
   red oval lights, the arc lamp, the B mark on the wall). Presets place things by `a` (along the room from the door
   end) and `c` (across from the window wall), so they work whichever end the door is at. Keep it cheap: boxes and
   cylinders with few segments, colours through `mat()` so the kit merges them into one mesh per colour.

5. **Build and look.**

   ```sh
   node tools/build-scene.mjs     # prints "venues: <name> <w> × <d> m, floor …, N windows"
   npm run build && npx vite preview --port 4173
   node tools/screenshot.mjs "http://localhost:4173/?webgl&at=x,z,yaw" out.png   # on macOS drop its executablePath
   ```

   Look from the street both ways, at the door, inside towards the back and towards the front, and compare with the
   photos. The minimap shows the marker; `?at=` takes scene coordinates (`yaw` 1.571 looks west, −1.571 east,
   0 north, 3.14 south).

## Bjukitchen

`?at=269.5,383,1.2` the shopfront from across Jungmannova; `?at=271,371,2.356` the corner from Charvátova;
`?at=244,379.5,-1.571` inside, looking from the seating to the counter; `?at=258.5,378.6,1.65` inside the door,
looking down the room. Source: the owner's photos of 2026-10 (exterior, counter, kitchen, seating, back room).
