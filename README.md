# Praha · Betlémská čtvrť

A walkable 3D model of Prague's Old Town around Betlémské náměstí, from Smetanovo nábřeží to Jilská.
Built with three.js (WebGPU, falls back to WebGL 2).

## Run it

```sh
npm install
npm run dev
```

Open the printed URL (http://localhost:5173). Drag to orbit, scroll to zoom; press **M** (or the button) to walk
the streets: click to look around with the mouse, **WASD** to walk, **Shift** to run.
Add `?webgl` to the URL to force WebGL 2, `?walk` to start on foot.

On a phone: the joystick bottom left walks (push to the rim to run), drag anywhere else to look.

The generated scene is committed in `public/data/`, so nothing else is needed to run it.

## Places to find

- **Rotunda sv. Kříže Menšího** (Konviktská) with its lantern and iron fence
- **Hostinec U Rotundy**, **Standard Café** and **Champagneria** (in the Průchodní passage): walk in through
  the open doors; outdoor seating, festoon lights over Průchodní
- **Náprstkovo muzeum**: the gate with banners
- The **chimney courtyard** off Náprstkova
- The **stairs** from Národní down to Divadelní
- People walking the pavements and sitting at tables and benches; parked and driving cars

These are located in the data by `tools/places.mjs` and modelled in `src/places.js` and `src/life.js`.

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
