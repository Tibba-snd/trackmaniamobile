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
- **C2 — Multilap / closed circuits** (item 11): loop-closure solver in the piece grammar,
  lap/checkpoint/ghost/medal semantics, HUD `LAP n/m`. Hardest single item in the plan;
  touches trackgen+physics+game+ghosts at once.
- **C3 — Terrain & world architecture** (item 9): corridor-safety policy, landform height
  design, bake redesign, playtest-telemetry hooks. Claude designs + prototypes the generator
  changes, then splits implementable chunks into new A-briefs.
- **C4 — Balance calibration with Tibba**: medal factor (0.97 flag above), drift feel tuning
  passes, campaign gating difficulty. Judgment work — numbers move only after human playtests.
- **C5 — Garage editor deep slices** (item 13): cross-section mode (end-on camera tween +
  `profile` primitive + 2D-outline-equals-3D-viewport editing), add/remove-parts interaction
  design. Plus the **garage room art-direction spec** (item 12) — Claude specs it, then the
  build can become an A-brief.

## Antigravity briefs (ready to run, in priority order)

- **A1 — Theme knobs** (item 10): implement `atmosphere: 'aurora'` (2–3 additive scrolling
  sky bands, camera-following like planet/nebulae, `fog:false`, registered under `DD.GLOW`
  discipline — no new raw constants) and `'foggy'` (override `fogNear/fogFar` + halo boost on
  pole lamps); implement `surfaceLook: 'shimmer'` and `'edgelit'` on the ribbon (banded
  already works; `solid` = explicit no-op). Files: `js/scene.js`, `js/theme.js` (knob docs
  only — do NOT change palette values; `verify_colors` locks them). Tests: colors, sky_stars,
  determinism. Visual proof per biome required in the walkthrough.
- **A2 — Ghost UX polish**: HUD shows WHICH ghost you're racing (small tag near `#hudPB`:
  "vs PB" / "vs AUTHOR", hidden when ghost=off); `setGhost` change takes effect without a full
  track reload if cheap (else document that it applies next load); finish screen shows delta
  vs the raced target. Files: `index.html`, `js/game.js`. Keep `finishRun`'s PB-refresh
  behavior (session 17) intact.
- **A3 — Zero-alloc render path** (promoted from Parked — mechanical crunch): module-scope
  scratch `Matrix4`/`Vector3`/color objects in `DD.poseCar`, `DD.updateShadow`,
  `DD.updateCamera` (in-place vector helpers allowed in RENDER path only — physics `DD.v`
  stays pure); cache the per-frame DOM lookups in the game loop (`hudWarn`, `hudSpeed`,
  `hudGear`, rpm-arc fill, `hudDelta`); reuse one scratch `THREE.Color` for iridescent/boost.
  ZERO behavior change; all suites must stay green byte-identical.
- **A4 — Dead code + scene.js split**: delete `js/lib/GLTFLoader.js` (unused since session 12)
  and `theme.js` `PALETTES`; split `js/scene.js` (~2.9k lines) into `scene-core.js` /
  `scene-car.js` / `scene-decor.js` / `scene-fx.js` loaded in order from `index.html` (plain
  script tags, shared closure state must become explicit `DD._sceneShared` or stay in one
  file — propose the split in the walkthrough BEFORE moving code). Tests + a full visual pass.
- **A5 — Impact audio**: filtered-noise wall thud + landing whump in `js/audio.js` (synth
  only, no samples), wired where sparks already fire (`car.hitWall`) and on hard landings
  (`justLanded`/`suspV` spike), volumes under the existing `sfx` setting. No changes outside
  `audio.js`/`game.js` wiring lines.
- **A6 — Sign polish**: arch chevrons currently face one way — add the mirrored glyphs on the
  back face (same InstancedMesh, +4 instances/sign); check `buildCornerSigns` boards read as
  powered (same emissive-frame treatment as session 17's arch signs).

_Adding new briefs: Claude writes them here (usually spun out of C2/C3/C5 designs); Tibba can
also paste any brief-shaped task directly to Antigravity if it fits the protocol invariants._
