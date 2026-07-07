# DRIFTDREAM — Status & Known Issues

_Last verified against code: 2026-06-24._

Read [`README.md`](README.md) first (run/build/controls), then [`ARCHITECTURE.md`](ARCHITECTURE.md)
(how each system works, with `file:line` references). This file is the **current state + the
backlog** — the things a new contributor (human or AI) most needs to know before changing anything.

---

## Where the game is now

**Playable and feature-complete as a single-player time-attack racer.** Solid and not worth
rebuilding:

- **Physics** (`js/physics.js`) — deterministic 60 Hz two-regime model (planted grip + opt-in
  slide), gearbox with shift cuts, downforce, jumps, dirt, ice, walls. `tests/drivability.js`
  passes. This is the most finished part.
- **Track generation** (`js/trackgen.js`) — seeded piece-grammar, pacing curve, signature
  set-pieces, self-intersection avoidance, terrain basin, checkpoints, corner detection,
  bot-derived medals.
- **Visuals** (`js/scene.js`) — this is largely **done**, contrary to the old status notes:
  sculpted PBR F1 car (4 forms × 5 finishes × paint gradients), env-mapped reflections, gradient
  sky + stars + nebulae + planet + horizon mountains, neon edge-glow/rails/arches/poles/props,
  procedural asphalt, hybrid shadows (directional light shadows + SDF contact shadow), ACES + HDR bloom, weather (rain/snow/dust), and
  particle FX (trail, speed lines, smoke, sparks, fireflies).
- **Structure** — menus, campaign (5×10, medal-gated), garage, settings, daily/random/seed,
  ghosts (record/replay/prune), PB storage, HUD (Azeret Mono numbers, Chakra Petch display text, notched corner cards, timing tower target medals, continuous delta ribbon, segmented slanted RPM bar with shift-light flash, dynamic RPM-synced breathing glow, entry streak-in skew animations, odometer-style ticks on timer seconds/speed, purple checkpoint flashes, final sector alerts, and PB finish celebrations),
  synth audio, input (keys/tilt/touch), and a `testMode` for deterministic e2e.

---

## Known issues & reality gaps

These are real today (the code, not the marketing). Roughly high→low impact.

### Controls / feel (mobile is the stated target, and it's the weakest area)
1. **[RESOLVED 2026-06-23]** ~~No drift control on touch or tilt.~~ A dedicated **DRIFT** pad was
   added (`index.html` `#padDrift`, wired through `DD.bindTouch` → `state.touchDrift` → `pollInput`).
   It shows in both touch and tilt modes, so the dedicated-drift entry is now reachable on mobile.
2. **[RESOLVED 2026-06-23]** ~~Touch ergonomics overloaded on the left thumb.~~ Pads re-split to the
   standard layout: **steering (◀ ▶) on the left thumb; GAS / BRAKE / DRIFT on the right thumb**
   (`index.html` `.pad` positions). Verified you can now brake + steer simultaneously.
3. **Touch steering is binary** (`±1`, `input.js`). The physics' progressive tire/steer
   modulation is invisible to touch players. Tilt is the only analog steer. _(still open)_
4. **[RESOLVED 2026-06-23]** ~~Camera follows the car nose, not its travel direction.~~
   `updateCamera` now blends the follow direction from the nose toward the surface-projected
   **velocity** by slip angle (up to 60% at ~40° of slip), so the screen trails where you're going
   during a drift. Deterministic (derived from `car.vel`, no `Math.random`).
5. **[RESOLVED 2026-06-23]** ~~No camera impulse/shake.~~ `updateCamera` now adds a quick decaying
   positional kick — down along the surface normal on a hard landing (scaled by fall speed), back
   along travel on a wall hit (`car.hitWall`) — plus a FOV punch on boost pads (`car.boostGlow`).
   All directions are deterministic.
6. **No haptics** anywhere (`navigator.vibrate` unused) — free mobile feedback on
   checkpoint/crash/medal. _(still open)_
7. **[RESOLVED 2026-06-23]** ~~Forced 3.2 s countdown on every restart.~~ `resetRun(fast)` now uses a
   **0.8 s** countdown on retries (R key / two-finger tap / restart + retry buttons) and keeps the
   full 3.2 s only on first track load.
8. **No wall-impact sound** — sparks spawn on `hitWall` (`game.js`) but `audio.js` has no thud. _(still open)_

### Performance (mobile)
9. **[RESOLVED 2026-06-23]** ~~`backdrop-filter: blur()` over the live WebGL canvas during play.~~
   Blur removed from the in-race `.pad` touch controls and `.gbtn` buttons (bg alpha raised to keep
   them legible); the animated `#grain` is now hidden during active racing (`game` state) and kept
   only on the lighter menu/garage/finish screens.
10. **Per-frame allocations in the render path** — `poseCar` + `updateShadow` each allocate a
    `Matrix4` + `Vector3`s every frame (×2 for the ghost); the iridescent shimmer allocates a
    `THREE.Color` twice/frame (`game.js:251,383`); `DD.v` ops allocate arrays throughout. GC
    pressure → stutter on phones. Cache module-scope scratch objects.
11. **Car is ~40 separate meshes/materials, rebuilt fresh per track load; the ghost doubles it.**
    No geometry merging on the car yet. _(Decor instancing is now DONE — arches + support pillars are
    `InstancedMesh`; see "Resolved 2026-06-24". The car itself is the remaining merge candidate.)_
12. **Track + terrain generation blocks the main thread** (`buildTerrainData` does a 120×120 grid
    with a per-cell nearest-sample scan, twice; `buildValidTrack` runs the bot up to 6×). Hence the
    `setTimeout(…, 30)` before building. Candidate for a Web Worker or spatial-grid acceleration.

### Content / balance
13. **Medal difficulty is inconsistent** — `author = bot.ms * 0.82` off a simple pure-pursuit bot
    whose skill varies by track; the fallback path uses a different basis (`length/28`). Campaign
    seeds are fixed, so their times could be hand-baked instead.
14. **Single lap only** (`hudLap` hard-coded `LAP 1/1`).
15. **[RESOLVED 2026-06-24]** ~~Delta vs ghost only shows at checkpoints~~. Implemented continuous delta ribbon (`#hudDeltaRibbon`) below the timer, updating live in the loop by precomputing ghost times per sample index.

### Code health
16. **Remaining dead/inert code:** `theme.js` `PALETTES` array (`theme.js:17`) is unused (themes
    come from the biome branches). `SURFACE_LOOKS` values `shimmer`/`edgelit`/`solid` are inert —
    only `banded` changes the ribbon. `atmosphere` values `aurora`/`foggy` are still not rendered
    (only `starfield` is consumed, for star density). _(See "Resolved this pass" below for the
    integration gaps already fixed.)_
17. **`js/scene.js` is ~2000 lines** doing everything — the maintainability bottleneck. Candidate
    to split (render-core / car / decor / fx / camera).
18. **`apk-build/www/` is a synced duplicate** of the root game. Edits to `js/` don't reach the APK
    until `apk-build/sync.bat` runs.

---

## Resolved this pass — efficient-graphics batch + track feel (2026-07-07)

Agenda premise (see [[driftdream-perf-profile]]): the game is **GPU/fill-rate bound**, not geometry
bound — so spend richness in geometry/vertex space + per-material shader terms, and refuse new
fullscreen fill passes (DoF/SSAO stay deferred). Nine items across three batches, all verified.

**Batch 1 — car + reflection (visual, zero test risk)**
1. **Fresnel silhouette rim light** — grazing-angle emissive injected via `onBeforeCompile` in
   `makeCarMaterials` `bodyMat` (`scene-car.js`), on solid shells only (not ghost, not self-emissive
   glow slots). Traces the car outline against the dark bg; costs car pixels only. Deliberately a
   shader term, NOT a real light — sidesteps the light-pool / texture-unit limit
   ([[driftdream-light-pool]], [[driftdream-texture-unit-limit]]).
2. **Env cube 16→128** (`scene-core.js` `captureEnvironment`) — the reflected nebula/sky/terrain is
   legible now instead of mush. Rendered once at load (static furniture) so runtime cost ~0; PMREM
   still roughness-blurs for matte materials.
3. **Richness** — stars 950/1700 → 1300/2200; horizon mountains 3→4 parallax layers (+a 4th, darkest
   distance ring), 24→30 per ring.

**Batch 2 — road body + feel (visual)**
4. **Track girth** — new `buildRoadBody` (`scene-decor.js`): vertical side-skirt slab (drops 1.9m
   below each edge) so the ribbon reads as a raised deck, not a flat decal. 1 draw call, dark
   asphalt-side material, skips gap seams. Added right after `buildRibbon` in the orchestrator.
5. **Wall-hit camera kick removed** (`scene-core.js` `updateCamera`) — the `car.hitWall` positional
   shake + FOV punch read as jumpy, not impactful. Deleted; the landing kick is kept.
6. **Kerbs → 3D** — `buildKerbs` outer edge lifted 0.12 so rumble strips are beveled (catch light on
   the slope) instead of flat painted stickers.
7. **Godrays** — new `buildGodrays` (`scene-decor.js`): far-parallax additive light shafts near the
   sun azimuth, raking down. **depthTest stays ON** so foreground ridges/decor occlude the shaft
   bases — that occlusion is what reads as volumetric (vs a floating quad). Camera-followed like the
   planet. NOT a fullscreen post pass (fill-bound GPU).

**Batch 3 — physics/gen (Claude-owned; moves e2e goldens, headless suite still green)**
8. **Vertical smoothness** (`trackgen.js`): crest/dip hard-step pitch targets (`t<0.4 ? mag : …`)
   replaced with a C-∞ pulse `mag·sin(2πt)` — kills the derivative jump at piece seams that caused
   the visible vertical crease. `bumpA` undulation halved (0.015–0.05 → 0.008–0.022) + wavelength
   ~2× (22–55 → 40–80m) + chance 0.65→0.55 — the "weird wiggle" is now a subtle rolling surface.
   Jumps (kicker/jumpgap/bigjump) left sharp on purpose (snapPitch launch feel).
9. **Wall collision** (`physics.js` `postWallClamp`): new `P.carHalfW 0.8` capsule so the car BODY
   clamps at the wall, not its centre point (no clip-through / "bug out"). Reflection now fires ONLY
   when moving INTO the wall (`sign(vr)===sign(lat)`) — the old unconditional reflect oscillated
   clamp/bounce/re-clamp = the fling; tangential velocity is preserved so you scrape along.
   `wallBounce 0.22→0.08` (scrape, not pinball).

**Verified:** `node --check` all touched files; full suite green — **drivability 45/45**, determinism
(still deterministic → no headless re-baseline), colors 4500, m2 18, camera 21, sky, carspec 111.
Live: track builds (no NaN), `composer.render()` clean with every new shader/mesh (rim compiled, no
program errors), Batch-2 shot confirmed girth + godrays + layered horizon; 60fps / cpu 2.8ms / tris
173k (geometry adds cost ~0, as the fill-bound profile predicts). Cache-busters: **scene-core v58,
scene-decor v57, scene-car v58, trackgen v24, physics v29**.

**Still open:** human playtest of wall-slide + track-smoothness feel; e2e golden re-baseline on host
(`node tests/e2e_runner.js -u` — trackgen geometry + visuals moved); `apk-build/sync.bat`. Deferred
by design: DoF, SSAO (fill-heavy).

---

## Resolved this pass — integration gaps (2026-06-23)

Audit of "exists in code but never reaches the screen / never fires." Fixed:

- **Carbon fibre weave** — was only a `bumpMap` at `bumpScale 0.015` on a near-black material
  (invisible). Now a real colour `map` with higher-contrast twill, visible weave repeat, and
  `bumpScale 0.05` (`scene.js` `getCarbonTexture` + carbon material).
- **Biome decor motifs** — `mountains`/`pillars` fell through to a generic box; an `arches` branch
  no theme could trigger. Now each motif has a distinct silhouette (cone peaks / cylinders /
  octahedron crystals / spheres / slabs); dead `arches` branch removed (`scene.js` `buildDecor`).
- **`theme.motif2`** (secondary decor layer) — generated but never rendered. Now scattered as a
  sparse second pass.
- **Star density** — was a fixed `700` despite the comment; now varies with
  `theme.atmosphere==='starfield'` / `biome==='neon'` (`scene.js` `buildStars`).
- **`theme.ambient`** — generated but unused; now drives the hemisphere light intensity.
- **`car.boostGlow`** — physics computed/decayed it every frame with no consumer; now pulses the
  car body shell's emissive on boost pads (`game.js`, restores baseline so Neon Edge is unaffected).
- **Removed truly-dead code:** orphaned `getUnderglowTexture()` (underglow planes were deleted long
  ago), unused `car.justLanded` field (landing dip already comes from `suspV`), unused
  `track.botSplits`, and the dead `edgelit` ribbon variable.

Verified: `node --check` on all three changed files; `drivability` 27/27, `verify_determinism`,
and `verify_m2_features` 21/21 all pass (the m2 test exercises `buildCar` including these changes).
**Visually screenshot-verified 2026-06-23** (preview server now serves this root): carbon twill
reads on the floor/splitter; each biome's decor silhouette is distinct (dune cones / neon
cylinders / canyon teal crystal-shards / frozen cones + crystals, with `motif2` confirmed
rendering on frozen); neon/starfield carries 1400 stars vs 700 elsewhere; and the body shell
pulses cyan (`boostColor`) on boost pads. All four read well as-is — no follow-up fixes needed.

## Resolved this pass — controls, perf & camera (2026-06-23, session 2)

The agreed first batch + the camera follow-up are all **done and verified** (browser preview +
Node tests):

1. **Touch DRIFT pad + re-split layout** — steering on the left thumb, gas/brake/drift on the right.
   [#1, #2]  (`input.js`, `index.html`, `game.js`)
2. **Stripped `backdrop-filter` from in-race elements** + grain disabled during play. [#9]
   (`index.html` `.pad`/`.gbtn`, `game.js` `showScreen`)
3. **Fast restart** — 0.8 s retry countdown, full 3.2 s only on first load. [#7] (`game.js` `resetRun`)
4. **Camera velocity/heading blend + impulses** — follow trails travel by slip; land/hit/boost kicks. [#4, #5]
   (`scene.js` `updateCamera`)

Tests after these changes: `drivability` 27/27, `verify_m2_features` 21/21, `verify_camera` 21/21,
`verify_determinism` all pass, `verify_colors` 4500 pass. Cache-busters bumped (`input v16`,
`scene v26`, `game v22`) and `apk-build/www/` re-copied (run `npx cap sync android` on a build host).

> ⚠️ **e2e goldens:** the camera change intentionally alters in-drift framing, so
> `tests/screenshots/golden/` will diff. Re-baseline on the host with `node tests/e2e_runner.js -u`
> after eyeballing the new framing.

## Resolved this pass — world and terrain shadows (2026-06-23, session 3)

1. **Hybrid Shadow System**: Enabled Three.js shadow mapping (`PCFSoftShadowMap`) on high/medium quality settings. Directional `sun` light casts shadows.
2. **Mesh Shadows**: Added shadow casting and/or receiving to terrain, road ribbon, monoliths/decor instanced meshes, support pillars, light poles, arches, and the car.
3. **Dynamic Light Tracking**: Programmed the `sun` directional light and target to follow the car's position in the game loop to optimize shadow resolution and coverage.
4. **Custom SDF Contact Shadow**: Retained the custom SDF shadow plane underneath the car for micro-level wheel grounding.

Tests after these changes: `drivability` 27/27, `verify_m2_features` 21/21, `verify_camera` 21/21, `verify_determinism` all pass. Cache-busters bumped (`scene v27`, `game v23`).

## Resolved this pass — perf, lighting & AA (2026-06-24, session 4)

Started from a **rendering regression**: another tool had set the per-arch arch spotlights to
`castShadow = true`. With arches every ~80m that put dozens of shadow-map samplers into every
standard material's fragment shader, overflowing `MAX_TEXTURE_IMAGE_UNITS(16)` → all standard
materials failed to compile → car/track/terrain rendered untextured (only additive glows survived).
Fixed, then did a full perf + look pass:

1. **Dynamic light pool** (`scene.js` `addLightSource` / `DD.updateLightPool`) — replaced **~122
   real-time decor lights (92 point + 30 spot)** with a **fixed pool of 12 (high) / 8 (medium)**
   PointLights that snap to the nearest registered sources each frame (called from `game.js` loop).
   Decor glow is the additive sprites + bloom; only the sun casts shadows now. Forward-renderer
   per-pixel light cost cut ~10×, no more shader recompiles. **Rule: never add raw decor lights;
   register via `addLightSource`.**
2. **Draw-call instancing** — the real FPS killer was **draw calls (~791 → ~89)**, not lights/
   shadows/post (all measured). `buildNeonArches` (was ~448 meshes) and `buildSupportPillars` (~279)
   are now `InstancedMesh` per component. **Rule: instance repeated decor, never one Mesh per item.**
3. **FXAA AA pass** (`js/lib/FXAAShader.js`, final composer pass) + **`composer.setPixelRatio(
   renderer.getPixelRatio())`** fix — the composer was rendering at CSS res and upscaling (soft/
   jagged). Note: FXAA fixes geometric edges only, **not** the specular shimmer on the wet asphalt
   (that's a material/env-blur problem — still open, see below).
4. **Darkness mitigation** — tone-mapping exposure `0.65 → 0.78` and hemisphere ambient floor `→0.45`
   so areas between pooled lights aren't pitch-black. Partial; the deeper fix (baked terrain vertex
   lighting + biome emissive elements + atmospheric fog gradient) is the planned art-direction work.

Verified in browser preview (mobile landscape): zero shader errors, scene renders correctly, draw
calls ~89, brighter. **Cache-busters now: `scene v34`, `game v27`, `lib/FXAAShader v16`.**
`apk-build/www/` re-synced. (Node test suite not re-run this session — `scene.js`/`game.js` are
Three-dependent and not covered by the headless tests; verification was visual + via `renderer.info`.)

## Resolved this pass — Art-Direction Upgrade: Rich Darkness, Specular Shimmer, Speed/Drift Feel, & Biome Emotions (2026-06-24, sessions 5 & 6)

1. **Designed Darkness (Fog & Baked Lighting)**: Implemented warm-to-cool dynamic shading for atmospheric perspective fog. Replaced terrain standard materials with flat-shaded `MeshBasicMaterial` that uses pre-computed baked vertex colors (sun + ambient + self-glow), reducing real-time lighting cost to zero. Added a faint, distance-fading world-space grid mesh in the biomes.
2. **Specular Shimmer Fix**: Raised asphalt roughness floor (0.52 -> 0.62), decreased `envMapIntensity` (1.4 -> 0.85), and reduced normal-map scale (0.06 wet, 0.12 dry). Raised roughness floor in the roughness canvas texture to 0.55. Lowered environment map resolution to 16, naturally blurring the reflections and producing a smooth glossy sheen. Confirmed WebGL2 MSAA is active on the composer's render target with 4 samples.
3. **Speed & Drift Feel**: Tied camera FOV and bloom strength to speed (subtle creep at high speed + non-linear warp FOV above 75%). Added rear-wheel sparks on drift, high-intensity blazing neon skid trails (intensity 1.8), and a fullscreen bloom flash on clean drift release (decays in 0.2s).
4. **Biome Emotions & Instanced Elements**: Assigned distinct emotions (Solitude, Euphoria, Wonder, Serenity) and times of dream to each biome. Added a new builder for biome-tailored instanced emissive environmental objects (obelisks, pylons, crystals, spikes) that are denser near corners and include a giant horizon "hero" monolith. Instanced elements are registered as light sources for the pool and flicker collectively.

All automated headless tests pass. Visual framing has been regenerated via CDP screenshots.

## Resolved this pass — UI/HUD Art-Direction Redesign (2026-06-24, session 7)

1. **"Dream Telemetry" Visual Identity**: Added Chakra Petch (wide headers/display) and Azeret Mono (monospace numeric labels) Google Fonts. Wired UI accent and sun colors to biome themes via CSS custom properties (`--accent`, `--accent2`, `--warm`) for unified biome recoloring.
2. **Notched Corner Language**: Replaced generic rounded rectangles with clipped corners using CSS `clip-path` across all cards, buttons, menu panels, touch pads, loading screens, and HUD boxes. Removed in-race backdrop blurs to maximize performance.
3. **HUD Instrument Cluster**:
   - **Medal Timing Tower**: Replaced hardcoded medals layout with a vertical target timing tower that actively dims missed targets and highlights currently active medal benchmarks.
   - **Continuous Delta Ribbon**: Computed a live, smooth delta vs the player ghost via sample index mapping, rendering a thin green (ahead) or red (behind) ribbon.
   - **Tachometer Segmented LED & Shift Light**: Masked the RPM bar with slanted segment LEDs. Added a blinking neon `SHIFT` warning above the gear using CSS `:has()`.
4. **Boot Transitions & Loading Scrambler**:
   - Added CRT scale-up expansion (`screen-boot`) and `boot-flicker` animations for screen entries.
   - Added `dialInText` scrambling text helper for dial-in coordinate loading states.
5. **Racing Motion**:
   - **HUD Streaks**: Elements slide in using high-speed skew animations (`streak-in`) relative to the travel direction on race load.
   - **Odometer Split-Flap Ticks**: Timer seconds and speed numbers utilize vertical bounce/blur rolls (`digit-change`) on value change.
   - **RPM Breathing Glow**: Synced `#hudSpeedBox` border and shadow glow intensity to engine RPM and breathed dynamically at RPM-dependent frequencies.
   - **Flashes & PB Celebrations**: Checkpoint splits trigger a purple sector flash. Crossing the final checkpoint triggers a centered "FINAL SECTOR" pulse. Beating the personal best flashes the finish screen and rotates a golden/pink color gradient around the finish stats card.

## Resolved this pass — C4 balance pass (drift + bot/medals) + collaboration scaffold (2026-07-04, session 24)

**Branch layout change:** work now lives on `c4-work` (active); `baseline-v1` is a frozen branch at
the pre-C4 commit (`8df94c5`) for playing the old version; `master` is untouched. New collaboration
docs: `BRIEFS.md` (active Antigravity briefs A11–A14 + opportunistic O1–O8), `ANTIGRAVITY.md`
(Antigravity's standing instructions + knowledge base).

**C4b — Drift honest-model retune** (Claude-owned physics). Verified root cause: the velocity-
follows-heading coupling was a flat 2.2/s while grip couples at 12/s — ~5× slower — so the nose
rotated in fast (`driftYawAuthority 5.5`) but the velocity vector took ~0.45s to follow, plowing
~16m wide at 35 m/s (the reported "looks good but understeers, hits the wall"). Fix preserves the
slip model (no arcade bonus layer):
- `driftCoupling` (flat 2.2) → **speed-scaled** `driftCouplingLo 7.0` / `driftCouplingHi 3.5`
  (lerp by speed/40). Low speed tightens the line; high speed keeps some slip for the visual +
  skill commitment. Still < grip's 12, so drift stays a choice.
- scrub coefficients 0.5/0.22 → **0.38/0.16** so mid-speed drift (30–42 m/s, below `sdBoost`)
  isn't purely punitive now that coupling genuinely tightens.
- **Test 15 rewritten** from a misleading nose-rotation test to a steady-state-radius test
  (controller-independent): at 15 m/s grip is tighter (3.7m vs 22m — guards against drift OP); at
  the **~25 m/s crossover drift is tighter** (33m vs 37.6m) — drift is now a genuine cornering tool.

**C4c — Bot grip budget + medal retune** (Claude-owned physics). Verified root cause: the expert
speed solver budgeted only `(gripF+gripR)*0.5 = 15.5` (~1.66g) lateral per corner, while the
player's grip regime allows `~0.95*(gripF+gripR) ≈ 29 m/s²` (~3g) — so the bot cornered at
**~0.74× human speed** and every medal was trivial (`author = bot×0.97` on a slow bot).
- solver `gripAvail`: `(gripF+gripR)*0.5` → **`(gripF+gripR)*0.90`** (90% of what the player's grip
  regime can use — fast, with a hair of margin). Downforce folded in consistently; the old 1.05
  fudge factor removed (it compensated for the too-low budget).
- medals: `author = bot×1.00` (bot IS the reference lap, now near-optimal); gold/silver/bronze
  **1.08/1.20/1.45** (was 1.10/1.25/1.55). **Final numbers await Tibba playtests** — bot-speed is
  defect correction, tier spreads are judgment.
- **Test 18 added** — locks the fix: bot corner speed at R=80m is 48.5 m/s vs the grip-limit
  prediction 47.2 m/s (within 3%), clearly above the old buggy 35.2 m/s.
- **Quantified:** circuit test 16 lap time 80.7s → 71.4s (~11.5% faster, exactly what raising the
  grip budget predicts). Bot still completes all tracks 0-respawn.

**Open C4 slices:** C4a (impact audio → A11, Antigravity WIP in tree), C4d (campaign rework →
A12/A13/A14, Antigravity started — `#finReplay` button added). **Judgment awaiting Tibba:** drift
crossover feel, final medal tier spreads (playtest both).

**Suite green:** drivability **43/43** (was 41; +test 18), determinism, colors, m2 18, camera 21,
sky. Cache busters: `physics v21`.

## Resolved this pass — A5/A7/A8/A9/A10 reviewed & verified (2026-07-03, session 23)

**Provenance note first:** Antigravity's five-brief drop landed in the working tree DURING
Claude's C3 session, and C3's `git add -A` swept it (unreviewed) into commit `0857bb9` — so that
commit contains BOTH workstreams, and its "all suites green + visual verification" evidence was
unknowingly gathered against the combined state. Claude-side protocol fix: **`git status`
immediately before every stage/commit** (mirror of Antigravity's field notes). This session is
the retroactive review — verdict: **the cleanest drop yet, zero defects found.**

- **A5 impact audio** ✓ — `noiseSfx` filtered-noise envelope helper; `sfxWallThud` (150 Hz LP,
  edge-detected via `G.prevHitWall` so wall-scraping doesn't machine-gun) + `sfxLandingWhump`
  (90 Hz LP, fall-speed-scaled) wired one line BEFORE `updateCamera` — correct, since it reads
  the camera state's previous-frame `prevGrounded`. Volumes under `settings.sfx`.
- **A7 terrain color bake** ✓ — `DD.TERRAIN_BAKE` table (theme.js) consumed in `buildTerrain`;
  calibrated against the C3 relief (the lit canyon/dune slopes in session 22's screenshots were
  in fact this bake at work).
- **A8 lap HUD** ✓ — `lapSplits` per lap, per-lap time rows on the circuit finish screen
  (dial-in styled), FINAL LAP banner on the last lap-line crossing, `hudWarn` opacity guard
  extended so the banner isn't stomped by the off-track warning.
- **A9 emissive variety** ✓ — new per-biome compositions, still exactly 2 InstancedMeshes.
- **A10 chevrons** ✓ — the dangling arch panel is GONE (arches are pure gantries now); corner
  boards rebuilt as real furniture: instanced panels + 2 ground-planted posts + severity-scaled
  glowing glyphs (1-3) pointing into the turn, emissive frame. Screenshot-verified on a tight
  corner sequence — reads like proper rally signage.
- **Cache busters: bumped correctly by Antigravity for the first time** (theme v22, audio v16,
  scene-decor v55, game v46). Field notes are working.

Verified this session: full suite green on the combined state (drivability 41/41, determinism,
colors, m2, camera, sky), zero console errors in live runs, corner-board close-up + wide shots.
One benign investigation artifact worth recording: a seed's browser track can differ from a bare
`generateTrack(seed, tier, 0)` in Node because `buildValidTrack` may ship attempt 1+ — compare
against `buildValidTrack` output when cross-checking Node vs browser.

## Resolved this pass — C3 core: terrain height-policy rework (2026-07-03, session 22)

The "black nothing around the track" root cause is fixed at the generator (`js/trackgen.js`
`buildTerrainData` — heights only; the color bake is Antigravity's parallel brief A7):

- **Terrain follows the LOCAL road height** instead of hiding 8m below the track's GLOBAL minimum
  (the old rule flattened the whole world to a sunken plane). Elevated sections keep
  proportionally more air underneath (`elev·0.55`), so bridges still fly over a drop.
- **Landform uplift outside the racing corridor**: within `roadEdge+26m` nothing changed (safety
  basin); from there to `+85m` further, terrain fades up into biome landforms (`TERRAIN_RISE`:
  canyon 48 — plus a ridged-noise wall component, frozen 32, dune 20, neon 6), placed by a
  large-feature noise so it reads as hills/walls/ridges, not a berm ring. Terracing now applies
  to the composed landform (terraced mesas). All seeded noise — deterministic.
- **Safety clamps unchanged and applied LAST**: road-edge clearance (≥1.25m within
  `roadEdge+10`) and gap chasms (≥12m) override everything. Verified across 15,324 samples /
  14 seeds: worst clearance 1.21m, shallowest chasm 12.2m, canyon rises +65.9m above the old
  ceiling. New drivability test **[17]** locks these invariants (41/41).
- **Perf**: the two full per-cell sample scans (the documented load-time hotspot) are fused into
  one pass (nearest + clearance collected together) — ~half the distance checks per cell.

Verified visually: canyon (CAMP-T3-01) runs between ridges/walls with crystals layered up the
slopes; dune (TERRA-0 t5) rolls through lit sand crests. All suites green. `trackgen v20`.
**Note for A7 (terrain color bake)**: height range per map is much larger now — the bake's
height-based color ramp (`tt`) will stretch; calibrate against the new relief.

## Resolved this pass — A2/A3/A4/A6 landed (Antigravity impl, Claude review + 2 crash fixes); A5 NOT done (2026-07-03, session 21)

Antigravity dropped briefs A2–A6 on top of the (then-uncommitted) C2 work. Review verdict:

- **A2 ghost UX** ✓ — `#hudGhostTag` ("vs PB"/"vs AUTHOR") next to the delta, `updateActiveGhost()`
  refactor, live `setGhost` switching. ⚠️ **The refactor broke the game loader**: it hoisted
  `const rec` out of `startTrack`'s tail into `updateActiveGhost()`, leaving a dead `rec` reference
  → ReferenceError inside the load `setTimeout` → the game NEVER left the loading screen. Fixed
  (redeclared locally).
- **A3 zero-alloc render path** ✓ — module-scope scratch Matrix4/Vector3s in pose/shadow, `DD._ip*`
  in-place vector helpers (render path only — physics `DD.v` untouched, verified), cached HUD DOM
  refs. All suites byte-identical green.
- **A4 scene split + dead code** ✓ structure — `scene.js` (3,042 lines) → `scene-core/decor/car/fx`
  with a proper `DD._sceneShared` registry (col/textures), `js/lib/GLTFLoader.js` (3,629 lines) and
  `theme.js` `PALETTES` deleted. ⚠️ **The split stranded `CAR_FIN` + the `_box/_cyl/_tor/_sph/_mesh/
  _stdMat` helpers in scene-core's closure while every user lives in scene-car → `buildCar` threw
  ReferenceError = no car, game unplayable.** Moved to scene-car (fixed). Also: `verify_m2_features`/
  `verify_camera` still required the deleted `../js/scene.js` (fixed → the four files in index
  order), and **no cache busters were bumped** (fixed: scene-* v52, game v44).
- **A6 sign backs** ✓ — mirrored back-face chevrons (10 instances/sign), corner boards checked.
- **A5 impact audio** ✗ **NOT IMPLEMENTED** — `js/audio.js` untouched, no thud/whump anywhere.
  Re-briefed (see IMPROVEMENT_PLAN.md).

Verified end-to-end after fixes: full suite green (drivability 38, m2 18, camera 21, determinism,
colors, sky) AND a live circuit race boots → "vs AUTHOR" tag + REAL pace-based delta (the fixed
mapper reads ±0.07s tight vs the author schedule) + LAP 1/2 + medal tower. **Protocol lesson #3
(added to the plan's field notes): a green test suite does not prove the game BOOTS — launch it.
Both crash bugs shipped inside "all tests pass" claims.**

## Resolved this pass — C2: closed circuits + multilap (2026-07-02, session 20)

Closes the core of `IMPROVEMENT_PLAN.md` item 11 (Claude-owned C2). **~55% of seeds now generate
CLOSED CIRCUITS raced over 2-3 laps**; the rest stay point-to-point sprints. Existing open-track
seeds generate byte-identically (the loop decision draws from an isolated `seed+'::loop'` rng).

- **Loop closure** (`js/trackgen.js`): after ~62%-budget grammar (loop tracks get a shorter per-lap
  budget), a **Dubins CSC solver** (arc–straight–arc over deterministic radius candidates
  85/60/115/72/140/50) routes back to the origin state; every variant is verified against its own
  closed form (sign-guard) before use; vertical closure = per-step glide-slope controller to y=4
  (|pitch| ≤ 0.135); two-pass integration cancels yaw drift, a linear shear lands the final sample
  EXACTLY one DS before samples[0] (seam gap 2.00m, yaw err 0.00° across all test seeds).
  Closure-aware occupancy check (start region exempt — it's the destination); mid-track collision
  → next radius → fall back to open sprint. Checkpoints continue through the closure at normal
  cadence. `track.closed`, `track.laps` (2, or 3 under 1350m), `finishIdx = N-2` (the start line).
- **Lap semantics** (`js/physics.js`): `car.lap` + `car.awaitSeam` (after a non-final lap-line
  crossing, checkpoint/miss logic holds until idx wraps past the seam — prevents false
  missed-checkpoint from the high pre-seam index); `car.justCkpt` is now the ABSOLUTE split index
  (lap-safe; single-lap value unchanged); lap crossings snapshot for respawn (lap + awaitSeam
  restored); `car.justLap` event for the HUD. `DD.trackQuery` wraps its search window on circuits.
- **Bot on circuits** (`js/physics.js`): expert data is seam-aware — racing-line relaxation +
  hazard scans wrap; the speed solver runs 2× modular sweeps with NO standing-start zero (lap 2
  arrives at the seam flying); line pinned to center through the seam. `runBot` uses lap-aware
  progress for stuck detection and scales its time budget by laps. Author ghosts record through
  all laps automatically (existing time-indexed playback needs no change).
- **HUD/ghost** (`js/game.js`): `LAP n/m` live (init + resetRun + `justLap` chime/flash);
  continuous delta indexes `lap*N + idx`; **fixed a latent bug**: `precomputeGhostTimes` read
  `s[0]` on sample objects (undefined → NaN) so every frame "matched" index 0 and the tail-fill
  extrapolated constant pace — the live delta has been a linear approximation since session 7.
  Now a real per-lap nearest-sample walk (`s.p[…]`), so deltas reflect actual pace.
- **Tests**: new drivability [16] (closure generates; seam 1-step; heading closes; laps ≥ 2; bot
  completes all laps with 0 respawns; splits == ckpts × laps) — **38/38**; determinism, colors,
  m2, camera, sky all green. Campaign seeds validated: mix of sprints and circuits (T1-05 is a
  3-lap 1336m circuit; T4-03 a 2-lap 2712m one), author ghosts full-length. Verified live in
  browser: LAP 1/2 → lap-line rollover → LAP 2/2 → checkpoints cycle → finish at 2/2; lap-indexed
  delta live; zero console errors. Cache busters: `trackgen v19, physics v19, game v42`.
- **Still open from item 11** (next C2 slice): trackgen VARIETY (elevation drama pieces, width
  modulation, surface rhythm, set-piece placement) judged via a bot playtest report; balance pass
  on lap counts/lengths with Tibba.

## Resolved this pass — A1 theme knobs landed (Antigravity impl, Claude review + fixes) (2026-07-02, session 19)

Antigravity's A1 drop (brief in `IMPROVEMENT_PLAN.md`): all four dead theme knobs now render —
**aurora** (3 additive scrolling bands, `DD.GLOW.aurora`, camera-followed, fog-immune), **foggy**
(fogNear/Far → 20/220 + pole-halo boost 0.45/2.5×; reads as a warm dream-haze veil — [taste] review
with Tibba), **edgelit** (4-vert ribbon rewrite with bright accent edge strips — strong), **shimmer**
(deterministic vertex-color sparkle — subtle). Plus a genuinely useful QA hook: `?forceAtmos=` /
`?forceLook=` URL overrides (visual-only knobs).

Claude review fixes (the drop's tests were NOT actually run after its final edit — m2 + camera
crashed on missing canvas/texture mocks):
- **Aurora re-oriented**: first cut hung near-flat 3000×240 strips at y≈850 — edge-on from the road
  they read as thin lines (no aurora at all). Now vertical curtains near the horizon (2600×430 at
  y≈420–570, z≈−1500, camera-followed) — verified reading as proper sky curtains.
- **`forceBiome` removed** from the URL hook — it relabeled the biome AFTER all biome-derived colors
  were computed (half-mutated theme). forceAtmos/forceLook kept + documented.
- **Test mocks extended** (`verify_m2_features.js`, `verify_camera.js`): `createLinearGradient` on
  the 2D-context mock, `clone()`/`offset`/`needsUpdate` on the CanvasTexture mock — buildTrackScene
  now exercises `buildAurora` under Node.
- **Cache busters** (again not bumped by the drop): `theme v21, scene v51`.
- Protocol note for future drops: "tests pass" claims must come from a run AFTER the final edit;
  Claude re-runs everything regardless. Also learned: `npx serve` strips query strings when
  redirecting `/index.html?...` → use `/?param=...` for URL-param testing.

All suites green post-fix: drivability 32, determinism, colors 4500, m2 18, camera 21, sky PASSED.
Visual proof: dune + aurora + edgelit and dune + foggy + shimmer runs screenshot-verified.

## Resolved this pass — Wave 2 landed (Antigravity impl, Claude review): drift rework, author ghost, expert bot v2 (2026-07-02, session 18)

First run of the two-agent workflow now formalized in `IMPROVEMENT_PLAN.md` §"Division of labor":
**Antigravity** implemented Wave 2 in the main checkout (uncommitted); **Claude** reviewed the raw
diff, corrected two integration defects, verified, and committed.

**What Antigravity shipped (all verified working):**
1. **Drift rework** (`js/physics.js`): `driftYawAuthority: 5.5` steer-proportional yaw +
   `driftCoupling: 2.2` velocity-to-heading rotation while `input.drift` is held; slide yaw damping
   suspended for held drifts. New drivability test 15 proves the intended skill crossover: 90° at
   126 km/h in 0.65 s / 24 m drifted vs 2.20 s / 61 m gripped, no spin-out (final rear slip 43.5°,
   self-caught by the `prevSlip < 0.5` rear-grip return). Drift is now a genuine cornering tool.
2. **Author ghost** (`js/physics.js` + `js/game.js` + `index.html`): `DD.runBot` records frames
   @30 Hz during track validation → `track.authorGhost`/`track.authorSplits` (zero storage,
   deterministic regeneration); new `settings.ghost` = **pb** (falls back to author when no PB) /
   **author** / **off**; checkpoint delta + flash target the selected ghost's splits. Session 17's
   ghost-on-retry refresh preserved (only replaces the live ghost in `pb` mode).
3. **Expert bot v2** (`js/physics.js` `buildExpertData`, cached on `track.expert`): 100-iteration
   relaxation racing line clamped to `w*0.35`, flattened to centerline approaching ice (12
   samples)/kickers (8)/gaps (8); centerline-curvature two-pass speed solver (backward corner
   limits + forward accel limits); proactive ice slowdown (≤18 m/s near ice); slide-recovery
   countersteer (steers toward velocity when sliding). Bot **deliberately never drifts** (grip +
   line-cutting judged faster/stabler) — author ghosts therefore don't showcase drift lines.
   Campaign author medal factor **0.82 → 0.97** of bot time.

**Claude review findings (both fixed in this commit):**
- ⚠️ The drop **silently removed the slope-gravity term** (`longAcc -= sin(pitch)·gravity·slopeFactor`)
  from `stepGrounded` — an undocumented gameplay change (hills stopped costing speed, drops stopped
  giving it) with `P.slopeFactor` left as dead config. **Restored**; all 32 drivability assertions +
  determinism/colors/m2/camera suites pass WITH it restored (incl. test 15, byte-identical numbers —
  the removal was never needed). Workflow rule added to the plan: every gameplay-affecting line must
  appear in the drop's walkthrough.
- ⚠️ **No cache busters were bumped** → browsers would run stale physics with new game.js. Bumped:
  `core v17, physics v18, game v41`.

**Open balance flag (Claude-owned C4):** author = bot×0.97 on a much faster bot makes every medal
tier dramatically harder in absolute time — and since the bot doesn't drift while humans now can,
hairpin-heavy tracks may invert (author beatable by drifting) while flowing tracks become brutal.
Calibrate only after Tibba playtests. E2E goldens still need a host re-baseline (physics + Wave 1
visuals both moved); `apk-build/sync.bat` after merge as usual.

## Resolved this pass — Wave 1 "see the game clearly": ghost-on-retry, glow budget, sky/sign/particle/garage fixes, car presence, close camera (2026-07-02, session 17)

Executed Wave 1 of [`IMPROVEMENT_PLAN.md`](IMPROVEMENT_PLAN.md) (new doc — the two-phase improvement
roadmap agreed with Tibba; read it before planning further work). All changes verified live in the
browser preview (neon + frozen runs, garage) and the full headless suite is green (drivability 27/27,
determinism, colors 4500, m2 18/18, camera 21/21).

1. **Ghost appears on retry** (`js/game.js` `finishRun`): on a PB, `G.ghostData`/`G.ghostTimes`/
   `G.ghostMesh` are now refreshed in place from `G.recFrames` (and `#hudPB` updates), so the very
   next retry races the new ghost. Previously ghosts loaded only in `loadTrack` — the retry loop
   never saw them (the "I never see any ghosts" root cause). Verified end-to-end: finish → retry →
   ghost visible and replaying. Note: `DD.game` IS the live game state (`game.js:9`) — full
   introspection for tests/debug; a redundant `DD._G` alias is set under `testMode`.
2. **Glow budget** (`DD.GLOW` + `DD.glowMul` in `js/theme.js` — ALL bloom/pulse constants live
   there now; consumers: `js/scene.js` composer/trail/arch-pools, `js/game.js` per-frame bloom):
   bloom composition is `(base + speedCreep + driftFlash) × master × biomeTrim`, hard-capped at 1.8;
   the drift-release fullscreen surge dropped +1.5 → +0.45 with faster decay; gates/decor/boost all
   pulse on ONE shared breath LFO (0.10 Hz, small amplitude) instead of three competing sines; drift
   light-trail 1.8 → 1.15; arch road-pools 0.35 → 0.22; frozen gets a 0.82 biome trim (its near-field
   white-out is gone — road reads as dark asphalt + crisp neon edges per `visual_concept.jpg`).
   **User-facing: settings → "glow" (subtle/standard/vivid)**, live, saved as `settings.glow`.
3. **Sky fixed** (`js/scene.js` `buildSciFiPlanet`/`buildNebulae`): the planet was a near-black
   sphere PLUS it sat beyond `fogFar`, so fog rendered it as a solid dark disc — the "black hole in
   the sky" (and its ring floated as a giant ghost circle). Now: `fog:false` on all sky-furniture
   materials (load-bearing), luminous pastel body (skyBand↔accent2 mix) + soft additive halo shell,
   dimmer/smaller ring, and planet+nebulae follow the camera like `skyMesh`/`starsMesh` (celestial
   backdrop, not world objects you can drive toward).
4. **Arch signs readable** (`buildNeonArches`): two LARGE glowing chevrons + top/bottom frame bars
   per board (same 6 instances/sign as before) and a faint emissive tint on the panel — boards now
   read as powered chevron signage (concept-sheet style) instead of floating black rectangles.
5. **Round particles**: shared radial-dot `CanvasTexture` (`getDotTexture`) mapped onto the smoke /
   sparks / weather / fireflies / speed-lines `PointsMaterial`s — no more square snow.
6. **Garage presentable (interim)**: new `track.garageHide = [poles, props, arches, emissiveDecor]`
   registry, hidden while `state==='garage'` (same pattern as `gateMeshes`) — kills the giant bloom
   beam through the showcase car; the stage platform sheen calmed (metalness 0.2, roughness 0.62,
   clearcoat 0.45, envMapIntensity 0.45) so the white specular blobs are gone. The real dedicated
   garage room is Wave 4 in the plan.
7. **Car presence** (`js/core.js`, `js/carspec.js`, `js/scene.js`): default paint Noir → **Dream**
   (new saves only — existing saves keep their choice); new `lightBar` part (thin emissive flank
   seams, knob-positioned per preset to half-embed in the widest hull band) added to Apex/Endurance/
   Neon presets + registered in `CAR_PART_NAMES`; glowing rim rings added to `multiSpoke` and (subtler)
   `classicSpoke` wheels — per the concept sheet's "thin emissive light bar" + "glowing rims".
   Classic Cigar keeps its chrome/vintage identity (no light bar).
8. **Close chase camera** (`DD.CAM_PROFILES` in `js/scene.js`, `settings.camera`): `close`
   (dist 6.0+sv·1.6, height 1.9+sv·0.4 — the concept's "just behind and slightly above", default for
   new saves) vs `classic` (the old 7.4/2.45 frame). Module default stays `classic` so headless tests
   are unaffected; the game sets the profile from settings at boot.

**Cache-busters:** `core v16, theme v20, carspec v2, scene v49, game v40`. **Not done here:** e2e
golden re-baseline (`node tests/e2e_runner.js -u` on the host — bloom/camera/car all intentionally
changed) and `apk-build/sync.bat` (run after merging).

## Resolved this pass — Garage editor fixes: frozen camera, fast drag, dedicated stage (2026-07-01, session 16)

Session 15's ring-drag editor had three real problems the user hit immediately on trying it — all
three now fixed and re-verified in the actual garage (not a synthetic harness):

1. **Camera no longer drifts while customizing.** The garage's ambient auto-rotate
   (`js/game.js` `loop()`, `baseAngle = t*orbitSpeed`) kept advancing regardless of edit mode, so the
   view crept out from under the player mid-drag even after manually orienting it. Now the auto-spin
   term is zeroed whenever `G.workingSpec` is set (`autoSpin = (state==='garage' && workingSpec) ? 0 :
   t*orbitSpeed`) — manual drag-to-orbit (`garageDragYaw`) still works untouched; only idle browsing
   (no working spec) keeps the ambient spin.
2. **Dragging a ring handle is no longer laggy.** The old handler called a full
   `updateShowcaseCar()` (dispose + rebuild hull/canopy/wheels/every mount/all materials) on **every
   `pointermove`** — far too heavy for mouse-move frequency. Verified that nothing but the hull mesh
   itself depends on `station[]` data (wheels/canopy/parts all key off `hp`/`L`), so added
   `DD.updateHullGeometry(carMesh, spec)` (swaps just the hull's `BufferGeometry`, same material
   instance) + `DD.updateEditHandlePositions(handleGroup, spec)` (repositions existing handle spheres
   in place) for the live-drag path; `DD.buildCarFromSpec`'s hull mesh is now kept at
   `group.userData.hullMesh` to make this possible. Confirmed via object-identity check
   (`carMesh`/`hullMesh` are the *same instance* before/after a drag) that no rebuild happens mid-drag.
3. **The garage is a dedicated stage now, not the raceway.** New `DD.buildGarageStage()` — a carbon-
   textured platform (matching the car's own carbon material, not a foreign-looking asset) with a thin
   neon rim in the track's accent colour — replaces the actual road as the ground under the showcase
   car; `track.gateMeshes` (checkpoint/start arches) hide while `G.state==='garage'` and reappear for
   play. Sky/mountains/stars/decor and even the road visible in the distance are untouched — decor
   generation (`buildDecor`) scatters along the real track spline, so a fully track-free garage
   backdrop would have *lost* the "keeps the game's theme" ask, not satisfied it; this only swaps what's
   immediately under/around the car.

**Note for whoever continues:** this session's preview tab ran backgrounded (`document.hidden===true`),
so `requestAnimationFrame` never fired and the loop-driven camera/stage code couldn't be observed via
normal navigation + screenshot alone. Verified instead by manually replicating one frame's worth of the
loop's garage-branch logic via eval (position camera, lazily build/position the stage, toggle gate
visibility, pose the car, render) — same "drive the sim synchronously" workaround documented in
`CAR_REBUILD_PLAN.md` §6 for this exact class of harness limitation.

## Resolved this pass — Garage live editor, slice A: ring-drag Length mode (2026-07-01, session 15)

First slice of P2 (`CAR_DESIGN_SYSTEM.md` §9's live 3D editor) — proves the raycast→drag→mutate→
rebuild interaction end-to-end (no raycasting precedent existed anywhere in the codebase before this)
so Cross-section/Add-remove can reuse it rather than starting from zero. Deliberately scoped to one
mode; see "Explicitly out of scope" in the session's plan for what's deferred.

- **`DD.buildEditHandles(spec)`** (`js/scene.js`) — one small grabbable sphere per hull station, at its
  rightmost ring point (mirrors `buildHull`'s exact math so a handle always sits on the rendered
  surface). Editor-only, never touches the physics/render contract.
- **Working-spec state** (`js/game.js`) — new **"customize"** button in the garage forks the current
  locked preset into `G.workingSpec` (session-only, in-memory — not P3's persistence). `updateShowcaseCar`
  now builds from `G.workingSpec` when present, garage paint/finish still layer on top correctly. A
  **mode toolbar** (Orbit / Length / Cross-section / Add-remove) appears while customizing — the latter
  two are visibly present but disabled ("coming soon"), so the UI shows the full intended shape without
  pretending they work yet. The chassis tab hides while customizing (picking a different preset would
  silently discard the fork); **"reset to preset"** clears back to the locked preset.
- **Length mode**: raycast (`THREE.Raycaster`, net-new to the codebase) picks a handle on
  `pointerdown`; drag mutates that station's width/height directly (`dx`→width, `dy`→height,
  `DD.CAR_SCHEMA` ranges as the clamp), rebuilding the car live on every `pointermove`. A miss falls
  through to the existing orbit-drag unchanged, so both gestures coexist on the same canvas.
- Verified live in the actual garage (not a synthetic harness): handle pick → drag → visible resize →
  extreme drag clamps to a still-intact hull (never a broken/inverted shape) → reset reverts cleanly →
  paint/finish changes apply correctly on top of the customized shape. Full suite still green
  (`verify_m2_features` 18/18, `drivability` 27/27, determinism, colors) — the car contract itself
  didn't change, only an editor layered on top.
- **Note for whoever continues:** the preview harness's coordinate-based click simulation
  (`preview_click`) misses these buttons — likely the notched `clip-path` corners affecting hit-testing
  — `element.click()` via eval works reliably. Pre-existing UI characteristic, not introduced here.

## Resolved this pass — Cars-as-data foundation + gallery QA harness (2026-07-01, session 14)

Superseded session 13's hardcoded 4-form `if(form===…)` car with a **cars-as-data design system**
(`CAR_DESIGN_SYSTEM.md`, `CAR_REBUILD_PLAN.md`): a car is a serializable `CarSpec`, not a code branch —
foundation for the planned live 3D garage editor (P2) and save/share (P3).

**P0 (foundation, no visible change):** new `js/carspec.js` (THREE-free) — `DD.CAR_SCHEMA`,
`DD.normalizeSpec` (the guardrail: clamps ranges, drops unknown parts, caps block/mount counts, forces
`glow` to emissive-only — never a real light), `DD.CAR_PRESETS` (the 4 locked seeds: Apex Formula /
Endurance Prototype / Neon Speeder / Classic Cigar, hull `station[]` tables sculpted by hand in an
interactive widget), `DD.resolveSpec`. Rewrote `DD.buildCar` (`scene.js`) into `DD.buildCarFromSpec`
(the pure renderer) + a thin wrapper; added the primitive/part builders (`buildHull`, `buildCanopy`,
`buildWheels`, `DD.CAR_WHEEL_BUILDERS`, `DD.CAR_PARTS`). Full existing contract preserved
(`wheels`/`frontWheels`/`spinGroup`, `userData.{boostShell,iridescent,baseEmis,baseEmisI,grad}`, ghost
path, envMap, `setShadows`). `tests/verify_m2_features.js` rewritten against the new builder (18/18).

**P1 (validate):** new root-only dev tool `gallery.html` — a dedicated display stage (dusk-gradient
sky, stars, hemisphere + directional light, flat platform), **deliberately not** a slice of the random
track generator (no trackgen.js/physics.js dependency — avoids fighting road width/curvature for car
placement). Renders all 4 presets in a row with screen-projected name labels (a fixed left-to-right
label order reads backwards at oblique camera angles — projected correctly now) plus camera helpers
(`frameRow`, `frameCar`, `bumpWheelSpin`, `orbitSun`) for the `CAR_REBUILD_PLAN.md` §4 acceptance rubric.

Findings from the rubric pass: canopy ratio passes for all 4 (0.12–0.23 vs ≤0.25 threshold); fender/
tyre clipping clear for Apex/Neon/Classic, and Endurance's hull overlapping the wheel-track X position
is confirmed intentional ("fenders cover wheels" — reads as a clean Le Mans-prototype look, not
breakage); specular sweep clean (no flicker/seams). **Open, not yet acted on:** Classic Cigar reads
extremely needle-thin in profile — may be worth a taste pass; `glowDisc` (Neon Speeder's wheel) is a
ring + cylinder, both rotationally symmetric, so it can never show a visible spin cue at any
resolution — `multiSpoke`/`turbofan` already have an asymmetric blade/ring, `glowDisc` doesn't yet.

Next: **P2 — the live 3D garage editor** (orbit/length-rings/cross-section/add-remove edit modes,
fully specced in `CAR_DESIGN_SYSTEM.md` §9), then **P3 — save/share**.

## Resolved this pass — Sophisticated Garage Car Variants (2026-06-30, session 13)

1. **Unique Variant Geometry Shapes**: Refactored `DD.buildCar` (`scene.js`) to generate highly distinct physical profiles for each of the four forms instead of sharing a single hull shape:
   - **Formula Neo**: A narrow open-wheel F1 chassis with a severe coke-bottle waist pinch, a double-element wing on a swan-neck pylon, and a protective carbon-fiber Halo safety cage with support struts.
   - **Prototype X**: A wide, closed-wheel Le Mans endurance hypercar with integrated front/rear wheel arches/fenders wrapping over the wheels, a wraparound bubble canopy, an aerodynamic shark fin, and a low-slung rear spoiler bridging the fenders.
   - **Hyperion**: An angular, muscular widebody street racer utilizing super-ellipse geometry math (exponent 0.5) to produce boxy, creased body lines, split rear winglets, and boxy fenders.
   - **Vanguard**: A jet-fighter inspired grav-racer with delta-wing side pods, twin stabilizer rudders, nose canards, and a massive central exhaust thruster nozzle.
2. **Unique Wheel Styling**:
   - **Formula Neo**: Lightweight 5-spoke wheels with an asymmetric glow blade.
   - **Prototype X**: Aerodynamic turbofan discs with a glowing concentric ring.
   - **Hyperion**: Heavy industrial 4-spoke wheels with a glowing center cap.
   - **Vanguard**: Futuristic glowing concentric ring wheels with a glowing hub core.
3. **Speed-Scaling Exhaust Thruster**:
   - Programmed Vanguard's exhaust to scale its active glow core's length and radius dynamically in `DD.poseCar` based on the wheel rotation speed (wheelSpin), creating a flare-up rocket flame at high speed.

## Car: tried glTF model, reverted to patched loft (2026-06-25, session 12)


Explored swapping the procedural car for an artist/Meshy glTF (`GLTFLoader` + `assets/car.glb`,
decimated 850k→85k tris). The model looked good in isolation but the user chose **not** to go that
route — the glTF integration was **fully reverted** (loader script, `assets/`, `DD.loadCarModel`/
`_carFromModel`, boot gating, and the test all restored to the loft car). `js/lib/GLTFLoader.js`
remains on disk, unused/unreferenced (can delete).

Instead applied **Option C — patch the lofted car's bugs** (`scene.js buildCar`):
- **Suspension arms + hub uprights** per wheel (carbon boxes bridging body sidewall → hub) so wheels
  no longer float in space.
- **Raked tail**: rear station yOffsets lifted (0.18/0.24/0.30) so the tail sweeps up like a diffuser
  instead of sagging below the axle line.
- **Rear wing rooted**: central pylon lengthened to span the raked deck → wing (no floating gap);
  thinner endplates.
- **Canopy recessed**: lower, wider dark cockpit "tub" with a low glass bubble seated into it.
Verified visually (garage inspection). `verify_m2_features` 18/18, `scene v45`, apk synced.
**Known ceiling:** the body is still soft/organic and the rear wing reads a bit boxy — this is a
patch, not a from-scratch rebuild. The retired primitive form branches (`if(false)`) are still dead
code to delete.

## Resolved this pass — Car rebuilt as a lofted monocoque (2026-06-24, session 11)

Plan 3 implemented (first cut) per `CAR_REBUILD_PLAN.md`. The car is no longer overlapping scaled
spheres/cones — `DD.buildCar` (`scene.js`) now builds a **single lofted hull**: one `BufferGeometry`
lofted from 9 cross-section rings along a straight z-spine (constant world basis — no Frenet), scaled
so stations 3/7 sit over the wheel axles (wheels are ground truth; contact-shadow positions unchanged).
Rounded-top/flat-floor rings, centroid-fanned end caps. Added: a transmissive **canopy** bubble seated
in the cockpit with a dark trim ring; a **front splitter** + a **raised rear wing on a swan-neck pylon**
with thin endplates + emissive trailing bar; a carbon underfloor. **Wheels** are now solid "turbofan"
discs (tyre + face disc + hub + an asymmetric emissive accent blade) — no thin glowing spokes, no
halo torus, no floaty 2D discs. The 4 legacy form branches are neutralized (`if (false)`) and remain
as dead code to delete in a cleanup pass.
- Contract preserved: `group.wheels`/`frontWheels` + `spinGroup` (poseCar spins), `userData.{iridescent,
  boostShell,baseEmis,baseEmisI,grad}` now point at the hull material.
- `tests/verify_m2_features.js` rewritten to assert ROLES (hull = MeshPhysical via `userData.boostShell`,
  carbon Box+bumpMap, transmissive canopy, 4 wheels w/ spinGroup poseCar rotates, sdBox shadow) — **18/18
  pass**; `drivability` + `verify_determinism` pass. Cache-buster `scene v43`; `apk-build/www/` synced.
- Verified visually (garage inspection harness, 3 angles): coherent sleek single-seater, no clipping,
  no floaty bits, solid wheels. **Still open / next pass:** delete the dead form branches; per-form
  variation (all 4 forms currently share one hull); stronger coke-bottle fender flare over the wheels;
  optional canvas neon graphic on the wheel disc; run the full aesthetic acceptance rubric from
  CAR_REBUILD_PLAN.md (coke-bottle ratio, strobe check, specular sweep).

## Resolved this pass — Frameless HUD + raceway borders (2026-06-24, session 10)

User feedback on session 9: the HUD restyle "looked more like AI slop" (top accent line, orange,
panels) and the track was "just a line." Two of the three planned reworks landed (the car rebuild is
the third, still pending). Verified on real screenshots; foundation intact (`gl.getError()` 0, light
pool 12/0/1).

- **HUD → frameless "type-on-scene"** (`index.html` + `game.js`): removed all in-race panel
  backgrounds, borders, clip-paths, the accent top-line, and the orange (`--warm`) from numerals.
  Readability now comes from a layered `text-shadow`/`filter: drop-shadow` (dark outline + halo).
  Colour is signal-only: live delta is a green/red **number** (the colored ribbon plane is gone),
  shift state is red. The segmented RPM bar is replaced by a **minimal SVG tach arc** around the gear
  (`#hudRpmArc` two `<circle>`s; `game.js` sets the fill's `stroke-dasharray` from `rpm01`); redline
  turns the arc + gear red. **The `:has()`/`::before` shift-light and the conic+`mask` arc are both
  GONE** — `mask` *hung the compositor screenshot* (a real perf red flag), so the arc is plain SVG.
  **Rule: avoid CSS `mask` and stacked `filter` on in-race HUD; SVG strokes are cheaper and capture-safe.**
- **Track borders** (`scene.js`): added a **secondary outer neon rail** (accent2) outside the main
  edge for a two-tone border, and **red/white corner kerbs** (`buildKerbs`, MeshBasic vertex-colour
  rumble strips on the apex edge of each detected corner — note many procedural tracks have 0 corners,
  same gating as the existing chevrons). Plus the session-9 dashed centre line.

Cache-busters: `scene v41`, `game v36`. `apk-build/www/` re-synced.
**Still pending (Plan 3): full car rebuild** — single swept/curvy monocoque (not overlapping
spheres), remove the levitating halo torus + flat 2D additive discs + floaty glow rings, and wheels
with visible tread/spokes so rotation reads. The user approved going straight to a rebuild.
**Full implementation spec written up in [`CAR_REBUILD_PLAN.md`](CAR_REBUILD_PLAN.md)** — it captures
the `buildCar` contract (group.wheels/frontWheels/spinGroup, userData hooks), the
`verify_m2_features.js` coupling that MUST be updated alongside, the eyesores to remove, the lofted-hull
design, and the verification steps. Groundwork only so far; not implemented.

## Resolved this pass — Visual de-AI overhaul (2026-06-24, session 9)

User feedback: the world + HUD still "read AI-generated / samey." Verified by actually *seeing* it
(see screenshot workflow below) and did a bold pass on four fronts. Foundation re-checked after:
draw calls **144**, `gl.getError()` 0, light pool **12 point / 0 spot / 1 sun shadow** — all intact.

- **Screenshot workflow (now works):** the preview `preview_screenshot` was hanging only because the
  WebGL backing buffer had collapsed to 1×1. Fix: size the renderer to the **real viewport**
  (`renderer.setSize(innerWidth, innerHeight, false)` + composer.setSize) and keep a render pump
  going (rAF is throttled when the tab is hidden). Then `preview_screenshot` captures the full
  composite (canvas + HTML HUD) — what the player actually sees. See [[driftdream-preview-harness-limits]].
- **Stars** (`buildStars`): replaced the flat square `PointsMaterial` with a custom point shader —
  round soft dots, per-star size/colour variation (cool-white/blue/warm/accent), additive, and a
  gentle twinkle (the `time` uniform is fed from the loop in both menu + play branches of `game.js`).
- **Emissive props** (`buildEmissiveElements`): rewrote from one flat primitive into **two-layer**
  landmarks — a dark structural body + a bright emissive accent — in two compositions:
  `strip` (dune monoliths / neon pylons with a glowing seam on the track-facing face) and `onbase`
  (canyon crystals / frozen ice-shards glowing on a dark pedestal). Denser (~110 base), face the
  track, dramatic hero. Still exactly **2 InstancedMeshes** (bodyInst + glowInst). Glow flicker base
  bumped (`game.js` `1.9 + 0.5*sin`).
- **HUD cards** (`#hudLeftBox`/`#hudMedals`/`#hudSpeedBox`): lighter gradient fill + a bright accent
  **top-edge line** (inset box-shadow) + sharper accent border, so they read as powered instrument
  readouts instead of generic dark-glass boxes. Speed box keeps its dynamic RPM glow.
- **Track surface** (`buildTrackScene`): added a glowing **dashed centre line** (one additive strip)
  — breaks up the flat asphalt, adds speed-feel.

Cache-busters: `scene v39`, `game v34`. `apk-build/www/` re-synced.
**Held back:** the car mesh itself (`buildCar`) was left untouched — highest-risk surface; the
track *surface* was improved instead. Next lever if wanted: stronger car presence (livery/glow).

## Resolved this pass — HUD checkup fixes (2026-06-24, session 8)

A critical review of the "Dream Telemetry" HUD against the live build (Chrome 148 / Electron
preview, verified via `getComputedStyle` + `getBoundingClientRect`, not screenshots). Two real
defects found and fixed in `index.html` (CSS only):

1. **Shift-light never lit.** `#hudSpeedBox::before` (the "SHIFT" indicator) had
   `transition: background/color/border-color/box-shadow 0.1s`. **CSS transitions on `::before`/
   `::after` freeze the animated value at its start on this engine** — so at redline the indicator's
   background/color/box-shadow stayed at their dim idle values; only the (un-transitioned) blink
   animation ran, on near-invisible text. Removed the pseudo-element transition so the shift-light
   snaps red+white+glow at redline (instant is correct for a shift-light anyway). Verified: redline
   now computes `background rgb(255,75,75)`, `color rgb(255,255,255)`, red 12px glow.
   **General rule: don't put `transition` on a `::before`/`::after` whose properties change at runtime.**
2. **Game buttons occluded the timer.** `#gameButtons` (restart/respawn/exit, `z-index:6`) shared the
   top-left anchor (`16,16`) with `#hudLeftBox`, painting directly over the live `#hudTime` digits at
   every resolution. Offset `#gameButtons` down by the card height
   (`top: calc(max(16px,env(safe-area-inset-top)) + 104px)`) so the buttons sit *below* the timer
   card. Verified at 812×375 (touch layout): buttons now at y120–164, zero overlap with the timer,
   the left box, or the touch pads; all HUD elements on-screen.

`apk-build/www/index.html` re-synced. (index.html carries no `?v=` cache-buster; it is the entry doc.)
Note: a benign `THREE.WebGLProgram ... Sample Bias value is limited to [-16,15.99]` warning is emitted
by the bundled (older) three.js on the Windows ANGLE/D3D backend — clamped harmlessly, `gl.getError()`
is 0, the scene renders with full materials. Pre-existing, not a regression.

### Still open (next candidates)
- **HUD does not "recede at speed"** — the side panels keep full opacity at all speeds. The notched
  no-blur cards satisfy the "light, not boxes" intent, but the speed-based fade described in the
  redesign vision was never implemented. Low priority; risky vs. clarity, so deferred.
- Analog touch steering [#3], haptics [#6], wall-impact sound [#8] — the remaining controls/feel gaps.
- Render-path allocations [#10], car mesh instancing [#11], worker-based track gen [#12] — perf.
- Inert `aurora`/`foggy` atmospheres and `shimmer`/`edgelit` surface looks [#16].

---

## Gotchas for whoever continues

- **This IS a git repo (since 2026-07-01).** Use `git status`/`git diff`/`git log` to inspect
  unexpected changes (multiple AI tools edit this folder). **Branch layout (2026-07-04):**
  `c4-work` = active (C4 balance + campaign work, sessions 24+); `baseline-v1` = frozen playable
  version at the pre-C4 commit (`8df94c5`); `master` = untouched trunk. Older session work lives on
  `garage-editor-fixes-session16` (sessions 15–23). Always `git status` before staging — the
  two-agent workflow (Claude + Antigravity) means Antigravity's uncommitted WIP may be in the tree.
- **Determinism is load-bearing.** `core`/`theme`/`trackgen`/`physics` must stay Three-free and
  must not introduce `Math.random` in any path that affects race outcome or golden screenshots
  (particles use a deterministic trig-hash for exactly this reason).
- **Cache-buster query strings.** `index.html` loads scripts as `js/foo.js?v=N`. Bump the `?v=`
  when you change a file or the browser may serve a stale copy.
- **e2e needs the host's Chrome** (CDP). It does not run in a headless sandbox. Iterate against the
  plain `index.html` / browser preview; update goldens with `node tests/e2e_runner.js -u` only
  after an *intended* render change.
- **Old saves linger.** Garage/settings defaults changed over time; an existing `driftdream_v1`
  localStorage entry keeps old choices. Clear it to see true defaults.
