# Praha · Betlémská čtvrť

A walkable 3D model of Prague's Old Town around Betlémské náměstí, from Smetanovo nábřeží to Jilská and south over
Národní to Žofín and Spálená.
Built with three.js (WebGPU, falls back to WebGL 2).

## Run it

```sh
npm install
npm run dev
```

Open the printed URL (http://localhost:5173). You start on foot in front of Hostinec U Rotundy, in third person: click to steer the camera with the mouse, **WASD** to walk, **Shift** to run, the wheel
to zoom, **V** for first person; **M** (or the button) for the view from above (drag to orbit, scroll to zoom). The minimap (bottom left) turns with the camera and marks the places below.
Add `?webgl` to the URL to force WebGL 2, `?overview` to start with the view from above.

On a phone: the joystick bottom left walks (push to the rim to run), drag anywhere else to look.

The generated scene is committed in `public/data/`, so nothing else is needed to run it.

## Places to find

- **Rotunda sv. Kříže Menšího** (Konviktská) with its lantern and iron fence
- **Hostinec U Rotundy**, **Standard Café** and **Champagneria** (in the Průchodní passage): walk in through
  the open doors; outdoor seating, festoon lights over Průchodní
- **Náprstkovo muzeum**: the gate with banners
- The **chimney courtyard** off Náprstkova
- The **stairs** from Národní down to Divadelní
- **Národní**: Kavárna Slavia and FAMU in Lažanský palác, the National Theatre, **Nová scéna** in its glass blocks
  with the piazzetta behind, the arcade (podloubí) of Palác Metro, DRN, Máj, Platýz and its passage
- **Spálená** with Quadrio and Divadlo Ypsilon; **Uhelný trh** and the arcades of **Havelská**
- **Smetanovo nábřeží**: Fakulta sociálních věd, Bellevue, Karlovy lázně; **Masarykovo nábřeží** and its
  apartment palaces
- **Slovanský ostrov** over its footbridge: Žofín, the music pavilion, Mánes and the Šítkov water tower;
  **Most Legií**
- Arcades and passages through houses wherever OpenStreetMap has them (`tools/openings.mjs`, `src/openings.js`)
- Tram stops: raised islands with shelters, stop poles and departure boards (`src/stops.js`)
- People (architectural scale figures, `src/figures.js`) walking the pavements and sitting at tables and benches;
  parked and driving cars (Kenney's Car Kit, CC0, `?cars`); trams (Škoda 15T in three sections and coupled Tatra T3s,
  modelled from street photos) on the real tracks, stopping at the stops
- Smetanovo nábřeží's railing, the Čapadlo terrace with its underpass and stairs, Divadelní under Národní

These are located in the data by `tools/places.mjs` and modelled in `src/places.js`, `src/venues.js`, `src/bridges.js`,
`src/landmarks.js` and `src/life.js`. House fronts read from street photos are described in `data/houses.json`.

## Where the data comes from

| What | Source |
| --- | --- |
| Building footprints and floor counts | ČÚZK RÚIAN |
| Streets, tram lines, river, parks, landmark names | ČÚZK ZABAGED® |
| Terrain | ČÚZK DMR 5G |
| Building and roof heights | ČÚZK DMP (0.5 m surface model) |
| Roof colours and materials, tree check | ČÚZK Ortofoto |
| Facade colour, window spacing, shop fronts | Mapillary street photos (CC BY-SA 4.0) |
| Kerb lines | house fronts (RÚIAN) and the 12.5 cm aerial photo, see `tools/kerbs.mjs` |
| Pavements, places, street furniture | © OpenStreetMap contributors (ODbL) |

Facade layout, antialiasing helpers and window interiors are ported from
[Slop New York](https://github.com/mrdoob/slop-newyork) (MIT, Mr.doob); see `src/shading/common.js`.

## Rebuilding the data

```sh
NODE_USE_ENV_PROXY=1 node tools/fetch-data.mjs          # ČÚZK data → data/raw/
MAPILLARY_TOKEN=… node tools/fetch-mapillary.mjs        # street photo metadata
MAPILLARY_TOKEN=… node tools/facades.mjs                # match and rectify a photo per street facade
node tools/facade-params.mjs                            # measure colour / windows / shops from the crops
node tools/build-scene.mjs                              # → public/data/
```

`tools/area.mjs` sets the area. Without the Mapillary steps the facades fall back to typical Prague colours.
