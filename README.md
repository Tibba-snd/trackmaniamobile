# DRIFTDREAM

A Trackmania-inspired, **procedurally-generated, offline time-attack racer**. Warm-dusk /
neon-night aesthetic, deterministic 60 Hz physics, asset-light (everything — tracks, car,
textures, audio — is generated in code at runtime).

- **Engine:** Three.js r128 (vendored in `js/lib/`), plain `<script>` files, no bundler.
- **Mobile:** wrapped with Capacitor for Android (`apk-build/`).
- **Determinism:** a given seed + input sequence yields the identical race time on any device
  (physics/trackgen/core are Three-free and run in Node for testing).

> For *how it works internally*, read [`ARCHITECTURE.md`](ARCHITECTURE.md).
> For *current state, gaps, and the fix backlog*, read [`STATUS.md`](STATUS.md).

---

## Run it

**Web (fastest loop):** open `index.html` directly in a browser, or serve the folder
(`npx serve .`) and open the printed URL. Three.js is vendored, so it works offline.

**Android (Capacitor):**
```bash
# after editing anything in js/ or index.html, sync the copy into the wrapper:
apk-build/sync.bat        # (or sync.sh)   -> copies js/ + index.html into apk-build/www/
cd apk-build/android
gradlew assembleDebug     # needs JDK + Android SDK on the host
```
> ⚠️ `apk-build/www/` is a **synced duplicate** of the root game. Editing `js/` does **not**
> update the APK until you run `sync`. Always develop against the root `index.html`.

---

## Controls

| Action | Keyboard | Touch | Tilt |
|--------|----------|-------|------|
| Throttle | ↑ / W | GAS pad | GAS pad |
| Brake / reverse | ↓ / S | BRAKE pad | BRAKE pad |
| Steer | ← → / A D | ◀ ▶ pads (binary) | device tilt (analog, ±22°·sens = full lock) |
| Drift | **Space** | DRIFT pad | DRIFT pad |
| Restart | R | two-finger tap | two-finger tap |
| Respawn at checkpoint | E | RESPAWN button | RESPAWN button |

Control mode (`tilt` / `touch` / `keys`) resolves from Settings; keyboard is always live for
desktop dev.

---

## Game modes & progression

- **Daily** — seed `DAILY-YYYYMMDD`, fixed tier 3.
- **Random** — seed `DREAM-XXXXX`, tier chosen in the menu.
- **Seed** — type any string; same string always builds the same track.
- **Campaign** — 5 tiers × 10 fixed tracks (`CAMP-T{tier}-{01..10}`). A tier unlocks when you
  hold **≥5 medals** in the previous tier. Each tier has a themed biome + a signature set-piece.
- **Garage** — cosmetic only: paint gradient, finish (Matte/Gloss/Iridescent/Glass/Neon Edge),
  body form (Formula Neo/Prototype X/Hyperion/Vanguard).

Medals (author ◆ / gold / silver / bronze) are computed per-track from a headless bot run.
Personal bests and a **replay ghost** are saved per seed+tier in `localStorage`
(`driftdream_v1`); ghosts are pruned to the 40 most-recent.

---

## Tests

```bash
node tests/drivability.js        # headless physics handling assertions
node tests/verify_determinism.js # identical results per seed across runs
node tests/verify_colors.js      # color-space / palette checks
# host-only (needs Chrome via CDP):
node tests/e2e_runner.js         # deterministic input + golden-screenshot pixel diff
node tests/e2e_runner.js -u      # update golden references after intended render changes
node tests/verify_sky_stars.js   # sky gradient + star placement (browser env)
node tests/verify_camera.js      # chase-camera behavior
node tests/verify_m2_features.js # presence of required car/scene meshes
```
Golden references live in `tests/screenshots/golden/` (the e2e baseline — do not delete).

---

## Repository layout

```
index.html         Entry point: DOM (menus/HUD), CSS (vignette/grain/blur), script loads
js/
  core.js          Seeded RNG, vec3 math (DD.v), save/load, scalar helpers   [Three-free]
  theme.js         Per-seed visual identity: biome, sky colors, accents       [Three-free]
  trackgen.js      Piece-grammar track gen, terrain basin, corner detection   [Three-free]
  physics.js       Deterministic 60Hz car model, gearbox, headless bot, medals[Three-free]
  audio.js         Web Audio synth: engine, wind, screech, dirt, pads, sfx
  input.js         Keyboard / tilt / touch bindings
  scene.js         ALL Three.js rendering (renderer, sky, ribbon, decor, car, fx, camera)
  lib/             Vendored Three.js r128 + UMD post-processing passes
tests/             Node + headless-Chrome test suites; screenshots/golden = baseline
apk-build/         Capacitor Android wrapper (www/ is a synced copy of the root)
docs/              Archived original design + kickoff prompts (historical reference)
visual_concept.jpg Target look reference
```

All runtime code lives under the single global namespace `DD` (assembled across the `js/`
files in load order). There is no module system.
