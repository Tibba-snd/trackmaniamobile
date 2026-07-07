# DRIFTDREAM — TRACK / TERRAIN / CAR-FEEL MASTERPLAN (2026-07-07)

_Tibba-directed. Scope: world generation, track characteristics, walls, car–track collision,
z-fighting, ghosts, interactivity. Claude specs + phases; individual items become BRIEFS.md
entries when picked up. Physics items (`DD.PHYS`, physics.js) stay Claude-owned per the
hard invariants._

## Diagnosis (what the code says today)

| Complaint | Root cause found |
|---|---|
| No reason to leave track, can't get back on | Terrain embankment conforms to `minRoadY - 0.85` ([trackgen.js:256](js/trackgen.js#L256)) — a permanent ~0.85 m ledge. Ribbon re-ground needs the car within 0.45 m of road top ([physics.js:238](js/physics.js#L238)), so once you're on dirt you physically cannot climb back. Dirt physics exist (grip 0.5, drag) but there is nothing out there: no shortcuts, no aprons, no reward. |
| Walls weird + punishing | `postWallClamp` ([physics.js:549](js/physics.js#L549)) clamps only the car **centre** at one sample — nose clips through on angled hits. Wall friction is a whole-velocity multiply per contact **tick** (0.97 @60 Hz ≈ −84%/s in a sustained scrape; the "light scrape" branch still ≈ −20%/s). The constant was tuned twice; the real bug is per-tick application, not the value. |
| Tracks shallow, variety/looks lacking | Grammar is solid (14 pieces, archetypes, pacing curve, 1 signature/track, loop closure) but: no crossovers/over-unders (collision grid already *allows* Y-sep ≥ 14 — never exploited), soft elevation corridor (y 2..55), only 3 signature recipes, no corner furniture beyond signs/kerbs. Closed circuits also have a literal 2 m ribbon hole at the seam (buildRibbon never stitches last→first quad). |
| Car collision box bugs / clipping | Single-point grounding (centre) + up-to-2 m upward snap (`ha >= -2.0`) — side clips teleport the car up onto the deck. Invisible 2.2 m shoulder band extends flat past the visible road edge, so the car hovers on nothing. No front/rear contact points → nose buries on crests, landing pose is fake. |
| Coplanar flicker / z-fight | Camera near plane 0.1 with far 6000 ([game.js:2239](js/game.js#L2239)) wastes depth precision; decals sit at ad-hoc heights (kerb .035, centre .05, edge .06, glass/boost .07, landing .09) with no polygonOffset — at distance they quantize onto the road plane and fight. |
| Ghosts jagged + ugly | Playback lerps on **integer physics tick** ([game.js:1156](js/game.js#L1156)) while the player mesh is render-interpolated — ghost steps at 60 Hz on a 120 Hz screen. Frames store pos+yaw only → ghost is always flat (no pitch/bank), wheels bury on crests/banking. Ghost build = full car at opacity 0.3 → transparent-sorting artifacts + expensive. |
| Brake-tap slide = "shunt, then snap" | Entry is binary: `brake > 0.4` above 45 m/s latches the slide the same tick full `brakeDec` (34 m/s²) lands — the shunt is the brake pulse itself. Grip↔slide is a hard model swap ([physics.js:399](js/physics.js#L399)), the angle stabiliser *seeks* 0.6 rad at stiffness 3.5 with no ramp (car whips sideways), and `slideCoupling` 2.2/s drags the velocity vector onto the nose — rail-grab, not a slide. Throttle plays no role above `powerOversteerV` (45), so it isn't a *power*slide, and nothing (sfx/smoke/HUD) scales with slip angle, so the 45→62 m/s assist window is invisible — players can't perceive the state they're supposed to modulate. |

## PHASE 1 — Feel fixes (walls, collision, z-fight, ghost motion)

**1.1 Wall physics rework** _(physics.js — Claude)_
- Two-point clamp: test front/rear axle points (`pos ± fwd·1.55`) each against their own nearest sample; resolve deepest first. Kills nose clip-through; angled hits push the correct end out.
- Impulse-based scrape: replace whole-velocity multiply with tangential friction proportional to the normal impulse (μ ≈ 0.4), so cost scales with how hard you actually hit. Micro-contacts (< 0.15 m/s) free.
- Yaw response: front-point hit nudges nose away from wall (small torque) instead of the "magnet wall" feel.
- Keep bounce 0.08. Add spark burst + scrape loop scaled by normal impulse (audio hook exists via `car.hitWall`).

**1.2 Collision box / grounding** _(physics.js — Claude)_
- Four-point ground pose: sample road height at 2 axles (reuse neighbor samples, no extra trackQuery); pitch/roll from real contacts. Fixes crest nose-bury and fake landings.
- Upward snap hysteresis: allow `ha >= -2.0` re-ground only if ribbon-grounded last tick; otherwise `ha >= -0.9`. Kills the side-clip teleport-up.
- Shoulder honesty: give the 2.2 m shoulder real geometry (beveled strip, −0.35 slope, painted) so physics band = visible surface; no more hovering on air.

**1.3 Z-fight elimination** _(scene files — delegable)_
- Camera near 0.1 → 0.35 (chase cam never closer than ~2 m; verify garage cam).
- `DD.DECAL` height ladder — one constant per overlay (kerb .03 / glass .05 / centre .07 / edge .09 / boost .11 / landing .13), all offsets read from it; `polygonOffset(-1,-1)` on every NormalBlending road decal; additive strips raised onto the ladder too.
- Stitch the closed-circuit ribbon seam (last→first quad when `track.closed`, incl. road body + edge strips).

**1.4 Ghost motion + look** _(game.js + scene-car — split: motion Claude, visuals delegable)_
- Smooth playhead: fractional frame index from the tick accumulator alpha; Catmull-Rom position over 4 frames; angle-lerp yaw. (30 Hz data splines fine — no format change needed.)
- Real pose: ghost runs its own cheap `trackQuery` window → sample `u`/pitch/bank → `poseCar` with true up vector. Airborne: hold last up, pitch from velocity.
- Hologram material: one ShaderMaterial for the whole ghost (fresnel rim + scanlines, accent by type: PB cyan / author gold), depthWrite off, no shadows/lights. Prettier AND cheaper than 20 transparent PBR mats. Optional thin fading trail ribbon.
- Save format untouched (still pos+yaw @30 Hz). If jumps look wrong later, v2 = +pitch/roll floats behind a version byte.

**1.5 Powerslide rework — from "shunt + snap" to a readable, throttle-held slide** _(physics.js — Claude; tune live via the physdev menu)_

Design target (unchanged purpose, honest feel): slide is the fastest tool **only** in corners too
sharp for the grip regime's yaw cap at speed; grip stays fastest on sweepers; lift-and-turn stays
the mid-speed tool. The slide must build progressively, be modulated on throttle + steer, and be
audible/visible the whole time.

- **Soft entry (kill the shunt):** during the latch window (~first 0.25 s of `slideHold`) cap the
  *effective* brake at ~0.5 — a tap reads as weight transfer, not an anchor. Entry angle builds on
  a slew (~0.3–0.4 s to target), not a stiff seek: rate-limit `targetBeta` and drop `slideStab`
  ≈ 3.5 → ~2.0.
- **Blend the regimes:** crossfade grip-model and slide-model yaw/lateral outputs over ~0.2 s on
  every `slideState` transition (both directions). No more one-tick personality change.
- **Honest cornering force:** cut `slideCoupling` 2.2 → ≤ 1.2 and recover the cornering power
  physically — rear lateral force peaks near a real optimal slip angle (~12–18°) with mild falloff
  past it, so a car held *at* the angle genuinely grips. The path tightens because the tire works,
  not because an invisible hand rotates the velocity vector.
- **Put the power in powerslide:** while sliding at speed, throttle sustains/extends the angle
  (small yaw-out moment + scrub compensation), lift decays it, deeper brake deepens it. Continuous
  inputs → continuous response → players get reaction time. (Replaces the binary `sdBoost` exploit;
  keep a small clean-exit reward when the angle is released under throttle.)
- **Telegraph the state:** tire chirp on latch; skid volume + smoke density scale with |beta|;
  subtle camera yaw-lag while sliding. The 45→62 m/s gate softens to a ramp (~38→58, tunable) so
  mid-speed taps produce small, learnable slides instead of nothing-then-everything.
- **Acceptance tests (encode in `tests/`):** three scripted corners — sharp-fast (slide must win
  by ≥ 0.2 s), long sweeper (grip must win), slow hairpin (grip/lift must win). Tuning is done when
  all three hold; no more feel-only regressions.

## PHASE 2 — A world with reasons (off-track purpose + re-entry)

**2.1 Re-entry aprons** _(trackgen + physics)_
- New per-sample flag `s.apron` (derived rng stream `::apron`): outside edges of straights/sweepers get periodic 20–30 m spans where the embankment conform target blends from −0.85 to −0.10 (flush). Drive off, drive back on. Visual: painted apron wedge + edge glow dims across the span so it reads as an invitation.
- Respawn stays for chasms/void; aprons make *casual* off-tracks recoverable without ⚑.

**2.2 Dirt shortcuts (risk/reward off-track)** _(trackgen + scene-decor)_
- Generator picks 1–2 corner chords per track (hairpin/tighten with clear terrain between entry/exit): carve a smoothed dirt corridor in the heightfield (own rng stream), clear decor along it, mark entry/exit with cone gates + tire-mark decal.
- Dirt is slower per meter (0.5 grip / 0.62 accel already) but the chord is shorter → genuine line choice, TM-style. Bot ignores them → medals stay based on the road line; a skilled cut beats author honestly.
- Checkpoint audit: shortcut must not skip a gate (choose chords within a checkpoint span).

**2.3 Fake forks (cheap route choice)** _(trackgen + scene-decor)_
- On extra-wide pieces (≥ 1.3× base), drop a median island (glow bollard row, 60–120 m): left lane tight/short, right lane banked/fast — one ribbon, zero sim change, reads as a route decision.

**2.4 Kerb/shoulder feedback** _(physics + audio — small)_
- Driving the kerb band excites `suspY` + rumble sfx; apron/shoulder gets distinct surface sound. Sells all of the above.

## PHASE 3 — Track depth, variety, looks

**3.1 New grammar pieces** _(trackgen; each = new rng stream, bot-validated)_
- `corkscrew` — 270–540° constant-radius climb/descent (pitch ±0.14), pillars auto-spawn.
- `bowl` — huge-radius 180° with bank 0.5–0.7, half-pipe walls both sides.
- `overunder` — mid-track piece that aims back across an earlier segment with Y-sep ≥ 16, then rejoins heading. The collision grid already permits it; add a "seek crossing" bias instead of avoidance. Bridge moment + pillars + underpass lighting = instant drama.
- `ridge` — crest run with terrain uplift pulled tight both sides (canyon rim feel).
- `dirtcut` — ribbon span with `SURF.DIRT` (physics already complete) for rally sectors.
- Weights: sprinkle into archetypes (vertical gets corkscrew/overunder, drift gets bowl, rhythm gets ridge).

**3.2 Signature recipes** _(trackgen — small once 3.1 lands)_
- Add `mountain_pass` (ridge→corkscrew→bowl), `spaghetti` (overunder→banked→overunder), `rally_stage` (dirtcut→crest→dirtcut). Keeps the 1-signature-per-track system, triples the memorable moments.

**3.3 Elevation ambition** _(trackgen)_
- Widen the soft y-corridor (2..55 → 2..90) for `vertical`/`speedway`; scale support pillars + `TERRAIN_RISE` accordingly. Tracks should earn skyline moments.

**3.4 Track dressing** _(scene-decor — delegable)_
- Braking boards (100/50) before detected `corners[]`; apex cones; hazard chevron paint on `tighten`; start grid slab + gantry countdown lights; distance-to-finish boards each 25%; checkpoint ring variety per biome. All instanced/merged, decal ladder heights.

## PHASE 4 — Fun layer + true forks

**4.1 Boost rings** — on jump/gap flight paths (fit to the bot's recorded parabola); pass-through = small boost + chime. Static, deterministic, bonus-only.
**4.2 Drift-score zones** — marked sweepers score held slide angle; full meter = spark shower + small exit boost. Rewards the core mechanic where it's optimal anyway.
**4.3 Destructible bollards/cones** on aprons + shortcut gates — fling on contact, zero speed cost (juice, not punishment).
**4.4 Speed traps** — radar gate + HUD popup + per-track top-speed stat on the finish card.
**4.5 True branches** _(big — design note required)_ — dual-ribbon fork/merge as a piece pair; needs branch-aware `trackQuery`, checkpoint gating on both limbs, bot on main limb. Only after 2.2/2.3 prove route choice is fun.

## Guardrails (apply to every phase)

- Determinism: every new random choice = new derived rng stream (`seed + '::feature'`); existing seeds must reproduce byte-identical tracks unless the brief says regeneration is intended (then bump track cache key + note save migration).
- Every trackgen change re-runs bot validation (`DD.buildValidTrack`) + drivability suite; goldens re-baseline knowingly, never silently.
- Closed-circuit rule: all new sample scans wrap modulo N when `track.closed`.
- Physics tuning (`DD.PHYS`, wall/grounding) = Claude-reviewed, not delegated.
- Perf: everything scene-side instanced/merged, decals on the ladder, no new real-time lights (light pool rule). GPU is fill-rate bound — geometry is cheap, overdraw is not.

## Suggested order of attack

1. **1.1 + 1.2** (wall + collision) — biggest daily-feel win, pure physics.
2. **1.5** (powerslide rework) — same file, same session as 1; land the acceptance tests with it.
3. **1.4** (ghost motion/look) — visible quality jump, isolated.
4. **1.3** (z-fight ladder + seam) — mechanical, delegable alongside 3.
4. **2.1 + 2.4** (aprons + kerb feel) — makes the world forgiving.
5. **2.2 / 2.3** (shortcuts, forks) — route choice arrives.
6. **3.x** then **4.x** as content waves.
