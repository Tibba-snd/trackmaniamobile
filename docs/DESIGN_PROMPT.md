# DRIFTDREAM — Game Design Prompt
*A Trackmania-inspired, procedurally generated, offline time-attack racer for Android.*

This document is the single source of truth. Build exactly this.

---

## 1. Core Fantasy
You drive a stylised open-wheel single-seater through dreamlike, procedurally generated tracks, hunting medals and shaving milliseconds. No opponents on track — only you, the clock, and your ghost. Every track is a puzzle: the quirky physics hide faster lines, cheeky cuts, and air-time tricks waiting to be discovered.

## 2. Pillars
1. **One more run.** Instant restart (<0.5s, single tap). Runs are ~60 seconds. Zero friction between attempts.
2. **Quirky-deterministic physics.** Not realistic — *exploitable*. Identical inputs always produce identical results, so mastery is real.
3. **Dreamstate visuals.** Minimalist gradients, soft glow, floating geometry. The track is light suspended in a dream, not asphalt in a world.
4. **Seeds are tracks.** Every track is a shareable seed string. Same seed = same track, forever, on every device.

## 3. Tech Stack
- **Three.js + custom fixed-timestep physics**, wrapped with **Capacitor** for the Android APK.
- Why: the art style (gradients, glow, simple geometry) is cheap to render — mobile GPUs handle it at 60fps easily. Custom physics (not a physics library) is *required* for the deterministic, tunable, quirky feel.
- Physics at fixed 60Hz tick, render interpolated. All randomness from a seeded PRNG (e.g. mulberry32). No `Math.random` anywhere in gameplay.
- Fully offline. Saves (PBs, ghosts, medals, settings) in local storage. No accounts, no network.
- Target: 60fps on mid-range Android (e.g. ~2021 Snapdragon 7-series), portrait-locked **landscape** orientation.

## 4. Physics (the heart)
A hand-rolled arcade model, tuned for *feel* and *exploits*:

- **Car model:** single rigid body, raycast/spring suspension at 4 corners, no real tire model. Grip is a simple lateral-friction curve with a sharp cliff — push past it and you snap into a slide.
- **Quirks (intentional, Trackmania-spirit):**
  - **Speed-drift:** at high speed a quick steering flick past a threshold enters a low-loss drift that holds speed through corners better than gripping. Hard to trigger, satisfying to chain.
  - **Sticky downforce:** above a speed threshold the car gains fake downforce — full-throttle lines through banked turns and over crests that "shouldn't" work.
  - **Air control:** small pitch/roll authority mid-air. Landing flat preserves speed; nose-first landings scrub it. Jump distance/orientation is a skill.
  - **No-grip surfaces:** "glass" track segments where steering barely works — you commit to a line before entering.
  - **Booster pads & jump pads:** placed by the generator, instant velocity changes, exploitable in combination.
  - **Wall-riding:** track borders are low glowing rails; riding them costs a little speed but can straighten a line. Sometimes the wall *is* the racing line.
- **Speeds are high** (top speed feels like 400+ km/h), steering response is crisp and digital-friendly, gravity slightly heavy so jumps feel punchy.
- Crash = no damage. Hitting an obstacle hard kills speed (the real punishment is the clock). **Falling off the track auto-respawns at the last checkpoint** with the velocity you had crossing it (TM-style). Full restart always one tap away.
- **Baseline surface feels like asphalt** — solid, predictable, grippy — regardless of how it looks (the dream visuals are skin, not behavior). Special surfaces (glass, boost) are clearly visually distinct exceptions.

## 5. Track Generation
- **Input:** seed string (e.g. `DREAM-7F3K2`) + difficulty tier (1–5).
- **Method:** graph-grammar / piece-based assembly, like Trackmania blocks but procedural:
  - Library of parametrised pieces: straights, sweepers, hairpins, chicanes, banked turns, crests, jumps (with tuned landing zones), loops/corkscrews (tier 4–5), boost sections, glass sections, wall-ride alleys.
  - Generator picks and connects pieces under constraints: target length ≈ 45–75s, difficulty budget (each piece has a difficulty cost), guaranteed flow (a validation pass simulates a bot run to confirm the track is completable and estimates the **author time**).
  - **Character variety:** beyond visuals, each seed gets a *track personality* — the generator biases piece selection toward an archetype (speedway, technical, rhythm/jumps, vertical, drift-heavy, mixed...) so tracks differ in how they *drive*, not just how they look. Consecutive randoms avoid repeating the last archetype.
  - **Checkpoints** every ~10–15s of driving, placed at piece boundaries. They are respawn points (position + stored velocity) and split-time gates (live +/– delta vs PB ghost).
  - **Track width varies** — per seed and per section: wide flowy sweeps can funnel into narrow technical ribbons and back. Width is part of the generator's difficulty budget.
  - Tracks are point-to-point or looped (generator decides; looped tracks show 1 lap).
- **Medal times** derived from the validation bot: Author (bot's optimised run), Gold (+8%), Silver (+20%), Bronze (+45%).
- **All elements appear from tier 1** — glass, loops, wall-rides, jumps included — but rarer, shorter, and gentler at low tiers. Higher tiers: more air, more glass, tighter lines, longer tracks, wilder verticality. Maximum variety from the first track.

## 6. Visual Style — "Dreamstate Minimal"
- **Every track must feel unique.** The seed drives a **theme system**, not just a palette: each generation picks a combination of palette family (dusk, dawn, abyss, neon, pastel, monochrome+accent...), atmosphere (clear, foggy, starfield, aurora, rain-of-light...), world motif (floating slabs, light pillars, soft spheres, ring arches, crystalline shards, low gradient mountains...), track surface treatment (solid gradient, edge-lit dark, soft-banded, shimmer...), and time-of-dream lighting. Thousands of combinations; two consecutive tracks should never read as the same place.
- **Palette:** each track gets a generated 2–3 stop gradient sky from the seed. Everything else derives from that palette.
- **Track:** smooth ribbon geometry with a soft emissive edge-glow; surface is a subtle gradient, checkpoint gates are thin rings of light. Glass sections are translucent; boosters pulse.
- **World:** floating minimal geometry in the distance (gradient slabs, soft spheres, light pillars), slow-drifting fog, god-ray-ish bloom. No textures with detail — color, gradient, and light only.
- **Car:** open-wheel single-seater silhouette (nose, halo hint, exposed wheels) but rendered as a smooth gradient-shaded form with glowing accents; light trail at speed.
- **Car customisation (cosmetic only in v1, zero performance effect):**
  - **Colors:** body gradient (pick 2 stops or presets), accent/glow color, trail color, wheel glow.
  - **Surfaces:** finish styles — matte gradient, glossy, iridescent shimmer, translucent "glass," emissive neon-edge.
  - **Forms:** a handful of body shape variants (classic long-nose, stubby retro, sleek arrow, halo-canopy...) and wheel styles — all identical hitbox and physics.
  - Garage screen with live rotating preview; loadout saved locally.
- **Post:** bloom (cheap), slight chromatic shift at top speed, FOV stretch with speed, speed-line particles. All toggleable for performance.
- **UI:** ultra-minimal. Big centered timer, checkpoint split deltas (+/– vs PB ghost), thin gradient typography. No chrome.

## 7. Controls (configurable)
- **Default:** tilt to steer (gyro, adjustable sensitivity + deadzone, calibrate-on-start), **right thumb = gas**, **left thumb = brake/reverse**. A drift/handbrake action on double-tap-gas or dedicated button (configurable).
- **Alternatives in settings:** on-screen steer zones (left/right halves) or virtual buttons; auto-throttle mode (steer + brake only); button remap and resize.
- **Restart:** persistent small restart button + two-finger tap anywhere = instant full restart. Single-finger long-press = respawn at last checkpoint.

## 8. Structure & Replayability
- **Campaign:** 5 tiers × 10 curated seeds (hand-picked good generations, shipped as seed lists). Medals gate tier unlocks (e.g. 15 bronze unlocks tier 2... gold-heavy for tier 5).
- **Today's Dream:** daily seed derived from the date — everyone in the world gets the same track each day, fully offline. Its own menu tile with your daily PB.
- **Random track:** one tap → new seed at chosen tier. "Keep" button saves it to **My Tracks**.
- **Seed entry/share:** type or paste any seed; share via OS share sheet as plain text.
- **Ghosts:** PB ghost always available (semi-transparent gradient car), medal ghost (the bot's author run) toggleable. Ghost data stored locally per seed.
- **Stats:** per-track attempt count, PB history; profile totals (medals, distance, airtime).

## 9. Audio
- **Engine with gears:** a synthesized engine (Web Audio, no samples) with a virtual gearbox — RPM rises through each gear, audible shift drop on upshift, downshift blips on braking, rev-limiter buzz at redline. The timbre is quirky/dreamy (think synth-formula-car: layered saws + sub hum + airy whine) rather than a realistic recording, but the *behavior* is a real gearbox. Gear shifts are automatic; RPM/gear shown subtly in HUD.
- Boost pads pitch the engine up momentarily; glass sections add a crystalline ring under the engine; air time filters the engine to a distant hum until landing.
- Generative ambient pads matching the track palette (calm, dreamlike), synth whoosh tied to speed, soft musical chimes for checkpoints (pitch rises with each gate), gentle "bloom" sting for medals. All volumes separately adjustable.

## 10. Scope Guardrails (v1)
- **In:** everything above.
- **Out (v1):** multiplayer, online leaderboards, accounts, track editor, replays-as-video, performance-affecting car upgrades/economy, ads/IAP.

## 11. Definition of Done (v1)
- 60fps on mid-range Android, deterministic physics (same seed + same input recording = same time), full campaign playable offline, ghost racing works, controls fully configurable, instant restart, every generated track completable and medal-rated.

---

## Decisions log
- Tech: Three.js + custom deterministic physics + Capacitor. ✔
- Camera: chase cam. ✔ Controls: tilt steer + touch gas/brake by default, fully configurable. ✔
- Structure: seeded tracks + medals + campaign. ✔ Daily seed in v1. ✔
- Falling off = checkpoint respawn with stored velocity (TM-style). ✔
- Track feel: varied width, mixed flowy/technical per seed; baseline grip behaves like asphalt. ✔
- All track elements present from tier 1, scaled by difficulty; 5 difficulty tiers. ✔
- Strong per-seed variety: visual theme system + track personality archetypes. ✔
- Quirky synth engine with full gearbox audio (auto-shifting). ✔
- Cosmetic car customisation in v1: colors, surface finishes, body forms — no performance effect. ✔
- Name: **DRIFTDREAM** (working title, fine for now). ✔

## Decisions log — round 2 (playtest feedback)
- Physics rebuilt as a **two-axle slip model**: front wheels steer (with TM-style input ramp), rear wheels drive (friction circle). Donuts, power oversteer, brake-tap drift entry, countersteer, and speed-drift all emerge from the model. ✔
- **Drivable terrain**: off-track = dirt (≈45% grip, heavy drag, ~100 km/h cap) — shortcuts possible, exploration encouraged; checkpoint gates must be physically passed (proximity check) or finish is blocked. ✔
- **Guardrails** on ~70% of pieces (glowing rails); open sections + jumps are where you can leave the track. ✔
- **Real gap jumps** (jumpgap piece) + fixed launch physics (car releases from track instead of sticking). ✔
- Slide feedback: tire smoke, screech audio, dirt rumble; body stays flat (no lean-tilt), front wheels visibly steer. ✔
- New pieces: jumpgap, tightening-radius corner. ✔

## Open questions
1. Portrait support ever, or landscape-only forever? (Building landscape-only until decided.)
