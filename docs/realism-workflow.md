# Making an area true to reality: the Betlémské náměstí workflow

This is how Betlémské náměstí was brought from "plausible old town" to "that's the square": real houses in the
right colours, the real signs, the chapel's actual front, the details people recognise. Use the same steps for
every grid cell. The goal is **true content** (which house, what colour, what it says, what stands where), not
photorealistic graphics: the model stays stylised.

Read `CLAUDE.md` first (frame, pipeline, the Street View rules).

## 1. Know what is in the area (data first)

Before looking at any photo, list what the data says is there:

- **Houses**: map OSM address points (`addr:conscriptionnumber` / `addr:streetnumber`) to RÚIAN building codes by
  testing which footprint in `data/raw/buildings.json` contains each point (if none does, take the nearest
  footprint; `cisladomovni` is the house register number). Now every house has a code, a number and an address.
- **Fronts**: the street-facing walls of those houses (`data/raw/street-facades.json`: code, edge index, ends,
  outward normal). Fronts on wide squares or lanes may be missing there; `frontFacing()` in `tools/places.mjs`
  finds them from the footprints.
- **Named places**: OSM nodes with `name` + `amenity`/`shop`/`tourism`/`historic` in the area (restaurants,
  hotel, museum, galleries, artworks). These are the signs to expect.
- **Other mapped things**: `barrier=wall`, parking polygons, `leisure=*`, trees, benches, footways.

Write this down as a table (address, RÚIAN code, what OSM says). Mistakes here propagate: on the square, earlier
notes had put the Náprstek museum on the wrong house.

## 2. Look at it from above

Crop the orthophoto (`data/raw/ortho.jpg`, 0.25 m/px, georeferenced to `AREA`) around the area with the
footprints and house numbers drawn over it. It answers layout questions instantly: which side of the square each
house is on, where the open paving is, and where things stand that no dataset has. On the square the aerial
photo showed the restaurant terrace's awnings in front of the chapel and the chapel's copper spire; their
positions were taken from it.

## 3. Collect references, front by front

- **The owner's Street View screenshots** (reference only, never committed, never traced; see `CLAUDE.md`) and
  **Mapillary** views (`tools/look-at.mjs`, may be stored).
- Aim for one view per front plus the overall views of the place. About 10–20 images covered the square.
- For each front note: plaster colour and trim, floors, dormers, ground floor (shops, arched openings, gate,
  windows with grilles), awnings and their colour, lamps, flags, banners, **every sign's text and style**
  (painted letters, wooden fascia, enamel plaque, hanging sign), and anything special.
- **Zoom in on details.** The enamel plates were read off a crop: Prague street plates are red with a white inner
  border, name in capitals, "STARÉ MĚSTO PRAHA 1" below; house plates are a red register number over a blue
  street number. Window positions on the chapel were measured as fractions of the front's width in a photo
  taken square-on.

## 4. Screenshot the model from the same viewpoints

Render the game at street level at roughly the camera positions of the references (`?webgl&at=x,z,yaw`), plus one
view from above (`?overview&view=…`). Put model and reference side by side and list every difference. Typical
finds on the square:

- a house with the wrong identity or colour (notes mixed up between neighbours);
- the chapel's twin gables built on the wrong wall (the code picked the longest street front; the gables face
  the square, south);
- a statue on a plinth that isn't there: OSM had tagged the chapel's **address point** as an artwork;
- benches mapped on the carriageway, with people sitting on them in the road;
- a garden shown as open paving where there is a walled garden with barred gates;
- missing signs, fixtures and plates everywhere;
- and one global bug: the sun stood in the north-west, so every south-facing front was in shade.

## 5. Check facts before building them

When something is unclear, ask the owner or search; never drop or invent a feature on a guess. "Za pravdu" looked
like a bogus statue; it is a real artwork: eight stone ledges on the chapel whose shadows spell ZA PRAVDU on
sunny summer afternoons. It was then modelled from the photos, not deleted.

## 6. Fix, cheapest lever first

1. **Identity and appearance of houses**: `data/houses.json` (colour, trim, floors, ground, rustic, grilles,
   per-edge awnings/lanterns/banners, `signs: false` to hide generic OSM boards) with a `note` saying what was
   seen and when.
2. **Signs and fixtures**: `tools/dress.mjs` (data) → `src/dress.js` (drawing). Place them by `frontFacing( point
   on the wall, point in front of it )`, then a fraction along the front and a height above the ground in front.
   Kinds available: board (wooden fascia or name board), letters (painted on the wall), badge (round logo
   disc), lantern, flags, portal (stone arch with doors and an inscription), canopy (terrace awnings with
   lettered valances, tables and chairs), clock (street clock, real time). Plates (house numbers from OSM
   addresses, street names at corners) are generated for the area automatically.
3. **Geometry that data can't give**: landmark overrides in `tools/build-scene.mjs` (`LANDMARKS`) and hand-built
   pieces in `src/landmarks.js`, sized from the data (front line, eave, gable pitch passed from the build) and
   placed from photo measurements.
4. **Data fixes in the pipeline**: generic rules beat one-off patches when the error is a pattern (benches off
   the road, OSM walls with gates), with a named exception list where the data itself is wrong
   (`NOT_STATUES` in `tools/streets.mjs`).
5. **Spawn and framing**: the start position (`startAt()` in `src/main.js`) can look at the area's best view.

## 7. Rebuild, look again, repeat

`node tools/build-scene.mjs` (when tools/ or data/ changed), `npx vite build`, screenshot the same viewpoints,
compare again. Read the build's summary lines (counts of signs, plates, walls, moved benches) as a sanity check.
It took about five rounds on the square. Things that went wrong in rendering and how they were solved:

- text on double-sided planes reads mirrored from behind: use one-sided planes;
- letters painted on the wall disappeared behind the facade's relief: lift them a few centimetres;
- the city-wide shadow map (~0.34 m per texel) is far too coarse for lettered shadows: the sun is fixed, so the
  exact shadow is computed and drawn as a shadow-toned overlay;
- objects on a wall need a right-handed frame along it (x along the front, y up, z out); check which end is
  west before placing things "at the west end";
- the walker camera looks along (−sin yaw, −cos yaw): yaw for a view from (x, z) to (tx, tz) is
  `atan2( −( tx − x ), −( tz − z ) )`.

## 8. Record and ship

Commit with a message that says what now matches reality and what was wrong before; keep `houses.json` notes
current; list what is still missing (on the square: U Halánků's painted gable, the seasonal market stalls) so
the next session can pick it up.
