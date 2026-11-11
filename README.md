# Must Go Up

A multiplayer 3D platformer for young English learners. Students race up a 600-block tower (10 zones of 60 blocks); every 30 blocks a question gate makes them answer English questions (from the teacher's CSV) before they can keep climbing. Runs in the browser on PCs and tablets — nothing to install.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000, click **Host Game**, then join from other tabs/devices with the 4-letter code (or the QR code / join link).

`npm run check` runs a reachability check over 90 generated towers (every main-route jump fits its zone's limits).

## Controls

| Action | PC (no mouse needed) | Tablet |
|---|---|---|
| Move | W A S D | Left joystick |
| Camera | Arrow keys (← → turn, ↑ ↓ tilt), + / − zoom | Swipe on the right half |
| Jump / double jump / jetpack | Space (1, 2 or 3 presses) | Jump button |
| Use item / choose slot | E / 1–4 | Item button / tap a slot |
| Rewind | R | Rewind button (while falling) |
| Emotes | T then 1–4 | Emote button |
| Leaderboard | Tab | Trophy button |
| Answer a gate question | 1–4 or click | Tap |

The mouse is optional: drag to look around, scroll to zoom.

## The climb

- Platforms come in four sizes (tiny, small, medium, normal) from zone 1, with more small and tiny ones higher up.
- Moving platforms start in zone 1 (sliders and lifts) and every zone adds its own (leaf lifts, crumbling ledges, ice, fading clouds, balloons, gears, airships, …).
- **Tightropes**: every zone has an occasional run of 2–3 super slim beams (down to 0.7 blocks wide in space) on the main route. Keep your balance!
- **Boost-ups** skip several platforms at once, and every zone has some:
  - **Geysers** (the old water spouts) bubble with a pulsing blue ring and a ⬆️ arrow, then erupt and launch you straight up. Stand in the column to ride it.
  - **Boost pads** are permanent glowing discs with a zone icon (🌼 🍄 🐸 ❄️ 🌈 🎈 ⚙️ ⚡ ⚓ 🚀). Step on one to fling yourself up; you keep your double jump at the top.
- **Shortcuts**: yellow-topped side trails of small platforms wind around the outside and rejoin the route a loop higher. Most segments have one, some have two.
- Telegraphed hazards in every zone: **swooping birds** (red outline, ❗ and a red target ring for over a second before they dive). Zones 8–10 add wind, lightning, Gust Puffs, parrots, barrels, booms, asteroids, meteors and low gravity. The Hazard level setting (Gentle / Standard / Wild) scales how often they fire.

## Deploy to Render

1. Push this folder to a GitHub repository.
2. In Render: **New → Blueprint**, pick the repo. `render.yaml` creates a Node web service (`npm install` / `npm start`, health check `/healthz`) that auto-deploys on every push.
   - Or **New → Web Service** manually with build command `npm install` and start command `npm start`.
3. Render's free instances sleep when idle — open the site a minute or two before class to wake it.

Game state lives in memory on a single instance, so keep it to **one instance** (don't scale horizontally). A restart/redeploy ends any running games.

## How a lesson works

1. Teacher opens the site → **Host Game**. A room code, join link and QR code appear (projector-friendly).
2. Upload a CSV (or use the built-in sample bank). The game checks it, lists skipped rows with reasons, shows warnings and a preview of the first 10 rows. The last bank is remembered in the teacher's browser.
3. Adjust settings, students join (first name → animal, colour, free hat and trail), press **Start**.
4. Host role **Spectate** (default) shows the projector view: the whole tower with every student, live top 5 with gate progress, and teacher controls (pause, kick, offensive items on/off, end game). Host role **Play** lets the teacher climb too.
5. Results: podium, per-student stats, team totals, and (teacher only) class accuracy, most-missed questions with the most common wrong answer, and pushes given/received. **Download results** saves a CSV.

### CSV format

`Question, Correct Answer, Incorrect Answer 1, Incorrect Answer 2, Incorrect Answer 3` — header row first; answers 2 and 3 are optional (so yes/no works). UTF-8, up to 500 rows, questions ≤ 200 characters, answers ≤ 80. Use **Download template** in the lobby for a ready file.

## Decisions from the spec's open questions

| Question | Answer used |
|---|---|
| Room size | Max **10** players (setting 2–10) |
| Offensive items default | **On** |
| Default finish line | **Full tower** (now 600 blocks: zones were shortened to 60 blocks with a gate every 30) |
| Pass through or bump | **Light bumping** between players |
| Team mode | **Yes** — teams of 2–4 (lobby setting), ranked by combined height; members respawn at the **highest checkpoint reached by any teammate** |
| Shop cosmetics | **Useful items only** in the shop; a few hats and trails are **free to pick** at the start |

## Project layout

```
server.js                 Express + Socket.io: rooms, questions, tokens, shop, items, gate checks, results
server/sample-bank.js     built-in grammar/vocabulary bank
server/filter.js          name word filter
public/index.html         screens, HUD, panels
public/css/style.css
public/template.csv       downloadable CSV template
public/js/shared/         code shared by server and client
  tower.js                seeded tower generator, zones, platform motion
  items.js                shop catalogue, animals, cosmetics
  settings.js             lobby settings
  csv.js                  question bank validation
public/js/main.js         game loop, rules (gates, checkpoints, oxygen, respawn), camera, spectator, teacher controls
public/js/world.js        tower meshes (instanced), colliders, sky, particles, decor
public/js/hazards.js      zone 3 and 8–10 hazards and enemies
public/js/player.js       character controller
public/js/animals.js      12 low-poly animals, hats, trails, name tags
public/js/controls.js     keyboard, mouse, touch
public/js/net.js          Socket.io client, clock sync, smoothing
public/js/gate.js         question panel
public/js/shop.js         shop panel
public/js/hud.js          altimeter, slots, meters, toasts
public/js/ui.js           home, lobby, join, character select, results
public/js/audio.js        Web Audio sound effects and music (no audio files)
```

## Fair play and security notes

- Only the server knows the answer key; browsers get options with random ids and learn the right one only after answering.
- The server tracks cleared gates and rejects positions above an uncleared gate or impossibly fast climbs.
- Offensive items: range-checked on the server, never reach players on gate pads, checkpoint decks, oxygen domes or respawning, only within 6 blocks vertically, 8 s push immunity, blocked by Bubble Shield, and never hit teammates.
- A dropped student can rejoin within 2 minutes (same tab/device) with progress, tokens and items intact.
