# DRIFTDREAM — Kickoff Prompt (start-from-zero, lessons baked in)

Paste this into a fresh Cowork project to build the game right the first time. It encodes what
worked and the mistakes that cost the most time on the first build.

---

## The pitch (give the agent this verbatim)

> Build **DRIFTDREAM**: a Trackmania-inspired, procedurally-generated, **offline** time-attack
> racer for Android. One stylised open-wheel car, seeded tracks (~45–75s each), medals, ghosts,
> instant restart. Dreamlike **warm-dusk** art: dark reflective asphalt ribbon, neon edge-glow,
> rolling dunes far below the track, glowing chevron/beacon corner signage, bloom. Feel must be
> **planted and precise but drift-on-demand** — like Trackmania tarmac, not a sim, not twitchy.
> Reference image attached (`visual_concept.jpg`) — match it.

Attach a reference image FIRST. Lock the look before writing render code.

---

## Tech (decided — don't relitigate)
- **Three.js (r128) + custom fixed-60Hz deterministic physics**, plain `<script>` files (no
  bundler), wrapped with **Capacitor** for the APK. Pure offline, localStorage saves.
- Module layout from day one: `core` (seeded RNG + vec math + save), `theme` (per-seed palette),
  `trackgen` (piece-grammar + terrain + corner data), `physics` (car + gearbox + headless bot),
  `audio`, `input`, `scene` (all rendering), `game` (loop/state/HUD). Keep physics & trackgen
  **THREE-free** so they run in Node for testing.

---

## BUILD ORDER (this ordering is the #1 lesson)

1. **Headless test harness FIRST.** Before gameplay polish, write `tests/drivability.js` that
   runs physics+generation in pure Node. Assert: steering direction, braking, reverse cap, a
   grip ladder (lateral g at low/mid/high speed), slide+recovery, slalom (no spin), donut,
   brake-tap drift, jump airtime, gearbox 0-100 + downshift cut, generated tracks all
   bot-completable, and **determinism** (same seed → identical medal time). Re-run after EVERY
   physics change. This caught real bugs (inverted steering, reverse runaway, high-speed spin).

2. **A visual screenshot loop, EARLY.** Stand up a headless-Chrome screenshot runner
   (`testMode` URL params: `seed`, `tier`, `mockKeys`, `autodrive`, `duration`, screenshot on a
   console trigger). Without this, art direction is blind guesswork — the single biggest time
   sink on the first build was iterating visuals without being able to see them.

3. Physics core → trackgen → renderer → audio → structure → Capacitor.

---

## PHYSICS — the model that worked (skip the dead ends)
Two-axle arcade model, but the key insight learned the hard way:
- **Two regimes.** Normal driving = a **yaw-rate target**: stick position maps to a *proportional
  fraction of the corner*, grip-capped so pure throttle can never spin. Full slip dynamics
  engage **only when the player asks** for a slide (brake-tap, drift button, low-speed wheelspin,
  ice). Pure emergent slip dynamics alone felt vague ("car points but doesn't go") — don't ship that.
- **Flat grip curve** (~2.5g low → ~3.5–4g high via downforce). Wildly speed-varying grip feels
  inconsistent and unlearnable.
- **Smooth tire saturation** (no hard clamp/cliff) + crisp turn-in (~0.12s) = capable, not twitchy.
- **Gearbox IS gameplay**: per-gear accel, torque rising with rpm, real shift cuts on
  up/down-shift (the Trackmania "gear-drop" punishment). Don't make gears just a sound effect.
- Diagnose feel with **numbers**: measure sideslip (heading vs velocity angle) AND turn-in time
  before tuning. "Understeer" was actually turn-in lag, not sideslip — only measuring revealed it.
- Medals from a **headless bot** lap; author ≈ bot×0.82. Falling off → checkpoint respawn w/ carried speed.

---

## VISUALS — go warm-dusk from the start (don't drift into flat/pastel)
- **Dark reflective asphalt** (PBR, low roughness, env map) is the single biggest "real game" cue.
- **Real bloom** (official UnrealBloomPass UMD passes) — threshold ~1.05, strength ~0.7, exposure
  ~0.95 so only neon blooms, NOT the sky (a high threshold prevents white-out blowouts).
- **ACES tone mapping**, PMREM environment map for reflections.
- **Terrain sits well BELOW the track** as a gentle basin (≥8m clearance). Do NOT make terrain
  follow/meet the track — it endlessly clips. The track reads as a ribbon above dunes (the concept).
- **Fog must be distant** (near ~700m+, far ~3000m+). Close pale fog looks like a "cloud wall"
  swallowing the track — a real bug we hit twice.
- Corner language: glowing chevron boards on the outside of sharp turns, brake-marker bars across
  the track, a tall apex beacon. Bias palettes toward **warm dusk**; avoid washed grey/mono themes.
- Car: sculpted sleek dark body (not a stack of bright primitive boxes), glowing accents, contact
  shadow, spinning wheels, visible front-wheel steer at the *actual* (small, speed-scaled) angle.

---

## HARD-WON GOTCHAS (put these in the agent's standing instructions)
- **Verify every change.** Node-test physics; screenshot visuals. Never declare a fix done blind.
- **Cache & sync discipline.** Add `?v=N` cache-bust query to all `<script>` srcs and bump it on
  every change — browsers silently serve stale JS. If using Capacitor, the `www/` copy is separate;
  re-sync it or the APK runs old code. Several "your fix didn't work" reports were stale code.
- **Determinism is sacred** — seed every RNG, no `Math.random` in gameplay. Enables ghosts, shareable
  seeds, and reproducible tests.
- **Trust the user's eyes over your assumptions.** When they said "terrain is fine," the bug was fog;
  when they said wheels point wrong, the visual was amplifying raw input not the real steer angle.
  Diagnose the actual element, don't re-tune the thing you assumed.
- Keep a living `STATUS.md` (1000-ft view: what's solid, what's left, file map, gotchas) so any
  session can resume instantly.

---

## Definition of done (v1)
60fps mid-range Android; deterministic; full offline campaign (5 tiers) + daily + random seeds;
ghost racing; medals; tilt+touch+key controls (configurable); instant restart; planted-but-drifty
feel passing the drivability suite; and a render that visibly matches `visual_concept.jpg`.
