---
name: driftdream-car
description: Work on the DRIFTDREAM player car — the 3D car model/build (DD.buildCar in js/scene.js), the garage customization (paint/finish/chassis via DD.GARAGE), the car physics (js/physics.js), wheel movement/steer/suspension (DD.poseCar), and the contact shadow. Use whenever editing the car's geometry, materials, garage options, how it drives, or how its wheels/pose render.
---

# DRIFTDREAM car

Read **`CAR_PROJECT.md`** (full knowledge: model, garage, physics, wheels, lessons) and
**`CAR_REBUILD_PLAN.md`** (the validated from-scratch rebuild spec + aesthetic acceptance test) before
making changes. This skill is the operational checklist.

## Where things live
- **Render/model:** `js/scene.js` → `DD.buildCar(garage, ghost, envMap)`, `DD.poseCar(...)`,
  `DD.buildShadow()`/`DD.updateShadow()`, the wheel loop.
- **Physics:** `js/physics.js` → `DD.PHYS` (tuning table), `DD.createCar`, `DD.stepCar`, `updateGear`.
- **Garage + loop:** `js/game.js` → `buildGarageMenu`, `updateShowcaseCar`, the `loop()` (physics→poseCar).
- **Cosmetics:** `DD.GARAGE` (gradients/finishes/forms) in `js/theme.js`. Save: `save.garage{grad,finish,form}`.
- Three.js is **r128 global** (`window.THREE`), no bundler/build step. `physics`/`core`/`theme`/`trackgen`
  are THREE-free (Node-testable).

## The contract — NEVER break these when touching buildCar
`buildCar` returns a `THREE.Group` with:
- `group.wheels` (4 wheel Groups, each `userData.spinGroup`) + `group.frontWheels` (front 2) —
  `poseCar` does `spinGroup.rotation.x += wheelSpin` and `frontWheel.rotation.y = steerVis*1.1`.
  (Empty arrays = static wheels, allowed.)
- `group.userData.{boostShell, iridescent, baseEmis, baseEmisI, grad}` — boost-glow pulse, iridescent
  shimmer, and trail colour read these. `boostShell` = the body-shell material.
- `setShadows(group)` (cast/receive) for non-ghost; `ghost` → translucent/dim; apply `envMap` to PBR mats.
- The car's **local frame must be +Z forward, +Y up, origin at ground-centre** (what poseCar expects).
- `verify_m2_features.js` encodes this contract — update it if you change the structure, and add THREE
  mocks there for any new geometry constructor or `require('../js/scene.js')` throws.

## Garage: how to add/extend customization
1. Add the option list to `DD.GARAGE` (`theme.js`). 2. Read `garage.grad/finish/form` in `buildCar` and
apply (color = gradient, PBR params = finish, proportions = form). 3. Add a tab + `gItem`s in
`buildGarageMenu` (`game.js`); selecting must persist + call `updateShowcaseCar()`.

## Physics & wheels (quick map)
- 60 Hz deterministic, two regimes (grip default / slide on drift-brake-ice). Gearbox is the puzzle
  (`gearV`/`gearAccel`, shift cuts). `rpm01` = position in current gear → drives tach/shift-light/engine.
- Render reads `pos,yaw,vel,rollVis,pitchVis,wheelAngle,suspY,gear,rpm01,shiftCut,sliding,slideState,
  slipMax,boostGlow,onDirt,grounded`.
- Wheels: spin increment `wheelSpin = speed*dt*2.2` (loop), steer `= car.wheelAngle` (real radians),
  bob `= car.suspY`. Fused-mesh models can't spin — overlay spin groups or go static.
- Don't add `Math.random` to anything affecting race outcome/goldens (determinism is load-bearing).

## Aesthetic reality (hard-won)
- Coding a smooth premium body blind = programmer art. At chase-cam scale, **connection + planted stance
  + crisp edges** matter far more than aero detail. The current loft is a coherent *patch* (soft ceiling).
- Higher ceiling = an **artist/AI glTF mesh** (Meshy → decimate with `gltf-transform` to ~85k tris,
  textures→1K; load via r128 `GLTFLoader`; bake +90°Y, scale ~1.9×, recentre; wheels are usually fused).
  Full path documented in `CAR_PROJECT.md` §6–7.

## Verify
- `node tests/verify_m2_features.js` + `node tests/drivability.js` + `node tests/verify_determinism.js`.
- Visual: use the **garage showcase as a turntable**. Preview gotchas: size the renderer to the real
  viewport (the buffer can collapse to 1×1), `rAF` is paused when hidden (drive the sim synchronously),
  and **never use CSS `mask`** on anything captured (it hangs `preview_screenshot`).
- After editing `scene.js`/`game.js`: bump the `?v=` in `index.html` and copy into `apk-build/www/`.
