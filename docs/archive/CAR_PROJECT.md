# DRIFTDREAM — Car Project Knowledge (model · garage · physics · wheels)

_Everything learned about the player car, for spinning into a dedicated project. Pairs with
`CAR_REBUILD_PLAN.md` (the from-scratch rebuild spec) and the `driftdream-car` skill._

All car code is **`js/scene.js`** (render: `DD.buildCar`, `DD.poseCar`, `DD.buildShadow`, wheels) +
**`js/physics.js`** (simulation: `DD.createCar`, `DD.stepCar`, `DD.PHYS`) + **`js/game.js`** (the loop
that ties physics→render, and the garage UI). Three.js is **r128**, loaded as a global (`window.THREE`),
**no build step / no bundler**. `core`/`theme`/`trackgen`/`physics` are THREE-free and run under Node
(that's what the tests exercise).

---

## 1. The render model — `DD.buildCar(garage, ghost, envMap)`

Returns a `THREE.Group` (the car) and is **rebuilt per race load**; the ghost replay car is a second
build with `ghost=true`. It is the heaviest per-load allocation — keep it cheap.

### 1a. The hard contract (other systems poke these — never break them)
- **`group.wheels`** — array of the 4 wheel `Group`s. Each wheel has **`userData.spinGroup`** (the
  inner group `poseCar` rotates for roll). Empty array is allowed (static wheels) — `poseCar` no-ops.
- **`group.frontWheels`** — the front 2 wheel groups; `poseCar` sets their `rotation.y` for steering.
- **`group.userData.boostShell`** — the body-shell material. The loop pulses its emissive on boost pads.
- **`group.userData.iridescent`** — that material when `finish==='Iridescent'`, else `null` (the loop
  animates its emissive hue for the shimmer).
- **`group.userData.baseEmis`** (clone of boostShell.emissive) + **`baseEmisI`** (its
  emissiveIntensity) — baseline captured so the boost pulse can restore it.
- **`group.userData.grad`** — the paint gradient `{a:[r,g,b], b:[r,g,b]}`; `DD.buildTrail(grad)` uses it
  for the light-trail colour.
- A `setShadows(group)` traversal sets `castShadow/receiveShadow` on every geometry child (skipped for ghost).
- `ghost===true` → translucent/dim/low envMapIntensity. `envMap` is `scene.environment` (the captured cube
  probe) — apply to reflective PBR materials.

### 1b. Current implementation: a lofted procedural monocoque (post Option-C patch)
A single `BufferGeometry` lofted from cross-section rings along a **straight z-spine** (the spine is
straight, so the frame is just the constant world basis — **no Frenet, no twist**). Wheels are ground
truth: stations 3 & 7 sit over the axles, so the loft is scaled to the wheelbase.
- **Station table** `ST = [z_pct, halfWidth, height, yOffset]` (normalized), 9 stations nose(+1)→tail(−1):
  ```
  [ 1.00,0.10,0.05,0.05] [0.75,0.22,0.12,0.08] [0.50,0.62,0.18,0.10]
  [ 0.25,0.36,0.32,0.18] [0.00,0.46,0.46,0.24] [-0.25,0.42,0.30,0.18]
  [-0.50,0.66,0.24,0.18] [-0.75,0.52,0.18,0.24] [-1.00,0.44,0.12,0.30]   ← rear yOffsets raked up (diffuser)
  ```
  Scaled by `WIDTH=1.18, HEIGHT=0.92, YB=0.05`; `worldZ = z_pct*wheelbase + midZ` with `frontZ=1.5L`,
  `rearZ=-1.35L`. fenders clamped `min(halfWidth,0.70)*WIDTH` to stay just inside the wheels.
- Each ring: K=18 points, **rounded top + flat floor** (`y = sin≥0 ? yc+hgt/2·sin : floorY`). Rings stitched
  into quads; nose/tail **capped with a centroid fan** (NOT collapsed to a point — that pinches normals
  under bloom).
- **Carbon underfloor**: a flat `BoxGeometry` in the carbon material (procedural weave canvas + bumpMap).
- **Canopy**: a low transmissive glass bubble (`cockpitMat`, transmission 0.65 / ior 1.52) seated into a
  wider dark "cockpit tub" (recessed read, hides the seam).
- **Wings**: front splitter slab + a raised rear wing on a **central pylon rooted into the raked deck**,
  thin endplates, an emissive trailing bar.
- **Wheels** (`wheelDefs` at `±0.86 front / ±0.9 rear`, z `1.5L/-1.35L`, r `0.34/0.42`): solid "turbofan"
  disc (tyre cylinder + face disc + hub + an **asymmetric emissive accent blade** that reads rotation
  without wagon-wheel strobe). Geometric spin kept (see poseCar).
- **Suspension**: per wheel, 2 carbon A-arms + a hub upright bridge body→hub so wheels don't float.
- The 4 legacy primitive `form` branches are neutralized (`if(false)`) — **dead code, safe to delete**.

**Honest ceiling:** the lofted body reads soft/organic and the rear wing is a touch boxy. This is a
*patch*, not a premium body. The higher-ceiling path is an artist/AI mesh (see §6).

### 1c. The garage forms
`F = DD.GARAGE.forms[garage.form]` picks proportion params `{len(L), noseLen, wing, halo}`. Currently the
loft uses `L` and `F.wing`; the 4 forms are NOT yet meaningfully differentiated (all share one hull). A
real per-form variation would vary the station table / wing / canopy per form.

---

## 2. `DD.poseCar(group, pos, yaw, u, rollVis, pitchVis, wheelSpin, steerVis, bob)`

Called every render frame from `game.js` to place the car from physics state.
- Position = `pos + u*bob`. Orientation = a basis `makeBasis(right, up, fwd)` where `up = u` (surface
  normal), `fwd` = yaw direction projected onto the surface, `right = up × fwd`. So the car's **local +Z =
  forward, +Y = up, +X = right** — any model must be authored/baked to that frame.
- Then `rotateZ(rollVis)` (lean into corners) and `rotateX(pitchVis)` (squat/dive).
- **Wheel roll:** for each `group.wheels`, `w.userData.spinGroup.rotation.x += wheelSpin`.
- **Wheel steer:** for each `group.frontWheels`, `w.rotation.y = steerVis * 1.1`.

### Wheel movement specifics
- **`wheelSpin`** is passed from the loop as `G.wheelSpin = speed * dtReal * 2.2` (an *increment* per
  frame; the wheel keeps accumulating rotation.x). The ghost's wheels spin at the ghost's own recorded
  speed.
- **`steerVis`** = `car.wheelAngle` — the **real** front-wheel angle in radians (`physics.js`):
  grounded `car.wheelAngle = delta` (the actual steer delta, not amplified); airborne `= -steerPos*0.3`.
- **`bob`** = `car.suspY` (suspension travel, clamped ±0.22) — a spring (`suspV += (-110·suspY −
  11·suspV + excitation)·dt`) driven by landings/bumps.
- A model with **fused wheels** (one mesh) can't use this — you'd overlay 4 spin groups at the wheel
  anchors, or accept static wheels.

---

## 3. The contact shadow — `DD.buildShadow()` / `DD.updateShadow()`

A single ground plane with an **SDF shader** (`sdBox`) drawing a soft body blob + 4 wheel blobs
(`dBody/dFL/dFR/dRL/dRR`). The wheel-box positions are **hardcoded to the wheel anchors** (`±0.86,1.5` /
`±0.9,-1.35`). If you move the wheels, update this shader too. `updateShadow` projects/orients it under the
car each frame. (`verify_m2_features` asserts the sdBox shader exists.)

---

## 4. The garage feature

- **`DD.GARAGE`** (`js/theme.js`): the cosmetic option lists —
  - `gradients`: 8 named two-stop paints `{name, a:[r,g,b], b:[r,g,b]}` (Dream, Sunrise, Deep, Venom,
    Cherry, Ghostly, Noir, Gold).
  - `finishes`: `['Matte','Gloss','Iridescent','Glass','Neon Edge']` → `buildCar` maps each to PBR params
    (metalness/roughness/clearcoat/ccRough). Glass = translucent; Iridescent = animated emissive hue;
    Neon Edge = permanent emissive rim.
  - `forms`: `['Formula Neo','Prototype X','Hyperion','Vanguard']` → chassis proportion params.
- **Save** (`core.js`): `save.garage = { grad, finish, form }` (indices), persisted in the single
  `localStorage` key `driftdream_v1`. Defaults: `{ grad:6, finish:1, form:2 }`.
- **UI** (`game.js buildGarageMenu`): three tabs (paint/finish/chassis); each option is a `gItem` button;
  selecting calls `g.grad/finish/form = i`, persists, rebuilds the menu, and **`updateShowcaseCar()`**
  (dispose + `DD.buildCar` again). The garage state orbits the showcase car (loop `menu/garage` branch:
  `orbitSpeed`, `radius`, `height`, plus pointer-drag `G.garageDragYaw`).
- `buildCar` reads `garage.grad/finish/form` (mod list length) at the top. **So any new customization is:
  add to `DD.GARAGE`, read it in `buildCar`, add a tab/items in `buildGarageMenu`.**

---

## 5. The car physics — `js/physics.js`

Deterministic **60 Hz** (`TICK = 1/60`), THREE-free. Single tuning table **`DD.PHYS`** (the source of
truth). A **two-axle slip model** (front steers, rear drives) with **two regimes**:
- **Grip regime** (~95% of driving): a grip-capped proportional yaw target — stick maps to a fraction of
  the corner; pure throttle can't spin the car; slip dynamics bypassed.
- **Slide regime** (only when *asked*: drift button, brake-tap, low-speed wheelspin, or ice): full
  lateral-force integration with a smooth saturating tire (no grip cliff), slide hysteresis
  (`slideEnter→slideExit`), and a continuous **auto-countersteer assist** that catches unwanted breakaways.

### Key `PHYS` constants
- **Gearbox (the puzzle):** `gearV` upshift speeds `[0,14,24,38,56,78,109]` (6 gears); `gearAccel`
  `[26,22,18,14,11,8.5]` peak accel/gear; `rpmTorqueLo 0.6` (torque rises to 1.0 up a gear);
  `shiftCutUp 0.10s`, `shiftCutDown 0.26s` (downshift hurts); `downshiftHyst 0.86`. `vmax 108 m/s` (~390km/h).
- **Chassis:** `wheelbase 3.1`, `yawInertia 2.2`. **Steering:** `steerMaxLow 0.62 → steerMaxHigh 0.19` rad
  (lock shrinks with speed), `yawMax 1.4 rad/s`, `yawTrack 15`, ramp up/down `14/18`.
- **Tires (consistency over realism — flat grip curve ~2.8g→3.6g):** `gripF 15`, `gripR 16` (rear bias =
  stability), `stiffK 10`, `tireKnee 2.2`; invisible assists `steerAssistLim 1.4`, `overdriveGain 0.4`,
  `counterAssist 16`. `downforceK 0.085` (grip rises with speed). Brake/throttle grip mults create
  drift entry (`brakeRearGripMul 0.5`, `driveRearGripMul 0.45` below `powerOversteerV 45`).
- **Surfaces** (`DD.SURF` NORMAL/GLASS/BOOST/DIRT): glass ≈ frictionless ice, boost extra accel
  (`boostAccel 30`), dirt reduced grip/drag. `sdBoost 1.4` = speed-drift exploit.
- **Air** (`stepAirborne`): brake stabilises rotation, steer spins, throttle/brake set landing pitch.

### The car state object (`DD.createCar`) — what render/audio/HUD read
`pos, vel, yaw, yawRate, steerPos, gear, rpm01, shiftCut, suspY, suspV, wheelAngle, pitchVis, rollVis,
grounded, onDirt, idx, slideState, sliding, slipR/slipF, slipMax, airTime, surf, finished, missedCkpt,
nextCkpt, time, splits, boostGlow, respawns`.
- Render uses: `pos, yaw, vel` (speed), `rollVis, pitchVis, wheelAngle, suspY` (→poseCar), `gear, rpm01,
  shiftCut` (HUD gear/tach), `sliding, slideState, slipMax` (drift FX: sparks/skid/trail/smoke + the
  drift-flash), `boostGlow` (body emissive pulse), `onDirt/grounded` (smoke, car-up = terrain normal).
- `updateGear`: picks gear from speed via `gearV` + hysteresis; `rpm01` = position within the current gear
  `(speed-lo)/(hi-lo)`. This drives the tach + the shift-light + engine audio pitch.

---

## 6. The render↔physics link (`js/game.js` loop)

`play` state: fixed-timestep accumulator steps `DD.stepCar(car, input, track)` at `TICK` (≤4 substeps).
Render interpolates `drawPos = lerp(prevPos, pos, alpha)`, `drawYaw` similarly. Then:
```
speed = len(car.vel); speedNorm = speed/PHYS.vmax;
G.wheelSpin = speed * dtReal * 2.2;
carUp = (car.onDirt && terrain) ? terrainNormal(...) : sample.u;   // car banks to terrain off-road
poseCar(carMesh, drawPos, drawYaw, carUp, car.rollVis, grounded?suspV*0.04:pitchVis, wheelSpin, wheelAngle, suspY);
updateShadow(...); updateTrail(...); updateSkidmarks/Smoke/Sparks(...); updateCamera(...);
```
Input comes from `DD.pollInput(settings)` (keys/tilt/touch) → `{steer, throttle, brake, drift}`. The bot
(`DD.getBotInput`) drives in `testMode + autodrive`.

---

## 7. Lessons learned (the important part)

1. **Procedurally sculpting a *smooth, premium* car body in code is the wrong tool** — you're editing
   vertices blind; even with a perfect hardpoint plan it reads as "programmer art." Escalating verbal
   plans (S-ducts, superellipse intakes, shark fins) compound guesses; they don't converge on a Porsche.
2. **At chase-cam scale, fundamentals dominate aero detail:** wheels must visibly *connect* (suspension
   arms / fender flare), the car must sit *planted*, edges should be *crisp*. Those four ("floating
   wheels, floating wing, glued-on canopy, sagging tail") were the whole problem — not missing intakes.
3. **The lofted body + Option-C patch** (suspension arms, rooted wing, recessed canopy, raked tail) makes
   it *coherent* but soft — a low ceiling. Good enough as a placeholder; not premium.
4. **The higher-ceiling path is an artist/AI mesh (glTF).** We proved it works: a Meshy `car.glb`
   decimated 850k→85k tris (`gltf-transform weld+simplify --ratio 0.04 --error 0.01`, textures→1K, ~5MB),
   loaded via the r128 global `GLTFLoader` (`examples/js/loaders/GLTFLoader.js`), looked great in-engine.
   Caveats: Meshy outputs **one fused mesh** (wheels baked in → no separate spin nodes), modelled
   **lengthwise along X** (bake +90° Y), and needs scaling to the wheelbase (~1.9×) + recentering to
   origin-at-ground-centre, +Z forward. To spin wheels you'd overlay procedural wheels or accept static.
   The full integration was prototyped then reverted by user choice — see git/STATUS session 12.
5. **`CAR_REBUILD_PLAN.md`** holds the Gemini-validated from-scratch spec: fixed-world-up loft frame
   (math), the 9-station table, end-cap/hard-edge gotchas, wheels-as-ground-truth scaling, recessed-tub +
   gasket-trim canopy, one-builder/per-form config, and an **objective aesthetic acceptance test**
   (silhouette/coke-bottle/canopy/strobe/specular pass-fail). Read it before any rebuild.

## 8. Verification (no screenshots needed for logic; eval/inspect for looks)
- Node: `node tests/verify_m2_features.js` (car contract: hull material, carbon bumpMap, transmissive
  canopy, 4 wheels w/ spinGroup poseCar rotates, sdBox shadow), plus `drivability`, `verify_determinism`.
- Visual: the **garage showcase is a ready-made turntable**. The preview can't screenshot a 1×1 buffer
  and `rAF` is paused when hidden — size the renderer to the real viewport, drive the sim synchronously,
  then `preview_screenshot`. **Avoid CSS `mask`** (hangs the capture). See the project memories
  `driftdream-preview-harness-limits` and `css-pseudo-transition-freeze`.
- After any `scene.js`/`game.js` edit: bump the `?v=` cache-buster in `index.html` and re-copy into
  `apk-build/www/`.
