---
name: driftdream-testing-determinism
description: Handles the project test suite, unit verification tests, Three.js mock constraints, CDP-based E2E screenshot runners, and keeping calculations deterministic.
---

# DRIFTDREAM Testing and Determinism

This skill covers how to run tests, manage the Three.js mock for headless testing, and maintain strict mathematical determinism.

## File Map
- **Tests Directory:** `tests/`
  - `tests/drivability.js`: Unit assertions checking car acceleration, steering, slide thresholds, and braking.
  - `tests/verify_determinism.js`: Verifies that running the same seed with the same input sequence produces identical time outcomes.
  - `tests/verify_colors.js` & `tests/verify_sky_stars.js`: Validates the generative palette and sky limits.
  - `tests/verify_camera.js` & `tests/verify_m2_features.js`: Asserts Three.js structure, chase-cam math, and model meshes.
  - `tests/e2e_runner.js`: End-to-end runner that launches Chrome via Chrome DevTools Protocol (CDP), simulates inputs, and compares screenshots against golden references.
- **Golden Screens:** `tests/screenshots/golden/`

## Determinism Guidelines
- **RNG:** Never use `Math.random()` or new `Date()` inside physics (`js/physics.js`), track generation (`js/trackgen.js`), theme selection (`js/theme.js`), or visual/mesh structures (`js/scene.js`).
- All calculations must be derived from `DD.makeRng(seed)`.
- Replays, medals, and bot inputs rely on bit-for-bit equivalence. Even minor floating-point or random deviations will break the E2E goldens and determinism checks.

## Headless Three.js Mock
- `tests/verify_m2_features.js` uses a hand-rolled Three.js mock at the top of the file to execute `js/scene.js` without loading a real WebGL context in Node.
- If you call a new `THREE.*` constructor or class in `js/scene.js`, you must add a corresponding mock no-op class to the top of `tests/verify_m2_features.js`, or the test runner will crash.

## Running Tests
To verify changes:
- **Run all unit/validation tests:**
  ```bash
  node tests/drivability.js
  node tests/verify_determinism.js
  node tests/verify_colors.js
  node tests/verify_sky_stars.js
  node tests/verify_camera.js
  node tests/verify_m2_features.js
  ```
  *(Or use the `node dd.js test` CLI tool once created)*
- **Run E2E tests:**
  ```bash
  node tests/e2e_runner.js
  ```
- **Update Golden screenshots** (after intentional visual modifications):
  ```bash
  node tests/e2e_runner.js -u
  ```
