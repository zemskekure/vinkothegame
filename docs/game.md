# The game: design, state and plans

The one place for what the game is, what's in it and what's next. Read it before working on gameplay; keep it up to
date when something lands (move items between the status columns, add new ideas at the bottom of their section).
The city it is played in, the Prague model, is a separate thing: see `docs/README.md` for the split.

Last update: 2026-10-26 (pigeon flight; the owner's textures on cars, boats, furniture, trees, graffiti, sky).

## 1. Vision

- **Moving around Prague is the game.** Walking, riding a scooter and flying as a pigeon through a faithful, small
  piece of real Prague has to feel good on its own. Missions, story and easter eggs sit on top and never gate it.
- **Late-90s console look** (PlayStation 1): very low poly, small nearest-filtered textures, a low internal resolution
  (300 lines), 62 colour levels a channel with dither, a little grain, flat shading, fog instead of a long draw
  distance. The settings live in `public/game-settings.json` (`look`, `art`) and are tuned in the studio (`?studio`).
- **People are charmingly ugly**: photo faces stretched on coarse faceted heads, bodies with bellies, hunches and odd
  proportions, clothes from the owner's generated textures. A new crowd every game start.
- **Tone: deadpan.** Dry, small jokes; the city and its people are the comedy. Reference: *Pigeon: A Love Story*
  (three.js, itch/Steam): slow, whimsical, "about nothing and everything".
- **It must run smoothly** on an ordinary laptop and load fast from a web link (see `docs/performance.md`).

## 2. Ways to play

| Mode | What it is | State |
|---|---|---|
| **Holub (pigeon)** | Starts straight in the city on the pavement of Betlémské náměstí: walk, sit, peck crumbs, fly. Flight is calm and forgiving (`src/holub/game.js`, flight section): cruises at ~10 m/s and holds its height with no keys pressed; A/D turn (leaning into the turn, ~24°, the camera stays level), W flaps (faster, climbing gently), S slows down and sinks (near a roof, ledge or the pavement it flares and lands by itself), Space takes off with a hop / climbs, C or Shift glides down; it lifts itself over low edges ahead and turns along walls instead of hitting them; touching down too fast is a soft bounce. The mouse orbits the camera, which swings back behind after ~1 s. Tuning (speed, turn rate, bank, camera distance and lag): `pigeon` in `public/game-settings.json`, live on the admin page (?admin, tab Holub). Day and night (T skips time). The egg and the first day's tutorial (`src/holub/story.js`) only with `?vejce`. | playable (`?holub`) |
| **Kurýr (food-delivery courier)** | A character made in the creator, on foot or on a delivery scooter (B): leans into turns, bumps over setts and tram rails, 40 km/h top. Later: deliveries from real restaurants to addresses, against the clock, for tips. | riding works; creator + start screen in progress (`feat/start`); deliveries planned |
| **Jen se projet (free roam)** | On foot, no goal. Space jumps (a 0.7 m hop, legs tucked; not on the scooter). | works (default today) |
| Overview | The city from above (M). | works |

Start screen: choose Holub / Kurýr / Jen se projet; deep links (`?at=…`, `?holub`, `?overview`, `?studio`) skip it.
While it is up, the city's first files download, then (at low priority) the drawn fronts, the people's bodies and
wardrobe, the scooter, life.json, trams and boats, so the game starts from the cache. The build's version (date and
commit, injected by `vite.config.js`) shows in a corner and in the pause menu. Title and subtitle: `GAME_TITLE`,
`GAME_SUBTITLE` in `src/ui.js` (the name isn't decided).

### UI (late-90s console HUD)

- One look for the start screen, the creator, the loading screen and the HUD: `src/ui.js` (shared styles, the menu
  list, the pixel title, the credits panel). Lettering: Pixelify Sans (OFL, self-hosted in `public/fonts/`, Czech
  diacritics), at 16 / 24 / 32 / 48 px only so it stays crisp; the big "PRAHA" title is drawn on a canvas.
- Loading (`src/loading.js`): one bar through the download and the build steps in `src/main.js` (terrain, ground,
  houses, furniture, batching, the player, the map, the GPU pipelines with compileAsync's own progress); the bar creeps
  inside a step and a stripe runs on the compositor, so it never stands still.
- HUD (`src/hud.js`): nothing permanent but the minimap (thick black rim, orange N tab). The street's name comes in as
  an area title when you enter a street; key caps for a few seconds at start and on every mode change (H toggles
  them); the scooter's speedometer; the pigeon's clock and tally; the courier's messages on a pager.
- Pause (Esc, MENU on touch, or the tab going to the background): the game stands still (no updates, the last frame
  dimmed), the pointer is let go and caught again on Pokračovat. Menu: Pokračovat, Pohled shora / Na ulici, Upravit
  postavu (courier), Hlavní menu, Ovládání, Autoři a licence (all attributions; also on the start screen).
- The big map (Tab) in the same frame. Touch: MENU / SHORA buttons top left, the joystick, a SKOK button.

## 3. The world

- Old Town around Betlémské náměstí to Národní, Spálená and Žofín, now also **Kampa, Malá Strana and Petřín** (first
  layer: terrain, streets, plain houses, trees). Detail per 100 m tile comes from the model's street-photo pipeline.
- The big map (Tab, or click the minimap) teleports you anywhere.
- Known gaps in the new area: Karlův most has no statues or towers, the Petřín lookout tower is a block, the funicular
  has no track, houses have default fronts.

## 4. People (NPCs)

- Generator `src/persona.js` (spec: face, hair, top, bottom, skin, colours, height, width, 12 body-shape knobs) +
  `src/people.js` (Quaternius CC0 rigs, faceted photo heads, one texture atlas). Rules in `art.crowd` (ugliness,
  textured share, spreads, fixed seed); `?seed=N` fixes the crowd.
- Walkers on pavements, people seated at café terraces and inside venues (a share of seats only).
- **Friends** (`src/friends.js`): the owner's real friends as named NPCs with their own photo faces, a fixed body and
  clothes from a seed made from their name. All of them round the front right-hand table in Hostinec U Rotundy (four
  on the chairs, the rest standing at the table's end, a beer each), some also about the city (spots in `SPOTS`:
  `kampa` on a bench on Kampa, `betlem` on Betlémské náměstí, `divadlo` on the Národní divadlo tram island). Come
  within 4 m and the nearest one's name and a line of theirs show above the head (a small DOM label of its own).
  **Their faces are private** (the repo is public): they live in `public/models/people/friends/` (gitignored) with
  `friends.json` (name, file, sex, lines, spots), put there by `node tools/friends.mjs [faces folder]`; the build only
  asks for them when the folder is there (`__FRIENDS__` in `vite.config.js`). Names, lines and places are edited in
  that `friends.json`. Their faces are never in the crowd's face pool, and the crowd leaves their seats free.
- **Perlová** (`src/perlova.js`): four women standing by the house walls on Perlová (Staré Město), idle like anyone
  standing about, no interaction. One by day, three in the evening (and on foot, where the clock stands at the game's
  evening), four at night (the pigeon's day cycle). Off with `world.perlova: false` in `public/game-settings.json`
  (also a switch on the admin page, Mapa a lidé).
- Planned: Locals vs tourists mix (faces need tagging). NPC reactions to the pigeon (shoo, feed). Short deadpan lines
  from strangers when you pass.

## 5. Vehicles and the street's things

Everything here is made from the owner's generated pictures (`~/Documents/ChatGPT/PRAGA/textures`), cut out, shrunk to
console size and packed into small atlases by the scripts in `tools/textures/` (see its README; rerun them when new
pictures land). One material per atlas, instanced or merged.

- **Trams**: real Prague types as textured boxes from the owner's pictures: Tatra T3 (often in pairs), historic T3,
  KT8D5, 14T, 15T, 52T; on the real tram lines, stops with names.
- **Cars** (on by default, `?nocars` hides them; `src/cars.js`, `car-atlas.png` 512 px): eight Czech street cars,
  Škoda Octavia, Favorit, Fabia, Trabant, a yellow taxi, a white van, a police estate and the red open tourer that
  drives tourists round. Each is its side outline (traced from the side picture) pushed out across the car, the
  glasshouse leaning in above the sills, with the side, top, front and rear pictures projected on (~150 triangles).
  Only the parked cars in view and nearer than the haze are drawn. `?cars=models` brings back the downloaded Octavia,
  Favorit and Trabant models (CC BY, `public/models/vehicles/CREDITS.md`); the picture cars were kept for all eight
  because they read as sharper and more Prague than the models, and all share one look. No brand badges in UI.
- **Boats** (`src/boats.js`, `boat-atlas.png`): swan pedal boats, pedal boats and rowing boats by Slovanský ostrov,
  the paddle steamer and a glass-roofed sightseeing boat moored on Smetanovo nábřeží; made like the cars, with the
  width along the boat from the top picture and cabins, seats and the swan's neck narrower above the gunwale.
- **Street furniture** (`src/furniture.js`, `furniture-atlas.png` 256 px): historic lamp posts, cast-iron bins and
  bollards turned on a lathe from their pictures' outlines, bench planks wearing the owner's slats.
- **Trees**: crowns wear linden, horse chestnut or plane leaves (planes and chestnuts by the river and on the
  islands, lindens in the streets), trunks the matching bark (`tree-atlas.png`).
- **Graffiti** (`src/graffiti.js`, `graffiti-atlas.png`): tags, throw-ups, pieces, stickers, paste-ups, painted
  shutters and torn posters on the ground floors up to 2.5 m: heavy in the lanes and passages (Na Perštýně,
  Betlémská, Konviktská…), light on Národní and the squares, none on landmarks; described windows stay clean.
  Seeded per wall, so a house keeps its graffiti. `tools/textures/graffiti.py` packs whatever is in the owner's
  `textures/graffiti/` folder (kind from the file name: tag, throwup, sticker, pasteup, piece, shutter).
- **Sky** (`src/sky.js`): the owner's panoramas on a dome: sunrise haze, blue noon, golden evening, the full moon,
  following the pigeon's clock (afternoon on foot); `?weather=overcast|storm` (or `look.weather`) for the grey ones.
- The courier's scooter with a turquoise delivery box (no brand yet: our own made-up delivery company later).
- Not used yet: the kiosk and tram-shelter pictures (no places for them in the data), hedge and ivy textures, the
  animal and food pictures beyond the pigeon's (pigeons on squares, ducks and swans on the river, a rat, a cat; a
  rohlík or trdelník as pigeon food), the black SUV easter egg's own pictures (`car_suv_*`, not drawn yet).
- Planned: more scooter textures (prompts in `~/Documents/ChatGPT/PRAGA/texture-prompts-vehicles.md`), weather
  that also changes the light.

## 6. Places, interiors and sponsors

- Walk-in interiors: the pub, the café, Champagneria, Slavia, the večerka, **Bjukitchen** (Jungmannova 33/27, the
  first sponsored interior: real shopfront, logo, layout).
- **Business idea: sponsored real interiors** ("your restaurant in the game"). One entry in `data/venues.json` per
  venue; how-to in `docs/venues.md`. Couriers will pick up orders at these places.
- Keep sponsored places away from content they might not want next to them (switchable).

## 7. Story, missions, easter eggs

- Pigeon story: egg → tutorial → free (`src/holub/story.js`), only with `?vejce` now. More chapters: ideas below.
- Ideas (not built yet):
  - Pigeon side missions: steal a trdelník, chase off a rival pigeon from the Hus statue... (to collect)
  - Courier deliveries with a map pin → on-screen arrow (borrowed from *Pigeon: A Love Story*).
  - Easter eggs: ideas to collect here (locations, what triggers them).
  - Weather (rain, fog), seasons (Christmas market stalls in front of Betlémská kaple).
  - Sound: footsteps by surface, tram bell and squeal, pigeons, street noise, the river.
  - A screensaver mode: the pigeon flies over Prague on its own.
  - A "reduce camera motion" setting.

## 8. Tools around the game

- `?studio`: the art-direction studio (look, people generator, shuffle, body shapes; save to the game settings).
- `?admin`: game settings and spawn zones beside the running game.
- Dashboard (mrizka.kedlubna.com, mini): the grid of tiles, the model pipeline, game settings API, `/game/`.

## 9. Status board

| Done | In progress | Next | Later |
|---|---|---|---|
| pigeon flight + story start; walking; jump; scooter; console HUD, loading bar, real pause; teleport map; PS1 look (pigeon); generated ugly people; trams, Czech cars, boats; Bjukitchen; Malá Strana first layer; studio + admin; friends NPCs; Perlová | performance (`perf/ps1`: fast load, smooth frames, PS1 look everywhere); start screen + character creator (`feat/start`) | deliveries (Bjukitchen first); sound | weather; easter eggs; more sponsored interiors; open-source split of the model |

## Queue (owner's requests not started yet)

- Trams and cars solid (the walker, the scooter and the pigeon collide with them).
- Ride the tram: board at a stop, sit or stand inside (T3 and 15T interiors from the owner's textures `tram_t3_interior`, `tram_15t_interior`, `tram_seat_fabric`), ride along the line with the city passing by, get off at a stop.
- Passengers getting on and off at tram stops.
