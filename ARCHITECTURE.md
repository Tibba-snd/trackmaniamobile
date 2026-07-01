# DRIFTDREAM — Architecture

Verified against the source on 2026-06-24. Where a subsystem has a central tuning table,
**that table in the code is the source of truth** — this doc points to it (`file:line`) rather
than copying every constant, so the doc cannot silently drift. Headline numbers quoted here are
marked with their location; if you change the code, you do not need to mirror it here unless the
*behavior/contract* changes.

The whole game is one global object `DD`, populated by the `js/` files in their load order
(`core → theme → trackgen → physics → audio → input → scene → game`). `core`, `theme`,
`trackgen`, `physics` are **Three-free** and run under Node (that's what the tests exercise).

---

## 1. Boot & main loop (`js/game.js`)

`DD.boot` (`game.js:710`) reads URL params (`testMode`, `seed`, `tier`, `autodrive`,
`duration`, `mockKeys`), loads the save, creates the renderer/scene/camera/composer, wires all
menu/HUD/touch/settings handlers, kicks off audio on first input, and starts `requestAnimationFrame(loop)`.

**State machine** (`G.state`): `menu` · `loading` · `countdown` · `play` · `finish` · `garage`. Screen entries are animated with CRT-style horizontal/vertical scale-up expansion (`screen-boot`) and a terminal flicker boot (`boot-flicker`).

**Scrambler dial-in animation** (`dialInText`, `game.js`): Generatively dials in seed coordinates and destination plates on the loading screen, campaign preview, and finish card using character scrambling.

**HUD Instrument Cluster & Telemetry Visuals**:
- **Entry Streaks**: HUD cards (`#hudLeftBox`, `#hudMedals`, `#hudSpeedBox`) slide in from screen margins with high-speed skewing translations (`streak-in`) relative to travel direction when resetting or starting a run.
- **Odometer Digit Roll**: Speed changes and timer seconds ticks apply a brief vertical bounce and sub-pixel blur animation (`.digit-change`) to the numbers to simulate mechanical split-flap dials.
- **Segmented LED RPM & Shift Light**: The RPM bar uses a slanted repeating gradient mask to resemble individual LED segments. A neon red `SHIFT` indicator blinks above the gear glyph near redline using a parent-selector `:has(#hudRpmBar.redline)` rule. The `::before` carries **no `transition`** — pseudo-element transitions freeze at their start value on the WebView/Electron engine, so the indicator must snap to its redline state (verified session 8). `#gameButtons` (restart/respawn/exit) is offset **below** `#hudLeftBox` so its `z-index:6` icons don't paint over the live timer.
- **Continuous Delta Ribbon**: Measures the player's live time against precomputed ghost times for each track sample, rendering a continuous green (ahead, left-sided) or red (behind, right-sided) ribbon (`#hudDeltaRibbon`) below the timer.
- **Medal Timing Tower**: Target times are stacked vertically in `#hudMedals`. The current target active row is dynamically scaled and highlighted, while missed target rows are dimmed and crossed out.
- **RPM Breathing Glow**: Syncs `#hudSpeedBox` border color alpha and shadow glow intensity (`--rpm-glow-opacity`) to the engine RPM, breathing at a frequency that speeds up from 3 rad/s (at idle) to 15 rad/s (at redline).
- **Checkpoint Sector Flashes & Alerts**: Crossing a checkpoint ahead of the PB ghost triggers a purple sector flash (`.purple-flash`) on `#hudLeftBox`. Beating the PB at the final checkpoint before finish displays a centered "FINAL SECTOR" scale-and-glow alert.
- **PB Celebration**: Beating the personal best triggers a white-to-accent overlay flash animation (`pb-flash-overlay`) and runs a rotating border gradient color animation (`gold-glow-flicker`) around the finish stats card.

**Fixed-timestep loop** (`loop`, `game.js:211`):
- `dtReal = min((t - lastT)/1000, 0.1)`.
- `menu`/`garage`: orbit camera around the showcase car, animate celestial/iridescent bits, flicker emissive environmental elements, render, return.
- `play`: accumulator `G.acc += dtReal`; steps `DD.stepCar` at fixed `DD.TICK` (1/60) up to **4 substeps**,
  then `G.acc = 0` as a spiral-of-death guard. Render uses interpolation between
  `prevPos/prevYaw` and the current state by `alpha = acc/TICK`.
- Ghost is recorded every `recEvery = 2` ticks (1/30 Hz) and replayed with lerp.
- Updates visual FX beds: speed lines, smoke, tires, and sparks (which dynamically toggle between wall hits and drift sparks).
- Detects **clean drift releases** (transitions from active drift to grip without wall impacts) and triggers a fullscreen bloom flash (`G.driftFlash = 1.0` decaying by 5.0/sec).
- Scales composer bloom strength dynamically based on speed creep (creep starts above 60% of max speed) plus active drift release flashes.

**Save** (`core.js:105`): single `localStorage` key `driftdream_v1` holding `{ settings, garage,
tracks, meta }`. `persistSave` is a no-op in `testMode`. Per-track record: `{ pb, splits, ghost,
medal, attempts, lastPlayed }`.

**Ghosts & Precomputed Delta Replays** (`game.js:58, 75`): frames are `[x,y,z,yaw]` Float32, base64-encoded for storage,
pruned to the 40 most recently played (`pruneGhosts`). Precomputed target split times are mapped to each track sample index when generating the track (`precomputeGhostTimes`) to run continuous ghost delta computations with zero runtime search overhead.

---

## 2. Core (`js/core.js`)

- **RNG:** FNV-style string hash → `mulberry32`. `DD.makeRng(seedStr)` returns
  `{next, range, int, pick, chance, sign, weighted}`. All procedural generation derives from
  seed-suffixed RNGs (e.g. `seed + '::theme'`, `seed + '::track::t{tier}::a{attempt}'`).
- **Vectors:** `DD.v` (alias `V`) — `[x,y,z]` arrays. **Every op allocates a new array** (pure,
  good for determinism; a known per-frame allocation cost in the render path — see STATUS).
- **Seeds:** `randomSeedString` → `DREAM-XXXXX`; `dailySeedString` → `DAILY-YYYYMMDD`.
- Helpers: `clamp`, `lerp`, `smoothstep`, `dampTo` (frame-rate-independent exponential),
  `angleDiff`, `formatTime`, `formatDelta`.

---

## 3. Theme (`js/theme.js`)

`DD.makeTheme(seedStr)` produces a per-seed visual identity object.

- **Biome** (`dune` / `neon` / `canyon` / `frozen`) drives accents, ground, fog, weather, motifs,
  terrain amplitude. For `CAMP-` seeds the biome is **forced by tier** (T1 dune, T2 neon,
  T3 canyon, T4 frozen, T5 neon) (`theme.js:40`).
- **Emotion & Time-of-Dream:** Each biome has a defined aesthetic mood and cycle phase:
  - `dune`: Solitude / Dusk
  - `neon`: Euphoria / Midnight
  - `canyon`: Wonder / Twilight
  - `frozen`: Serenity / Dawn
  These parameters are bound into `theme.emotion` and `theme.timeOfDream` and are shown on the track selection UI.
- **Sky** is always a warm dusk gradient (`skyHorizon` peach → `skyBand` lilac → `skyTop` deep
  blue), computed within fixed HSL bounds so the sky-validator test passes (`theme.js:52-68`).
- Returns: sky colors, `accent`/`accent2`, `groundColor`, `trackLow/High`, `glassColor`,
  `boostColor`, fog near/far, `motif`/`motif2`, `atmosphere`, `surfaceLook`, `decorDensity`,
  `terrainAmp`, `terraced`, `lightAngle`, `wet`, `emotion`, `timeOfDream`.
- **UI Biome Recoloring** (`applyCssTheme`, `game.js`): Maps the generated biome theme accents and sunset horizons into dynamic CSS custom properties (`--accent`, `--accent2`, `--warm` and their `-rgb` equivalents). These variables style borders, text shadows, gradients, and backgrounds across all menus, buttons, inputs, and HUD panels.
- **`DD.GARAGE`** (`theme.js:186`): the cosmetic option lists (gradients/finishes/forms).

> ⚠️ **Dead code:** the top-level `PALETTES` array (`theme.js:17`) is **not used** by
> `makeTheme` — themes are built from the biome branches, not from `PALETTES`. `MOTIFS`/`ATMOS`/
> `SURFACE_LOOKS` are only partially used (biomes override `motif`). Earlier docs described
> `PALETTES` as the active palette system; it is not.

---

## 4. Track generation (`js/trackgen.js`)

`DD.generateTrack(seedStr, tier, attempt)`:

1. **Piece grammar.** 6 archetypes (`speedway/technical/rhythm/drift/vertical/mixed`) each with a
   weight table (`WEIGHTS`, `trackgen.js:15`) over ~14 piece builders (straight, sweeper, hairpin,
   tighten, chicane, banked, crest, dip, kicker, jumpgap, glass, boost, wallride, weave).
   `makePieces` (`trackgen.js:32`) scales width/sharpness by tier.
2. **Incremental integration** at `DS = 2 m`/sample, with an **occupancy grid** (cell size 22)
   for self-intersection avoidance — each piece tries up to 3 alternates, else flags
   `overlapForced`.
3. **Pacing curve** (`trackgen.js:401`): flowing start (0–30%), technical middle (30–75%),
   fast finish (75–100%) re-weight the grammar. **Signature set-piece** injected at 40%
   (`gorge` / `corkscrew` / `ice_slalom` / `void_extreme`), tier-mapped for `CAMP-` seeds.
4. **Anticipation braking straights** inserted before fast-arriving tight corners (`trackgen.js:434`).
5. **Frames:** per-sample `f`/`u`/`r` basis (forward/up/right) with banking applied.
6. **Checkpoints** every ~340–460 m; `startIdx = 2`, `finishIdx = len-3`.
7. **Corner detection** (`trackgen.js:478`) for signage/beacons.
8. **Terrain basin** — see below.

`DD.buildValidTrack(seedStr, tier)` (`physics.js:547`): generates up to **6 attempts**, rejects
self-intersecting layouts, runs the headless bot, and accepts the first run that is clean
(`respawns === 0`, `ms > 25 s`). Medals: `author = round(bot.ms * 0.82)`, `gold = author*1.10`,
`silver = author*1.25`, `bronze = author*1.55`. **Fallback** (no clean run in 6 tries):
medals estimated from `length/28` and `attempt = -1` (a coarser, different basis — see STATUS
re: medal-difficulty consistency).

`DD.trackQuery` (`trackgen.js:517`) is a local nearest-sample search in a small index window
around the last known sample.

### Terrain (`buildTerrainData`, `trackgen.js:148`)
A `RES = 120` × 120 value-noise heightfield covering the track AABB + 340 m margin. Heights are
clamped to stay **≥8 m below the lowest track point**, then locally raised toward the road
underside near the ribbon (embankments) and pushed **down** under `gap` segments. `DD.terrainAt`
/ `DD.terrainNormal` bilinearly sample it. This pass does a per-cell nearest-sample scan twice —
it is the main load-time cost (see STATUS).

---

## 5. Physics (`js/physics.js`)

**Single source of truth for tuning: the `DD.PHYS` table at `physics.js:12`.** Fixed `TICK = 1/60`.

A **two-axle slip model** (front steers, rear drives) with **two regimes**:

- **Grip regime** (default, ~95% of driving): a grip-capped proportional yaw target — stick
  position maps to a fraction of the corner, and pure throttle can never spin the car. Slip
  dynamics are bypassed. (`physics.js:346-352`)
- **Slide regime** (only when *asked*: drift button, brake-tap, low-speed wheelspin, or ice):
  full lateral-force integration with a smooth saturating tire (`tire()`, no grip cliff),
  slide-state hysteresis (`slideEnter 0.15` → `slideExit 0.07` rad), and a continuous
  **auto-countersteer assist** that catches *unwanted* breakaways. (`physics.js:353-362`)

Other systems in `stepGrounded` / `stepAirborne`:
- **Steering** ramps like a wheel; max lock interpolates `steerMaxLow→steerMaxHigh` with speed.
  An invisible **traction-limited steering** assist caps *useful* lock with soft overdrive past
  the band (disabled when the player asks for a slide) (`physics.js:304-319`).
- **Gearbox as puzzle** (`updateGear`): 6 gears, shift cuts (up `0.10 s`, down `0.26 s`), torque
  rising with rpm; scrubbing speed mid-corner forces a downshift = dead exit.
- **Friction circle / weight transfer:** brake/throttle modulate front/rear grip; power-oversteer
  only at low speed; longitudinal drive is traction-limited against the rear's base grip.
- **Surfaces** (`DD.SURF`: NORMAL/GLASS/BOOST/DIRT): glass = near-frictionless ice, boost = extra
  accel, dirt = reduced grip/accel + drag, terrain = drivable heightfield.
- **Air** (`stepAirborne`): brake stabilises rotation, steer spins; throttle/brake set landing
  pitch; landing keeps speed proportional to nose-alignment (`landKeepMin`).
- **Walls/shoulders:** `postWallClamp` (`physics.js:450`) reflects off rails with bounce/friction.
- Outputs consumed by render/audio/HUD: `pos, yaw, vel, gear, rpm01, shiftCut, sliding, slideState,
  slipMax, onDirt, grounded, suspY/suspV, wheelAngle, hitWall, justLanded, boostGlow, justCkpt,
  fellOff, finished, splits, time`.

**Headless bot** `DD.getBotInput` (`physics.js:466`): braking-distance-aware target speed from
look-ahead curvature (accounts for grip, bank, downforce, ice), pure-pursuit aim, and a
heuristic brake-tap drift on tight corners above 28 m/s. `DD.runBot` drives it to completion for
validation/medals and detects "stuck".

---

## 6. Rendering (`js/scene.js`)

The largest module (~2170 lines): renderer, post-FX, sky, terrain mesh, ribbon, all decor,
particles, the car, the camera, and procedural textures.

- **Renderer** (`scene.js`): `ACESFilmicToneMapping`, **exposure `0.78`**, sRGB output, pixel-ratio capped at **1.5 (high)** / 1.25 (else), antialias off on `low`.
- **Composer & WebGL2 MSAA** (`scene.js:77`): `null` (direct render) on `low` or if passes are missing. HDR HalfFloat target. **WebGL2 multisampling** is explicitly requested and active (`samples: 4` set on the render targets). `UnrealBloomPass` **strength 1.25** (with speed-based creep and drift release surges up to ~3.0), **radius 0.65**, **threshold 0.85**. **FXAA** (`js/lib/FXAAShader.js`) is the **final pass** for edge AA. Composer pixel ratio is locked to the renderer's pixel ratio.
- **Lighting — DYNAMIC LIGHT POOL** (`addLightSource` / `DD.updateLightPool`, `scene.js`): every real-time light is shaded per-pixel. To optimize fill cost, decor elements register light data via `addLightSource`, and a fixed pool of PointLights (**12** on high quality, **8** on medium) snaps to the nearest active sources to the camera each frame. Ambient hemisphere light is raised to **0.45** to ensure areas between lights are not pitch black. Sun directional light is the only shadow caster.
- **Environment** (`captureEnvironment`, `scene.js:164`): CubeCamera captures the sky+world at the start line. The target size is reduced to **16** to naturally blur the environment map (acting as a pre-filter) to produce broad, soft specular highlights instead of jaggy razor highlights. PMREM Generator converts this into physically-correct lighting layers.
- **Sky**: gradient shader sphere + soft sun disc; **stars** as `THREE.Points` always present; optional nebulae/planet/horizon mountains (skipped on `low`).
- **Ribbon & Asphalt** (`buildRibbon`, `scene.js:795`): `MeshStandardMaterial` with procedural normal + roughness. To soften wet reflections and resolve specular shimmer at the source, wet asphalt roughness is raised to **0.62**, normal-map scale is reduced to **0.06** (wet) and **0.12** (dry), and `envMapIntensity` is softened to **0.85**.
- **Asphalt Texture Generator** (`getAsphaltRoughnessTexture`, `scene.js:1850`): procedurally generates a roughness map. The minimum roughness floor inside the generator is raised to **0.55** to prevent razor mirror reflection spots.
- **Decor**: edge-glow strips, rails, boost/glass overlays, gates, corner signs, light poles, neon props, support pillars, neon arches, and emissive elements.
- **Instanced Emissive Elements** (`buildEmissiveElements`, `scene.js:1099`): places instanced environmental elements tailored per biome (dune obelisks, neon cyber-pylons, canyon octahedron crystals, frozen cones/spikes). Placed via seeded RNG to be denser near corner apexes. Exactly one massive "hero" monolith is spawned 450m out on the horizon. The first 8 elements close to the track register as pool lights. Emissive intensity flickers collectively inside the game loop to simulate a pulsing energy field.
- **Car** (`buildCar`, `scene.js:1950`): F1 single-seater built from garage specs. PBR `MeshPhysicalMaterial` (clearcoat) body, carbon weave texture map, transmissive cockpit.
- **Shadows**: PCFSoftShadowMap enabled on high/medium. Only the sun light casts shadows (size 1024), tracking the car position. SDF contact shadow mesh is projectable under the car.
- **Camera** (`updateCamera`, `scene.js:2476`): chase cam looking ahead. Target FOV widens with speed (`63 + sv * 34`), adding a non-linear speed-creep wrap above 75% speed: `(sv > 0.75 ? Math.pow(sv - 0.75, 1.5) * 20 : 0)`.
- **Particles**: trail, speed lines, smoke, sparks, weather, fireflies. On drift, sparks spawn from both rear wheel contact points, shooting backward/outward, and the track skidmark ribbon fades to a high-intensity blazing neon trail (intensity **1.8** on drift, **0.2** on straight).

---

## 7. Audio (`js/audio.js`)

Pure Web Audio synthesis, no samples. Engine = 2 detuned saws + sub sine + filtered noise through
a lowpass; frequency/cutoff/volume tracked from the **physics** gear + `rpm01` via `setTargetAtTime`
(no zipper noise). Plus wind, tire screech, dirt rumble noise beds, theme-derived ambient pads
(`startPads`), and `blip`-based sfx (checkpoint chimes, finish fanfare per medal, respawn, click,
countdown). `updateEngine`/`updateSurfaceAudio` are called each frame from the loop.

---

## 8. Input (`js/input.js`)

`DD.pollInput(settings)` resolves a `{steer, throttle, brake, drift}` each frame:
- **Keyboard** is always live (arrows/WASD, **Space = drift**, R = restart, E = respawn).
- **Tilt** (`deviceorientation`, landscape-aware) → analog steer, `±22°/sens` = full lock,
  calibrated to a neutral captured on race start.
- **Touch** pads (`bindTouch`) set throttle/brake, a **DRIFT** pad (`state.touchDrift`), and
  **binary** steer (`±1`). Layout is split: steering ◀ ▶ on the left thumb, gas/brake/drift on the
  right. Two-finger tap on the canvas = restart (`bindCanvasGestures`).

> ⚠️ Reality gap (see STATUS): **touch steering is still binary** (no analog magnitude), so the
> physics' fine steer modulation is invisible to touch players — tilt is the only analog steer.
> _(The former "no drift on touch" gap is fixed — the DRIFT pad reaches the dedicated-drift entry.)_

---

## 9. Tests (`tests/`)

- `drivability.js` — headless physics assertions (slalom, donut, braking, grip ladder).
- `verify_determinism.js` — identical results per seed across runs.
- `verify_colors.js` / `verify_sky_stars.js` — color-space, sky gradient, star placement.
- `verify_camera.js` — chase-camera behavior.
- `verify_m2_features.js` — presence of required car/scene meshes.
- `e2e_runner.js` — host-only: launches Chrome via CDP, runs deterministic `mockKeys` inputs,
  screenshots at tagged `[TEST]` log lines, pixel-diffs against `screenshots/golden/`.
- `e2e_runner.js -u` — update golden references after intended render changes.
