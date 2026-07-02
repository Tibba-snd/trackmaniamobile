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

## Wave 2 — make it exciting to drive (1–2 weeks)

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
