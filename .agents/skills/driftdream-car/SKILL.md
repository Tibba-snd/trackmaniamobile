---
name: driftdream-car
description: Handles player car visual models, spec schemas, presets, custom parts, materials, textures, wheels rendering, and showcase positioning.
---

# DRIFTDREAM player car system

This skill details how the player car is designed, rendered, and customized. Always read **`CAR_DESIGN_SYSTEM.md`**, **`CAR_PROJECT.md`**, and **`CAR_REBUILD_PLAN.md`** before making visual or mesh changes.

## File Map
- **Visuals / Render / Mesh construction:** `js/scene.js` → `DD.buildCar(garage, ghost, envMap)` (which wraps `buildCarFromSpec`), `DD.buildCarFromSpec(spec, ...)`, part builders (`DD.CAR_PARTS`), wheel style builders (`DD.CAR_WHEEL_BUILDERS`), and shadow rendering.
- **Spec Schema / Presets / Normalization:** `js/carspec.js` (Three-free). Contains `DD.CAR_SCHEMA` (clamping boundaries), `DD.normalizeSpec` (contract guardrails), `DD.CAR_PRESETS` (locked starting configurations: Apex, Endurance, Neon, Classic), and `DD.resolveSpec`.
- **Showcase / Garage UI:** `js/game.js` → `buildGarageMenu()`, `updateShowcaseCar()`, and the garage state handlers.

## Visual & Mesh Render Contract
When modifying or extending `buildCar`, you must maintain the following invariants:
1. **Local Frame:** The car mesh must orient +Z forward, +Y up, with the origin `(0,0,0)` at ground center (directly between axles).
2. **Wheel Groups:** The returned group must contain `group.wheels` (array of 4 wheel Groups) and `group.frontWheels` (array of front 2 wheel Groups). Each wheel group needs its `userData.spinGroup` defined, which `poseCar` uses for rotating the tires (`spinGroup.rotation.x += wheelSpin`).
3. **Materials:** Reflection map (`envMap`) must be correctly applied to PBR physical materials. Boost pads pulse the emissive value of `group.userData.boostShell` (usually the main body physical material).
4. **Data Properties:** The group's `userData` must store `boostShell`, `iridescent`, `baseEmis`, `baseEmisI`, `grad`, and `hardpoints`.

## Design Rules
- Keep the `js/carspec.js` data layer completely separate from Three.js rendering libraries.
- For customizing wheels/colors/parts, ensure they are checked against `DD.normalizeSpec` to protect performance and prevent invalid boundaries.
- Verify changes with `node tests/verify_m2_features.js`.
