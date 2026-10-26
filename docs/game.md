# The game: design, state and plans

The one place for what the game is, what's in it and what's next. Read it before working on gameplay; keep it up to
date when something lands (move items between the status columns, add new ideas at the bottom of their section).
The city it is played in, the Prague model, is a separate thing: see `docs/README.md` for the split.

Last update: 2026-10-26.

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
| **Holub (pigeon)** | Starts straight in the city on the pavement of Betlémské náměstí: walk, sit, peck crumbs, fly. Controls: A/D turn, W flap/faster, S brake, Space climb, C dive, mouse looks; the camera settles behind after 1.2 s. Day and night (T skips time). The egg and the first day's tutorial (`src/holub/story.js`) only with `?vejce`. | playable (`?holub`) |
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
- Planned: **Perlová street**: a few sex workers standing by the walls, more at night (non-explicit, no interaction
  beyond other NPCs; a settings switch to turn them off). Locals vs tourists mix (faces need tagging). NPC reactions
  to the pigeon (shoo, feed). Short deadpan lines when you pass.

## 5. Vehicles

- **Trams**: real Prague types as textured boxes from the owner's pictures: Tatra T3 (often in pairs), historic T3,
  KT8D5, 14T, 15T, 52T; on the real tram lines, stops with names.
- **Cars** (`?cars`): only Czech cars: Škoda Octavia (1st gen), Favorit, Trabant (models CC BY, see
  `public/models/vehicles/CREDITS.md`). No brand badges in textures or UI.
- **Boats**: swan pedal boats and rowing boats by Slovanský ostrov, a steamer moored on Smetanovo nábřeží.
- The courier's scooter with a turquoise delivery box (no brand yet: our own made-up delivery company later).
- Planned: car paint variety, a proper Vltava steamer, more scooter textures (prompts in
  `~/Documents/ChatGPT/PRAGA/texture-prompts-vehicles.md`).

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
| pigeon flight + story start; walking; jump; scooter; console HUD, loading bar, real pause; teleport map; PS1 look (pigeon); generated ugly people; trams, Czech cars, boats; Bjukitchen; Malá Strana first layer; studio + admin | performance (`perf/ps1`: fast load, smooth frames, PS1 look everywhere); start screen + character creator (`feat/start`) | Perlová NPCs; deliveries (Bjukitchen first); sound | weather; easter eggs; more sponsored interiors; open-source split of the model |
