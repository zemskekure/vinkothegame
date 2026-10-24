# Reviewing a grid square's house fronts from street photos

You are helping make a stylised 3D model of Prague's Old Town true to reality: the right house colours, floors,
ground floors, and the real signs. Your job: read street photos of one grid square's house fronts and write down
what you see, in the JSON format below. You do NOT edit the repository. You write one output file.

Run first: `npm run square -- prepare x<i>_z<j>` (see `tools/square.mjs`). It writes the inventory to the square's
work folder (`SQUARE_WORK`, default `.square/<square>/`) and the photos to `STREETVIEW_DIR` (default
`../vinko-streetview/`). Afterwards `npm run square -- merge x<i>_z<j>` checks your file and merges it.

## Inputs

- `inventory.json` → `fronts`: one entry per house front: `front` ("code_edge"), `code` (RÚIAN building code), `number`
  (house register number), `street` (the street it faces), `mid` (position in the scene, m), `addresses` (from OpenStreetMap), `places` (named businesses OSM puts in this house:
  use them to read signs correctly, but only report a sign you can SEE), `len` (front length, m), `photos`
  (file names in the photos folder `photosDir`; a long front has `…a.jpg` and `…b.jpg`, each showing about half of it), `aIsLeft`
  (ignore), and `current` (what the model has now for this house, or null).
- `ownPhotos`: the owner's own photos of this square (in `<photosDir>/<square>/`), if any, and manual Street View
  screenshots dropped there. Use them like the others; they are often better.
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
      "rustic": "none|banded|ornate",           // banded = horizontal rustication on the ground floor; ornate = rich stucco
      "grilles": true,                          // iron grilles on ground-floor windows
      "graffiti": false,                        // tagged ground floor
      "edges": { "<edge>": { "awning": "#rrggbb", "lanterns": true, "banner": { "text": "…", "board": "#rrggbb", "ink": "#rrggbb" } } },
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
  "issues": [ "free text: photos that don't match, things in the model that look wrong, things worth modelling (arcades, gates, statues, trees, a closed passage), unreadable signs" ]
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
- When done, reply with a 5-line summary: houses described, signs found, notable issues.
