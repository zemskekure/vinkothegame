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
| **Holub (pigeon)** | Hatch from an egg (`?vejce`), a short tutorial, then the city from the air and the pavement: walk, sit, peck crumbs, fly. Controls: A/D turn, W flap/faster, S brake, Space climb, C dive, mouse looks; the camera settles behind after 1.2 s. Day and night (T skips time). | playable (`?holub`) |
| **Kurýr (food-delivery courier)** | A character made in the creator, on foot or on a delivery scooter (B): leans into turns, bumps over setts and tram rails, 40 km/h top. Later: deliveries from real restaurants to addresses, against the clock, for tips. | riding works; creator + start screen in progress (`feat/start`); deliveries planned |
| **Jen se projet (free roam)** | On foot, no goal. | works (default today) |
| Overview | The city from above (M). | works |

Start screen: choose Holub / Kurýr / Jen se projet; deep links (`?at=…`, `?holub`, `?overview`, `?studio`) skip it.
(in progress, `feat/start`)

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

- Pigeon story: egg → tutorial → free (`src/holub/story.js`). More chapters: ideas below.
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
| pigeon flight + story start; walking; scooter; teleport map; PS1 look (pigeon); generated ugly people; trams, Czech cars, boats; Bjukitchen; Malá Strana first layer; studio + admin; friends NPCs; Perlová | performance (`perf/ps1`: fast load, smooth frames, PS1 look everywhere); start screen + character creator (`feat/start`) | deliveries (Bjukitchen first); sound | weather; easter eggs; more sponsored interiors; open-source split of the model |
