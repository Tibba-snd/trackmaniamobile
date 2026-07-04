# DRIFTDREAM — Improvement Plan v2 (2026-07-02)

_v2 after Tibba's direction: mobile-specific work is PARKED for now; lighting/bloom excess, ghosts,
car/camera presence, a real garage space + editor freedom, living terrain/biomes, multilap +
trackgen variety + an expert bot, and a drift rework are the priorities. Root causes below were
verified in code/live build this session — the plan builds on them, not guesses._

Goal restated: **dreamy TrackMania-like racer — efficient, looks good, exciting to play.**

---

## Verified root causes (what's actually wrong)

1. **"I never see any ghosts"** — ghosts load only in `loadTrack` ([js/game.js:200-207]). The
   retry loop (`R` / retry button → `resetRun`) never refreshes `G.ghostData`, so the PB ghost you
   just set NEVER appears unless you exit to menu and re-enter the same seed — which dailies and
   random seeds make rare. The core "chase your line" loop is effectively switched off.
2. **"Even if I drift the car won't turn that good"** — holding drift multiplies rear grip ×0.42
   (`driftBtnRearMul`, [js/physics.js:59,294]). Total lateral force = what curves the path — so a
   drift *reduces* path curvature vs grip steering at the same speed (~0.72 vs ~0.98 rad/s at
   30 m/s). The nose rotates in, the car plows wide, wall. Drift is only ever a brake-tap entry
   trick; there is no speed where drifting is the better line. Additionally `slideYawDamp` (1.6/s
   at speed) damps player-*requested* rotation as aggressively as accidental breakaways.
3. **"Terrain is black nothing"** — `buildTerrain` bakes `base × (ambient+sun) + glow`
   ([js/scene.js:461]) which multiplies out to ~0.06–0.12 brightness before tone-mapping exposure
   0.78; noise variance is ±0.04. The basin generator also clamps ALL terrain ≥8 m *below* the
   lowest track point, so no landform ever meets or crosses the horizon near you. Result: a dark
   featureless plane. (`aurora`/`foggy` atmospheres and `shimmer`/`edgelit` surface looks are
   still inert on top of that — STATUS #16.)
4. **"Bloom/lighting too much in some occasions"** — stacked, uncoordinated glow:
   base 1.25 + speed creep (+0.32) + **drift-release fullscreen surge +1.5** ([js/game.js:709]),
   while gates (0.55+0.3·sin), decor emissive (1.9+0.5·sin), boost pads (0.4+0.25·sin) pulse on
   independent frequencies; skid trails run intensity 1.8; additive light pools sit on the road
   under every arch; frozen palette pushes the whole road over the 0.85 bloom threshold.
   Plus one-off artifacts: near-black planet + giant additive ring ([js/scene.js:1763]), black
   arch sign panels ([js/scene.js:1580]), square weather particles ([js/scene.js:783]), and the
   garage stage parked next to a light pole (vertical bloom beam through the car).

---

## Wave 1 — quick strikes (days): see the game clearly

1. **Ghost on retry** — refresh `G.ghostData`/`G.ghostTimes`/`G.ghostMesh` after `finishRun`
   saves a PB (rebuild from `G.recFrames` directly; no decode round-trip needed). Smallest
   possible change with the biggest excitement payoff: every retry races your best line.
2. **Glow budget pass** — centralize the scattered glow constants into one `DD.GLOW` tuning
   table (per-biome multiplier + global caps) and calibrate:
   - cap composed bloom strength (~1.7); drift-release surge +1.5 → ~+0.4 with faster decay
     (or localize the reward to the trail, not the whole screen);
   - one shared low-amplitude "breath" LFO for gates/decor/boost instead of three competing
     sines — coherent dreamy breathing, not flicker;
   - tame skid trail (1.8 → ~1.2), arch road-pools, and frozen's track palette (clamp
     brightness so the road stays dark asphalt + crisp neon edges, per `visual_concept.jpg`);
   - **settings slider "GLOW: subtle / standard / vivid"** mapping to the master multiplier —
     the requested user-facing mitigation, and it makes future calibration arguments cheap.
3. **Artifact fixes** (same pass, same screenshots): luminous hazy planet + dimmer ring;
   arch sign chevrons scaled up to fill the board + faint emissive frame; round sprite for
   weather/speed-line/firefly/trail particles; garage stage moved/pole hidden (interim — the
   real garage room comes in Wave 4).
4. **Car presence** — default paint Noir → Dream ([js/core.js:111]), add the concept sheet's
   thin emissive light bar + glowing rim accents to the presets (emissive only, pool-safe).
5. **Camera "close" preset** — concept: "just behind and slightly above". Settings A/B
   (close/classic), tune dist/height (7.4–9.4 m → ~6, 2.45+ → ~2.0) + FOV; keep classic as
   fallback. If the car looks good (item 4), we should see it.

_Everything in Wave 1 needs: `?v=` bumps, apk sync, e2e golden re-baseline after sign-off._

## Wave 2 — make it exciting to drive — ✅ LANDED (sessions 18, Antigravity impl + Claude review)

**Status 2026-07-02:** items 6+7+8 implemented by Antigravity, reviewed/integrated by Claude.
Review notes (read before touching these systems again):
- **Drift (6)** ✅ — arcade authority exactly per spec, gated on `input.drift`; new drivability
  test 15 proves the hairpin crossover (90° at 126 km/h: drift 0.65 s / 24 m vs grip 2.2 s / 61 m).
  ⚠️ The same drop silently deleted the **slope-gravity term** (`sin(pitch)·gravity·slopeFactor`)
  from `stepGrounded` — undocumented, unneeded (all 32 tests pass with it restored) — **restored
  by Claude.** Rule reaffirmed: every gameplay-affecting line must appear in the drop's walkthrough.
- **Author ghost (7)** ✅ core — bot frames recorded in `buildValidTrack` → `track.authorGhost`/
  `authorSplits`; `settings.ghost` = pb (author fallback) / author / off. UX polish outstanding
  (brief A2 below): HUD doesn't yet SAY which ghost you're racing.
- **Bot v2 (8)** ✅ — relaxation racing line (hazard-aware: flattens to centerline before
  ice/kickers/gaps), two-pass speed solver, slide countersteer recovery. Engineering call to
  note: **the bot never drifts** (grip+cutting judged more stable) → author ghosts don't
  showcase drift lines, and a drifting human can beat author times on hairpin tracks.
  **Medal factor changed 0.82 → 0.97** on a much faster bot ⇒ every medal tier is dramatically
  harder in absolute time — needs human calibration (Claude-owned C4, with Tibba playtests).
  The telemetry/playtest-report part of item 8 (min-speed histogram, wall proximity, airtime)
  is NOT built yet — folded into C2/C3 where it's needed.

Original spec kept below for reference:

6. **Drift rework — drift as a cornering tool, not a failure mode.** Design intent: corners
   tighter than some radius are *faster drifted*; wide sweepers stay faster gripped (the
   TrackMania skill curve). Keep the honest slip model for accidental breakaways; when the
   drift button is HELD (explicit intent) blend in arcade authority:
   - steer-proportional yaw authority above the grip regime's cap (point the nose in);
   - **velocity-follows-heading coupling** while held (the classic arcade trick: the velocity
     vector is pulled toward the nose at a rate scaling with drift angle) so a held drift
     actually tightens the line instead of plowing;
   - drop `slideYawDamp` for player-held drifts (damping is for catching accidents);
   - keep scrub speed-bleed so drifting costs a little speed — that's the tradeoff — and keep
     `sdBoost` so shallow clean drifts stay speed-neutral (skill expression).
   Deterministic; extend `tests/drivability.js` with a "hairpin: drift line beats grip line"
   assertion + donut/slalom regressions. Bot + medals recompute automatically; old PBs get
   easier — acceptable, no migration.
7. **Author ghost** — record the validation bot's frames in `buildValidTrack` (same
   `[x,y,z,yaw]`@30 Hz format) and expose as a race-against ghost when no PB exists (toggle:
   PB / author / off). Zero storage — deterministic regeneration. Lands AFTER the drift rework
   so the author line reflects the new handling.
8. **Expert bot v2** (feeds #7, medals, and Wave 3 playtesting): current bot is pure-pursuit +
   braking distance + a drift heuristic. Upgrade to a *lap-time-simulation* racer: racing-line
   offset within road width (apex cutting), forward/backward speed solver over curvature
   (classic two-pass method), deliberate drift usage on tight radii (per #6's new physics),
   throttle/gear anticipation. Deterministic, offline. Output per track: time + telemetry
   (min-speed histogram, wall proximity, airtime, drift sections) = the **playtest report**
   trackgen variety work will be judged against. Also fixes medal trust (retire the
   `length/28` fallback basis; bake campaign medal tables).

## Wave 3 — a world worth dreaming in (1–2 weeks, art-direction with Tibba)

9. **Terrain that exists.** Raise the bake out of the mud (sun 0.55 / amb 0.45 need roughly
   2×; calibrate against screenshots); real variance (multi-octave noise in the color bake,
   biome-tinted bands); and **let landforms rise** — keep the ≥8 m-below rule only inside a
   safety corridor around the ribbon, let hills/dunes/walls climb to and above track level
   beyond it (canyon gets actual canyon walls, dune gets rolling crests that catch the sun).
   Sprinkle low-cost life: sparse instanced emissive ground-features between the big
   landmarks, registered to the light pool where near the track.
10. **Activate the dead theme knobs, then extend.** `aurora` (2–3 additive scrolling sky
    bands), `foggy` (fog-near override + halo boost), `shimmer`/`edgelit` surface looks on the
    ribbon; then per-biome signature weather/sky pairings so each biome has one *unmistakable*
    postcard element (dune: low giant sun + heat shimmer; neon: aurora + denser skyline;
    canyon: layered rock silhouettes + god-ray dust; frozen: aurora + crystal glints). Judged
    biome-by-biome with Tibba on screenshots.
11. **Multilap + trackgen variety.** Closed-circuit generation: generate ~60–70% of the
    budget with the existing grammar, then a guided closure solver steers heading/position
    back to the start with grammar-compatible arcs (reject/retry like today's self-intersection
    logic; validated by the expert bot). `LAP n/m` HUD exists in concept; ghosts/medals scale
    per-lap. Variety on top: elevation drama pieces (long climbs, plunge drops), width
    modulation (pinch gates, wide fans), surface rhythm sections, and set-piece placement
    variety — each validated by the bot's playtest report (e.g. reject tracks whose min-speed
    histogram is monotone = boring).

## Wave 4 — the garage as a place + full editor freedom (ongoing track)

12. **A real garage room.** Dedicated environment (not the raceway): dark reflective floor,
    rim-light rig, slow env rotation, biome-neutral dusk backdrop — the "admire + edit" room,
    built once, cheap to render (no track world behind it). Replaces the Wave-1 interim fix.
13. **Editor slices** (continuing `CAR_DESIGN_SYSTEM.md` §9, pattern proven by sessions
    15–16): fore-aft/vertical ring reposition → cross-section mode (end-on camera tween +
    `profile` primitive) → add/remove parts from the `DD.CAR_PARTS` catalog → **wheel
    characteristics** (size/width/spoke count/style per `CAR_WHEEL_BUILDERS`) → **light
    features** (add/remove/recolor glow parts; emissive-only rule enforced by
    `normalizeSpec`) → P3 save/share codes.

## Parked (explicitly deferred by Tibba)

- Mobile: haptics, analog touch steering, mobile quality auto-default, worker-based track gen.
- Perf hygiene (zero-alloc render path, car mesh merge, scene.js split, dead-code deletes):
  do opportunistically when touching those files, not as a dedicated wave.

## Sequence rationale

Wave 1 first because every later judgment (drift feel, terrain art, garage) is made by
*looking at the game*, and right now bloom/artifacts distort every screenshot. Drift (6) before
author ghost (7) before expert bot (8) because each consumes the previous. World (9–11) after
the bot exists so variety is measurable, not vibes. Garage (12–13) is parallel-friendly — any
wave can interleave a slice.

---

# Division of labor — Claude (orchestrator) × Antigravity (implementer)

_Agreed with Tibba 2026-07-02. Claude owns architecture, cross-system design, balance judgment,
and review/integration of every drop. Antigravity executes well-specified, test-guarded briefs
(high token throughput, bounded blast radius)._

## Working protocol (both agents + Tibba)

1. **Antigravity works from the briefs below**, in the main checkout, leaving changes
   uncommitted. One brief per drop — don't mix.
2. **Definition of Done for every brief:** all listed tests green (`node tests/...`), `?v=`
   cache busters bumped in `index.html` for every changed `js/` file, and a walkthrough that
   lists **every gameplay-affecting line** — an undocumented physics/balance change is a
   defect even if tests pass (see the slope-term incident, session 18).
3. **Claude reviews the `git diff`** (not the walkthrough), fixes/integrates, commits, and
   updates STATUS.md. Nothing merges unreviewed.
4. **Hard invariants nobody crosses without a Claude-reviewed design note:** determinism (no
   `Math.random` in sim paths), the `buildCar` contract (`verify_m2_features`), `normalizeSpec`
   guarantees (glow = emissive only, never real lights), the light pool rule (`addLightSource`,
   never raw lights), `DD.GLOW` discipline (no new magic glow constants), and `DD.PHYS`
   semantics (any `stepCar` change is Claude-reviewed by design).

## Claude-owned (hard problems, architecture, judgment)

- **C1 — Review & integration** of every Antigravity drop (ongoing, see protocol).
- **C2 — Multilap / closed circuits** ✅ CORE LANDED (session 20): Dubins CSC loop closure in
  trackgen (~55% of seeds are now 2-3-lap circuits; seam gap = one sample, existing open seeds
  byte-identical via isolated `::loop` rng), lap semantics in physics (`car.lap`/`awaitSeam`,
  absolute split indices), wrap-aware trackQuery/bot/expert-solver (steady-state modular
  sweeps — no standing-start zero at the seam), lap-aware ghost delta (`lap*N+idx`) + `LAP n/m`
  HUD. Drivability test 16 covers it. **Remaining in C2:** trackgen VARIETY (elevation drama,
  width modulation, surface rhythm, set-piece placement) judged via a bot playtest report;
  lap-count/length balance with Tibba.
- **C3 — Terrain & world architecture** (item 9) — ✅ HEIGHT CORE LANDED (session 22): local
  road-following reference height, corridor-limited basin (unchanged ≤ roadEdge+26m), biome
  landform uplift beyond it (`TERRAIN_RISE`: canyon 48 + ridged walls / frozen 32 / dune 20 /
  neon 6), elevated sections keep air underneath, clearance + chasm clamps applied last,
  fused single-pass sample scan (halved the load-time hotspot). Drivability test 17 locks the
  invariants. **Remaining in C3:** A7 (color bake — Antigravity, note the larger height range),
  landform-aware decor placement polish (emissive elements on slopes), and Tibba's per-biome
  taste pass on the RISE numbers.
- **C4 — Balance calibration with Tibba** — broken into four slices (2026-07-04):
  - **C4a — Impact audio** → delegated as **A11** (Antigravity): the A5 sounds fire but are
    gated too strictly (`speed > 10`, `prevVelY < -2`) and masked by the engine. Brief in BRIEFS.md.
  - **C4b — Drift feel** ✅ **LANDED** (Claude, session 24): honest-model retune. Root cause was
    velocity-follows-heading coupling at a flat 2.2/s vs grip's 12/s — nose rotated in but velocity
    plowed ~16m wide at 35 m/s. Fix: speed-scaled `driftCouplingLo 7.0 / driftCouplingHi 3.5` +
    scrub trim 0.5/0.22 → 0.38/0.16. New test 15 (steady-state radius) proves the crossover: at
    ~25 m/s drift is now tighter than grip (33m vs 37.6m) — drift is a genuine cornering tool.
  - **C4c — Bot speed + medals** ✅ **LANDED** (Claude, session 24): the expert solver budgeted
    only (gripF+gripR)*0.5 ≈ 1.66g while the player's grip regime allows ~3g — bot cornered at
    ~0.74× human speed, medals trivial. Fix: solver gripAvail 0.5 → 0.90 of (gripF+gripR); medals
    author = bot×1.00, gold/silver/bronze 1.08/1.20/1.45 (was 0.97/1.10/1.25/1.55). New test 18
    locks it (bot 48.5 m/s vs grip-limit 47.2 m/s at R=80m). **Final medal numbers await Tibba
    playtests** — the bot-speed fix is defect correction, the tier spreads are judgment.
  - **C4d — Campaign rework** → delegated as **A12/A13/A14** (Antigravity): flow fixes + track
    caching / UI rebuild + gamification / polish. Briefs in BRIEFS.md.
- **C5 — Garage editor deep slices** (item 13): cross-section mode (end-on camera tween +
  `profile` primitive + 2D-outline-equals-3D-viewport editing), add/remove-parts interaction
  design. Plus the **garage room art-direction spec** (item 12) — Claude specs it, then the
  build can become an A-brief.

## Field notes for Antigravity (accumulated from review cycles — READ BEFORE EVERY DROP)

1. **Run the FULL suite after your FINAL edit**, not mid-way: `node tests/drivability.js`,
   `verify_determinism`, `verify_colors`, `verify_m2_features`, `verify_camera`,
   `verify_sky_stars`. Sessions 19 & 21 both shipped "all tests pass" claims with crashing
   tests (stale mocks; deleted-file requires).
2. **A green suite does not prove the game BOOTS. Launch it** (`npx serve`, open `/`, start a
   race, reach `play`, check the console) after ANY structural change. Session 21 shipped two
   loader-killing ReferenceErrors (`CAR_FIN` stranded by the split; `rec` hoisted out of
   `startTrack`) inside a "done" drop — the game couldn't build a car or leave the loading
   screen.
3. **Bump `?v=` cache busters** in `index.html` for every changed js file. 0-for-3 so far —
   without them Tibba's browser runs your OLD code against NEW html.
4. **Moving code between the scene files? Move its file-local closure consts too** (or route
   them through `DD._sceneShared`). Before finishing, grep each identifier you touched:
   defined-in-file vs used-in-file must match.
5. **Walkthrough lists every gameplay-affecting line** — the slope-gravity deletion (session
   18) is the canonical incident. If you changed a number in `DD.PHYS` or removed a term, say
   so, even if "it seemed unused".
6. **Tracks can be CLOSED CIRCUITS now** (`track.closed`, `track.laps`, session 20). Any new
   code that scans `track.samples` forward/backward MUST wrap modulo N when `track.closed`
   (never bare `Math.min(N-1, i+k)`); progress/ghost indexing is `lap*N + idx`; splits are
   absolute across laps; `car.awaitSeam` gates the seam handoff — don't fight it.
7. **New randomness in trackgen = a NEW derived rng stream** (`DD.makeRng(seed + '::yourFeature')`),
   never an extra draw from the main sequence — existing seeds must keep generating identical
   tracks (that's how `::loop` was added without disturbing anything).
8. **Testing URL params:** `npx serve` strips the query string when redirecting
   `/index.html?x=y` — use `/?x=y`.
9. **`DD.game` is the live game state** — use it to verify (teleport the car, inspect meshes,
   force `DD.testMode`/`DD.autodrive` at runtime for bot-driven visual checks). Boot-time
   `?testMode=true` forces quality LOW — set the flags at runtime when you need full visuals.

## Antigravity briefs

_Done & reviewed: **ALL briefs A1–A10 are now landed.** A1 (session 19), A2/A3/A4/A6 (session
21, with integration fixes), A5/A7/A8/A9/A10 (session 23 — the cleanest drop yet: zero defects,
busters bumped). The briefs below are kept for reference; new briefs get appended when Claude
carves them from C4/C5 work. Tibba can also paste any brief-shaped task directly if it fits
the protocol invariants._

- **A5 (RETRY) — Impact audio**: this brief was reported done but `js/audio.js` was untouched —
  it is still open. Filtered-noise wall thud + landing whump in `js/audio.js` (synth only, no
  samples, follow the existing `blip`/noise-bed patterns), wired in `js/game.js` where sparks
  already fire (`car.hitWall`, scale volume with impact speed) and on hard landings (the
  `justLanded`/`suspV` path used by the camera kick), volumes under the existing `sfx`
  setting. No changes outside `audio.js` + the two game.js wiring lines. DoD: field notes 1-3,
  plus an audible in-game check.
- **A7 — Terrain color bake v2** (the delegable half of C3; parallel-safe with Claude's height
  work — touch ONLY vertex colors in `buildTerrain` (`js/scene-decor.js`), never the
  heightfield): (a) new `DD.TERRAIN_BAKE` tuning table (theme.js, next to `DD.GLOW`) holding
  every constant you use; (b) raise the bake out of the mud — sun term ~2× (0.55 → ~1.0),
  ambient floor 0.45 → ~0.7, so terrain reads instead of multiplying to ~0.1 black; (c) real
  variance: 2-3 octaves of the existing `valueNoise` modulating color (biome-tinted — mix
  toward `groundDetailColor`), replacing the ±0.04 grain; (d) a subtle radial warm→cool shade
  with distance from the track AABB centre (pre-computable per vertex, zero runtime cost).
  Deterministic (seeded noise only). DoD: field notes 1-3 + before/after screenshots of all
  four biomes (use `/?forceAtmos=clear` and the four CAMP tiers).
- **A8 — Lap & finish HUD polish**: "FINAL LAP" banner via `#hudWarn` pulse when
  `car.justLap` fires with `lap === track.laps - 1`; finish screen shows per-lap times on
  circuits (derive from `car.splits` + lap boundaries — splits are absolute across laps);
  respect existing dial-in/scramble styling. Files: `js/game.js`, `index.html`. Careful with
  field note 6.
- **A9 — Emissive landmark variety** (extends item 10 "then some"): 1-2 new per-biome
  compositions in `buildEmissiveElements` (`js/scene-decor.js`) — e.g. dune: broken arch
  pairs; neon: stacked billboard slabs; canyon: leaning shard clusters; frozen: aurora-lit
  needles. HARD CONSTRAINT: still exactly 2 InstancedMeshes total (vary per-instance matrix
  composition, not mesh count); flicker keeps using the one shared `userData.mat`; lights only
  via `addLightSource`. DoD: field notes 1-3 + `DD.debugGL()` draw-call count unchanged ±2.
- **A10 — Chevrons OFF the arches, onto real corner boards** (direct Tibba feedback: "chevrons
  in the middle of the road dangling from the pole don't make any sense — we need separate
  chevron signs in tighter turns, neatly built out"). Two halves, one drop:
  1. **Remove the hanging sign from `buildNeonArches`** (`js/scene-decor.js`): delete the
     `signs` panel + `chevrons` InstancedMeshes and their per-arch placement blocks entirely.
     Arches keep posts/crossbar/brackets/underside neon strip/road pool — they are gantries,
     not signage.
  2. **Rebuild the corner chevron boards in `buildCornerSigns` as proper track furniture**
     (they currently FLOAT at +2 m with no supports): each board = dark backing panel +
     **two support posts reaching the ground** (`DD.terrainAt(track.terrain, x, z)` for the
     base height, posts sized to span board-bottom → ground) + faint emissive frame (session
     17 sign treatment) + **1-3 big chevron glyphs by severity** (`c.minRad < 40` → 3,
     `< 70` → 2, else 1 — replaces the current single-glyph + scale hack), glyphs pointing
     INTO the corner (`c.insideSign`), boards facing oncoming traffic (existing `lookAt`
     against `s.f` is correct). Place 3-4 boards from `entry − ~20` samples through `apex`
     along the outside edge. **HARD CONSTRAINT: instance the components** — one InstancedMesh
     each for panels / glyph slats / posts across ALL corners (the current one-Group-per-board
     approach costs ~5 draws × boards; technical tracks have 10+ corners). Brake bars, apex
     beacons, kerbs unchanged. Corners are precomputed indices — no new sample scans, so no
     wrap concerns; keep the existing `bi < 2` guards.
  DoD: field notes 1-3 (run the FULL suite, BOOT the game, bump busters) + two screenshots:
  a hairpin with the new built-out boards, and an arch showing no dangling panel +
  `DD.debugGL()` draw calls within ±3 of before.
