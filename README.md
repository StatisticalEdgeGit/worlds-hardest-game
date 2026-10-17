# World's Hardest Game

A neon lane-hopping game for phones. You're a dot that runs forward on its own.
The left and right buttons hop you one lane over. There are 100 levels, and each
one runs straight into the next without stopping. Every lane has its own colour,
and when you can't see the way in time, the colour of the lane to take flashes up.

## Modes

| Mode | Lives | Losing a life | Score |
| --- | --- | --- | --- |
| **Survival** | 3 for the whole run | Restarts that level. Losing the third sends you back to level 1. | Highest level reached |
| **Marathon** | Unlimited | Restarts that level | Lives it took to finish level 100. Lower is better. |
| **Race** | Unlimited | Back to your last checkpoint | First of up to 4 players to clear the final level wins |

Each solo mode keeps its own saved run, so you can have one of each on the go.
Races need the server (see [Race](#race)).

The game is plain HTML, CSS and JavaScript, drawn with WebGL, with no build step.
The optional leaderboard server is Node and Postgres, run with Docker.

## Play it

**With leaderboards (Docker)**

```bash
docker compose up -d --build
```

Then open http://localhost:8080. The server serves the game, the leaderboard API
and races from one address. On your phone (same Wi-Fi), open `http://<your PC's IP>:8080`.
Put that address in `.env` as `PUBLIC_URL` (see `.env.example`) so race lobbies
show friends where to go.

**Without leaderboards**

```bash
python tools/serve.py
```

Then open http://127.0.0.1:8137. `tools/serve.py` is a tiny server with browser caching switched off, so every reload shows your latest edits. A plain `python -m http.server` works too, but the browser may keep showing old files. Opening `index.html` straight from disk also
works. Levels are then built on the main thread instead of in the background.

**On your phone (same Wi-Fi)**

1. Run `python tools/serve.py 8137 0.0.0.0` in this folder.
2. Find your PC's local IP with `ipconfig` (for example 192.168.1.20).
3. On the phone, open `http://192.168.1.20:8137`. Windows Firewall may ask to allow Python. Allow it on private networks.
4. Use "Add to Home Screen" to get it full screen without the browser bar.

Offline play and "install as app" (via `sw.js` and `manifest.webmanifest`) only
work when the game is served over HTTPS or from localhost.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Hop left | Bottom-left button (the whole bottom-left area responds) | ← or A |
| Hop right | Bottom-right button (the whole bottom-right area responds) | → or D |
| Pause | ⏸ top right | P or Esc |
| Frame-time readout | – | F |

Presses stack, so tapping three times quickly crosses three lanes. Left and right
always mean the **dot's** left and right. Once the view spins or mirrors (worlds
6 and up), that can be the opposite of the screen.

## Difficulty

- **Every section forces a hop.** Only one lane is safe through each obstacle,
  so you can't sit in a lane.
- **Every level needs more hops than the one before.** It's 17 at level 1, 30 at
  level 10, 83 at level 50 and 146 at level 100. Many of them are 2- or 3-lane
  jumps. `hopsFor()` in `js/levels.js` sets the targets.
- **Hop windows** (the time you have to make each move) shrink from 0.66 s at
  level 1 to 0.42 s at level 10 and 0.26 s from about level 30.
- **Speed** starts at 219 and climbs to 554 by level 100. Each level also speeds
  up as you go.
- **Surges:** from level 4 there are sudden bursts of speed. The first surge in a
  level adds 20–40% for a few seconds. Every later surge in that level lasts about
  twice as long and adds 45–75%. There are two surges per level from level 6 and
  three from level 12. Speed is capped at 760.
- **Splits:** from level 2 the track splits into two paths and one of them
  dead-ends. Up to level 5 you can see the dead end coming. After that it's
  further off when you have to choose, and from level 21 it's beyond what you can
  see, so the colour cue is the only way to know.
- Levels last from about 24 seconds at level 1 to about 82 seconds at level 100.

| Levels | World | What's new |
| --- | --- | --- |
| 1–10 | First Steps | Lane breaks, splits and surges. Laser walls from level 4, then blinking lasers and sliders from level 7. |
| 11–20 | Bends | The track curves and the world turns around you. The first sweepers appear. |
| 21–30 | Lasers | Blinking lasers. Be in the dark lane. |
| 31–40 | Sweepers | Spinning bars and sliding blocks |
| 41–50 | Drift | Lanes sway sideways and squeeze together |
| 51–60 | Spin | The camera rotates 90° or 180°, and zoom pulses |
| 61–70 | Mirror | The view flips horizontally |
| 71–80 | Rush | Another jump in speed |
| 81–90 | Compass | The camera stops turning with you |
| 91–100 | The Hardest | Everything mixed |

## The view

- **Levels 1–5** are flat and top-down.
- **Levels 6–10** tip the road forward a little.
- **From level 11** it's a chase camera driving along the track. The track rolls over hills, and anything beyond a crest is hidden until you get over it. Each world tilts lower and has bigger hills.
- **Haze** limits how far ahead you can see, and gets thicker in later worlds.
- **Dives (from level 41):** the camera drops right down to the road for a few seconds.
- The road floats above a neon grid floor that runs to a glowing horizon. From world 3 the floor and sky warp and colour-cycle, and speed surges and deaths kick in lens wobble and colour fringing.
- Spins roll the whole view, horizon included, and mirror flips still flip it.

Hills and the camera are purely visual: collisions and the bot checks work on the flat track underneath. Each level's tilt, hills and haze come from `viewFor()` in `js/levels.js`.

## Lane colours

Every lane keeps one colour for the whole level, counted from the left at the
start line: blue, yellow, cyan, purple, green, white, lime. A level has 3 to 7
lanes and uses that many colours. None of them are red, orange or pink, which
belong to lasers and dead ends, sweepers and sliders, and your dot. Colours stay
with their lanes, so they still work when the view spins or mirrors.

Where you can't see the way in time, the colour of the lane to take flashes up:

- the hop onto the safe side of a split, before the other side runs out;
- from level 7, every hop through a section with a laser in it.

| What you see | Meaning |
| --- | --- |
| The screen edge glows steadily in a colour, and that lane glows on the track | Get ready. That's your next lane, but the obstacle before it may still be ahead. |
| The colour flashes | The hop window is open. Hop now. |
| The glow dims | You're on it |

Each cue hands straight over to the next, so a run of called hops reads as a run
of colours. Colours and timings are in `js/cues.js`, and `tools/verify-levels.js`
checks that every cue points at a lane that's there when you land.

## VEX

VEX's messages during play are switched off for now. They were too much to read
while hopping, so the lane colours do the guiding. VEX still has a line on the
title, pause, game-over and results screens. To bring the in-play messages back,
set `VEX_IN_PLAY` to `true` in `js/game.js`. With it on, `js/vex.js` decides
what VEX says and when:

- **Lines fit the level.** Every line is tagged with what it refers to (lasers, blinking lasers, sweepers, sliders, bends, splits, spins, mirrors, drift, surges), so VEX only jokes about things that are actually there. Death lines know what killed you, and if you take the dead-end side of a split after VEX told you the way, it says so.
- **Timing.** A short "typing…" indicator, then about 80 characters a second, then time to read at roughly 200 words a minute. Each message shows between 2.2 and 9 seconds, and a bar under it drains as its time runs out. The bubble is sized for the whole message before it types, so it never jumps around.
- **Tips are small.** Tips (and the world intros that explain each new mechanic) show in a compact lime bubble with a TIP tag. The wording is a short call, the same every time: "Speed surge incoming.", "Go left.", "Spin incoming." Every split and mirror flip gets a tip; spins, camera locks and surges get one warning per level.
- **Laser routes, from level 7.** Lasers hide which lane is safe, so VEX calls the path before you reach it: "Far right, then inside, inside again." Hop off that path and it says "What do you think inside means? Muppet." Dying on the wrong lane gets the same line.
- **How much VEX talks.** One or two chat lines per level, then only tips. Chat lines never sit on top of a tip. From world 5 they can pop up on either side of the screen; tips stay on the left.
- **Chat lines don't repeat within a run.** VEX remembers every chat line it has shown, and that memory is saved with the run. Tips are allowed to repeat, because they're the same short call each time. If the jokes run out in a very long marathon, VEX goes quiet rather than repeat a chat line.
- **It knows your numbers.** It can quote:
  - your attempts at this level
  - lives lost, in total and on this level
  - distance travelled and your average per life
  - your run number and best run
  - your toughest level, your falls versus hits, and how many hops you've pressed

Add lines by editing the arrays at the top of `js/vex.js`. Lines in
`STAT_LINES` can use `{placeholders}` and a `need` condition that says when the
line makes sense.

## Stats

Distance is measured in metres (20 world units per metre) and replaces the timer.
The title screen shows the headline numbers, and **All stats** lists everything:

- highest level and best run distance
- total distance and average distance per life
- longest life
- lives lost, split into falls and hits
- your toughest level
- runs started, levels cleared and hops pressed
- time played, wins and fastest full run

The data is saved in `localStorage`:

- `whg.stats.v1` holds the stats.
- `whg.run.v2` holds the survival run in progress.
- `whg.marathon.v1` holds the marathon run in progress.

Each saved run includes what VEX has already said.

## Leaderboards

When the game can reach the server, the title screen offers a nickname and a
**Leaderboards** button. Runs started with a name are ranked. Without the server
(the claude.ai link, no connection, or the game opened as a file) everything works
as before, just unranked.

**Boards:**

| Board | Ranks by |
| --- | --- |
| Survival | Furthest level on 3 lives, then distance |
| Marathon | Fewest lives used to finish all 100 levels |
| In progress | Marathons still going: furthest level, then fewest lives |
| Distance | Total distance travelled, all modes |
| Lives lost | Total lives lost (a hall of shame) |
| Toughest levels | Levels that have killed the most players |

**Replay check.** The simulation runs in fixed ticks of 1/240 s, and the game
records the tick of every hop. After each attempt it sends that log to the server.
The server re-runs the level with the same `js/levels.js`, so:

- a clear only counts if the replay reaches the finish;
- deaths always count;
- distances come from the replay, not from the game.

A clear that only just fails is re-run with every hazard half a unit smaller, so a
tiny floating-point difference between a phone's browser and the server can't
reject a genuine run.

**Ranked rules:**

- The server is the source of truth for level and lives.
- Leaving a level part-way costs that life, whether you quit or the app closes.
  Otherwise you could quit just before a death and retry for free.
- Quitting during the countdown, before the dot moves, is free.
- Unranked runs keep the old rule: quitting is always free.

**Identity.** A nickname plus a random secret kept on the device. The server stores
only a hash of the secret. Nicknames are unique regardless of capital letters.

**Levels version.** `VERSION` in `js/levels.js` tags every ranked run, and the
boards only show runs on the server's current version. Bump it whenever levels or
the simulation change, so old scores from different levels don't mix with new ones.

**API:**

| Endpoint | Purpose |
| --- | --- |
| `POST /api/players` | Register a nickname |
| `GET` / `PATCH /api/players/me` | Your ranks, totals and name |
| `POST /api/runs` | Start a ranked run |
| `POST /api/runs/:id/attempts` | Start a try at a level |
| `POST /api/attempts/:id` | Send the result: clear, death, quit or cancel, plus the hop log |
| `GET /api/boards/:name` | A leaderboard |

**Checks:**

```bash
cd server && npm test
```

That runs the replay tests: genuine clears pass, while dropped hops, late hops and faked clears fail.

```bash
node server/scripts/smoke.js http://localhost:8080
```

That runs an end-to-end check against the running server.

**Data** lives in the `whg_db-data` Docker volume. Postgres is reachable from this
computer only, on port 5433 (user and database `whg`). Before putting the server
anywhere public:

- copy `.env.example` to `.env` and set a real `POSTGRES_PASSWORD`;
- serve it over HTTPS behind a reverse proxy, which also makes the game installable.

## Race

Up to 4 players on the same Wi-Fi race the same levels at the same time. The first to clear the final level wins.
It needs the Docker server, and every racer needs a leaderboard nickname.

1. The host taps **Host** on the title screen and gets a 4-letter room code.
2. Everyone else opens the address shown in the lobby, for example `http://192.168.8.158:8080`,
   taps **Join** and types the code.
3. The host picks the start level, the race length (3, 5, 10 or 20 levels) and the
   checkpoints (every level, every 3 or every 5), then taps **Start race**.

**Rules:**

- Everyone counts down to the same moment, then runs the same levels.
- Lives are unlimited, but dying sends you back to your last checkpoint. Checkpoints are the race's first level and then every 1, 3 or 5 levels after it.
- Rivals on your level show as see-through dots in their colours.
- A bar under the HUD shows how far through the race everyone is.
- The colour cues work the same as in solo play.
- Races are never ranked, and they don't touch your saved solo runs.

**Phones.** Locking the screen or switching apps drops a phone's connection.
The game reconnects on its own and takes its old place back. Deaths and a finish
from while it was offline still count. A race with nobody connected waits 5 minutes
for its players, then closes. Windows Firewall may ask to allow Docker or Node the
first time a phone connects. Allow it on private networks.

**How it works.** Races run over a WebSocket at `/ws` on the same server. Rooms
live in memory, so restarting the server ends any race in progress, and nothing
about a race is stored in Postgres. Each racer sends its position 10 times a second, and
the server passes everyone's on to everyone. Each racer's own game decides
when it dies or finishes, the same as an unranked solo run.

```bash
node server/scripts/race-smoke.js http://localhost:8080
```

That plays a whole race with two scripted players: host, join, start, positions, a death, a dropped connection and a rejoin, the finish, and race again.

## How it's built

| File | What it does |
| --- | --- |
| `index.html` | Page markup: HUD, VEX's bubble, buttons and menus |
| `style.css` | Look and layout |
| `js/levels.js` | Level generator, speed and timing, collision and run simulation. Has no DOM access, so Node can load it. |
| `js/level-worker.js` | Runs the generator in a background thread so building a level never stalls a frame |
| `js/cues.js` | Lane colours, and the colour cues that show which lane to take |
| `js/vex.js` | VEX's lines and the schedule of what it says in each level |
| `js/render.js` | WebGL renderer: shader background, one additive glow batch, and a post pass |
| `js/game.js` | Game flow, input, stats, camera, and the demo that plays behind the menus |
| `js/online.js` | Leaderboard client: nickname, ranked runs and boards |
| `js/race.js` | Race client: the WebSocket to the server's `/ws` |
| `server/` | Leaderboard API and races: `src/app.js` (routes and board queries), `src/replay.js` (replay check), `src/race.js` (race rooms over WebSocket), `migrations/` (Postgres schema), tests and smoke scripts |
| `docker-compose.yml` | Postgres plus the Node server |
| `tools/serve.py` | Game-only local server with caching off |
| `tools/verify-levels.js` | Beatability check for all 100 levels |
| `sw.js`, `manifest.webmanifest`, `icon*` | Offline support and the home-screen icon |

**Rendering.** Everything bright is a quad in one additive WebGL draw call. The
fragment shader turns each quad into a neon tube or orb, so glow costs nothing
extra. The background is a full-screen shader, and a post pass adds lens warp,
colour fringing, vignette and flashes. Resolution drops automatically if frames
run long, and each frame is capped at about 3.2 megapixels. Level 95 measured
60 fps using about 0.7 ms of JavaScript per frame. New visual effects belong in
the shaders in `js/render.js` (`FS_BG` for the world, `FS_POST` for the whole
screen) and in `updateFx()` in `js/game.js`, which feeds them per-frame values.

## Every level is beatable

Each level is built around a planned route. Gaps never cut it, and every hazard
is checked against it with extra clearance: 10 units of space and 0.08 s of
timing. `tools/verify-levels.js` proves it by playing all 100 levels with 27 bots
each: one that hops early, one that hops at the last possible moment, and 25
that hop at random points in each window.

```bash
node tools/verify-levels.js
```

Run it again after changing anything in `js/levels.js`.
