# Car Rebuild — Implementation Spec (Plan 3)

_Prepared 2026-06-24 (session 10). NOT yet implemented. Pick this up in a fresh session._

User-approved scope: **rebuild the car from scratch (Option B)** — a single, coherent, curvy
monocoque instead of overlapping scaled spheres; **remove** the levitating halo torus, the flat 2D
additive discs, and the floaty glow rings; **wheels with visible tread/spokes** so rotation actually
reads. Keep full garage customization (paint gradient / finish / form). All work is in
`js/scene.js` `DD.buildCar` (currently ~line 2012) + `DD.poseCar` + `DD.buildShadow`, plus a
**required** update to `tests/verify_m2_features.js`.

Verify visually with the screenshot workflow in memory `driftdream-preview-harness-limits`
(resize → `__fit()` sizes renderer to the real viewport → drive the sim synchronously → `preview_screenshot`).
**Do not use CSS `mask` or stacked `filter` anywhere that gets captured — `mask` hangs the capture.**

---

## 1. HARD CONTRACT — things that MUST still be true after the rebuild

`DD.buildCar(garage, ghost, envMap)` returns a `THREE.Group` that the rest of the engine pokes at.
Preserve every one of these or things break:

**Group hooks consumed elsewhere:**
- `group.wheels` — array of the 4 wheel `Group`s. Each wheel `Group` has `userData.spinGroup`
  (the part `poseCar` spins) and is positioned at the wheel location. `poseCar` does
  `w.userData.spinGroup.rotation.x += wheelSpin`.
- `group.frontWheels` — the front 2 wheel groups; `poseCar` sets `w.rotation.y = steerVis*1.1`
  (so the STEER rotation must be on the wheel group, the SPIN on its inner `spinGroup`).
- `group.userData.iridescent` — the body-hull material when finish==='Iridescent', else null
  (game.js loop animates its `.emissive`/`emissiveIntensity` for the shimmer).
- `group.userData.boostShell` — the body-hull material (game.js pulses its emissive on boost pads).
- `group.userData.baseEmis` (clone of boostShell.emissive) + `group.userData.baseEmisI`
  (its emissiveIntensity) — captured so the boost pulse can restore baseline.
- `group.userData.grad` — the gradient `{a:[r,g,b], b:[r,g,b]}`; `DD.buildTrail(carMesh.userData.grad)`
  uses it for the light-trail colours.
- `setShadows(group)` traversal at the end sets `castShadow/receiveShadow` on every child with a
  geometry (skipped when `ghost`). Keep it.

**Materials / inputs:**
- `garage = { grad, finish, form }` indices into `DD.GARAGE.gradients|finishes|forms`.
- `ghost===true` → translucent, dimmed, low envMapIntensity (a faint replay car).
- `envMap` is `scene.environment`; apply to the reflective PBR materials.
- Finish table (metal/rough/clearcoat/ccRough) per finish name — keep the `fin{}` map.
- Gradient paint: shell colour = `lerp(grad.a, grad.b, t)` pulled toward dark metal (liveried look,
  not a bright toy). Keep that darkening for the body.

**Wheel positions** (the contact-shadow shader hardcodes these — see §4):
`FL(-0.86, 1.5L)`, `FR(0.86, 1.5L)`, `RL(-0.9, -1.35L)`, `RR(0.9, -1.35L)`, radii ~0.34 front / 0.42
rear, where `L = form length scale`. Keep wheels near these or update the shadow shader to match.

---

## 2. verify_m2_features.js — REWRITE it, don't design around it

This test is a **brittle presence-check, not a meaningful invariant** — it sniffs exact primitives
(`SphereGeometry(1,26,16)` body, an exactly-8-child wheel `spinGroup`, a `BoxGeometry` with
`w===1.05`). None of that is behaviour worth protecting; it just freezes the old primitive car in
place. **Do not let it constrain the design.** Rewrite it (or drop the over-specific asserts) so it
checks only the things that actually matter — i.e. the §1 contract:
- `DD.buildCar(...)` returns a group with `wheels.length===4`, each `wheel.userData.spinGroup`, and
  `poseCar` increments `spinGroup.rotation.x` (the one genuinely useful assert — keep it).
- The body hull material (`group.userData.boostShell`) is a `MeshPhysicalMaterial` with clearcoat.
- A transmissive canopy material exists (`material.transmission > 0`).
- The carbon material has a `bumpMap` canvas texture.
- `DD.buildShadow()` returns a ShaderMaterial mesh with the `sdBox` contact-shadow shader.

Practical notes for whoever rewrites it:
- The test runs headless under a **minimal hand-rolled THREE mock** (top of the file). Any new
  `THREE.*` constructor the rebuild calls (e.g. `Shape`, `CatmullRomCurve3`, `LatheGeometry`,
  `ExtrudeGeometry`, `TubeGeometry`) must be added as a no-op mock there or `require('../js/scene.js')`
  throws. If the rebuild leans on a lot of new geometry math, consider guarding the heavy car-build
  code so it no-ops cleanly under the mock, and assert against simpler signals.
- Other tests don't touch the car and should still pass: `drivability`, `verify_determinism`,
  `verify_colors`, `verify_sky_stars`, `verify_camera`. Run them after regardless.

---

## 3. The eyesores to REMOVE (current `buildCar`, Formula-Neo branch unless noted)

- **Levitating halo torus** — `if (F.halo) { TorusGeometry(0.28,0.05,…) at (0,0.66,0.05) }`
  (~line 2171). Delete it (or, if a halo is wanted, anchor it with two thin struts down to the
  monocoque so it isn't floating).
- **Flat 2D additive discs** — sidepod `intake = CircleGeometry(0.12,12)` with `glowMat` (~2145).
  Delete or replace with a real recessed intake in the hull.
- **Floaty glow rings** — Vanguard thruster `TorusGeometry` rings (~2274). Replace with solid nozzle
  geometry + a small emissive core that sits inside the nozzle.
- **Wheel "halo" rim + glowing bar spokes** — `rim = TorusGeometry(...) glowMat` (additive) and 5
  `glowMat` box spokes (~2297-2309). The bright additive ring reads as a halo. Replace with a SOLID
  metal rim + solid spokes (MeshStandard, not additive); a thin emissive accent line is OK but keep
  it subtle and on the rim, not a glowing torus.
- **Self-clipping body** — the mono/cockpit/sidepod scaled spheres + cones intersect. Replaced
  entirely by the single lofted hull (§4).
- Thin additive livery lines (side panel line ~2150, nose light bar) — keep as accents but make sure
  they sit flush on the surface, not hovering.

---

## 4. The rebuild design — aesthetics first

**This is the point of the whole rebuild: make the car genuinely *look good*.** It's small on screen,
seen from a chase cam, against a neon-dusk world, so the priorities are (in order):
1. **Silhouette** — it must read instantly at small size and from behind. Long low nose, a clear
   cockpit bump, wide muscular rear, a distinct rear wing. Think modern Le Mans hypercar / F1 / a
   sleek concept single-seater — flowing, planted, fast-looking even when still.
2. **Clean continuous surfaces** — no self-intersecting blobs, no faceted mess. Smooth flowing
   panels that catch the dusk reflection and the neon rim. The current car fails here (overlapping
   scaled spheres); fixing this is most of the win.
3. **One tasteful accent** — a single emissive livery line/strip that follows the bodywork (in
   `grad.b`/accent) for the neon-dream character. No floating discs/halos/rings.
4. **Stylized, not hyper-detailed** — at this scale and for perf, the **Imphenzia low-poly look**
   (few clean planes, elegant proportions, smooth normals, let the PBR finish + bloom do the work)
   reads better than greebles. Greebles become noise and cost draw calls.

### Buildable techniques (researched — pick ONE primary)
Three (the bundled older r1xx) has no car primitive, so the body is procedural. Two dependency-free,
deterministic options, both producing ONE smooth hull mesh (~1 draw call, fewer meshes than today):

**Option A — Lofted cross-sections along a spine (RECOMMENDED).** Most control, no new dependency.
- A centreline from nose (`+z`) to tail (`−z`). Define smooth half-width `w(z)`, height `h(z)`, and
  vertical centre `cy(z)` (use `smoothstep`/sin so it tapers: pointed low nose → cockpit swell →
  haunches over the rear wheels → narrow tail). Add a top dip at the cockpit station for the canopy.
- At each of ~18–24 stations build a ring of ~12–16 points on an ellipse
  `(w·cosθ, cy + h·sinθ)`, with the lower points clamped toward a flat floor (cars are flat-bottomed).
  Optionally widen the ring locally over the wheels to suggest fenders/haunches.
- Stitch consecutive rings into quads → one `BufferGeometry`, `computeVertexNormals()`, cap nose/tail.
  ~60 lines, fully deterministic. This is the classic "loft", and CatmullRom can smooth the profile
  curves if hand-tuning the functions is fiddly.

**Option B — Low-poly cage + subdivision (the "stylized smooth" look).** Box-model a blocky car cage
(a dozen boxes), merge, then run a Loop subdivision pass to smooth it (`three-subdivide` /
`BufferGeometryUtils`). Gorgeous results (this is how Imphenzia-style cars are made) BUT: adds a
dependency, must match the bundled three version, and subdividing **per car load (and the ghost
doubles it)** is a real load-time cost. Only choose this if A's hand-tuned curves can't hit the look;
if used, subdivide ONCE and cache the geometry, and skip subdivision for the ghost.

> Recommendation: **Option A.** It's dependency-free, deterministic, cheap, and gives full silhouette
> control. Prototype the `w/h/cy` profile functions, screenshot the bare hull from 3 angles, iterate
> the curves until the silhouette sings, *then* add canopy/wings/wheels.

### Components
- **Hull**: the lofted mesh above. Material = `bodyMat(gradMix(0.5))` (MeshPhysical, clearcoat,
  gradient livery pulled toward dark metal, envMap). **This is the `boostShell`/`iridescent` hull** →
  wire `group.userData` to it.
- **Canopy**: one smooth transmissive bubble (scaled half-ellipsoid or a small loft) seated INTO the
  cockpit dip so it doesn't clip. Keep `cockpitMat` transmissive (clearcoat, transmission, ior).
- **Wings**: front splitter + rear wing as clean beveled slabs (`ExtrudeGeometry` with bevel reads
  nicer than raw boxes), endplates, a thin flush emissive light bar on the rear wing.
- **Livery seam**: one thin emissive strip following the spine/flank. Flush, subtle.
- **Wheels (must read as rotating)** — 4 `Group`s, each with an inner `spinGroup`:
  - Tyre: rounded (`TorusGeometry` or beveled cylinder), dark rubber (MeshStandard rough ~0.85).
  - **Visible motion cue** (the user's explicit ask): SOLID contrasting spokes (MeshStandard, NOT
    additive bars) and/or a tread/sidewall marking, so rotation is obvious — the old smooth black
    cylinder hid it. Pick a spoke count; that sets the new wheel child-count for the rewritten test.
  - Rim/hub: SOLID metal. Optional thin subtle emissive rim accent — NOT a glowing torus halo.
  - Keep wheel world positions per §1 (or update the shadow shader). `poseCar` spins
    `spinGroup.rotation.x`, steers front `rotation.y`. At 60 fps the spin is smooth (the eval pump's
    low fps exaggerated aliasing).
- **Forms** — keep the 4 `DD.GARAGE.forms` as *coherent variations of the same hull* (vary
  length/width/canopy/wing/rear via the profile params), not primitive swaps. Each sets the
  `userData` hooks and builds wheels.

### Implementation specifics (validated with Gemini, 2026-06-24)
A research pass with Gemini confirmed **lofting** (subdivision rejected: runtime CPU cost + UV pain),
and produced these concrete, turnkey details:

- **Frame = fixed world-up, NOT Frenet.** Frenet/Frenet-Serret frames flip on a near-straight spine
  (normal depends on 2nd derivative → twists the rings into a helix). Per station: tangent `T`
  (forward); right `N = normalize(T × [0,1,0])`; up `B = N × T`. Project each 2D cross-section point
  onto the `N` (width) / `B` (height) plane. Cheap, stable, no twisting. (For DRIFTDREAM the spine is
  basically straight along `z`, so this is essentially a constant basis — even simpler.)
- **Turnkey 9-station cross-section** (normalized, total length 4.0, `z` from +2 nose → −2 tail;
  `halfWidth` = spine→edge on X, `height` = ring Y-thickness, `yOffset` = ring centre above floor Y=0).
  Drop in and tune:

  | # | station | z_pct | halfWidth | height | yOffset | feature |
  |---|---------|-------|-----------|--------|---------|---------|
  | 1 | nose tip      |  1.00 | 0.10 | 0.05 | 0.05 | needle nose point |
  | 2 | nose cone     |  0.75 | 0.22 | 0.12 | 0.08 | upward wedge |
  | 3 | front axle    |  0.50 | 0.65 | 0.18 | 0.10 | flared fenders (width peak) |
  | 4 | waist start   |  0.25 | 0.38 | 0.35 | 0.18 | coke-bottle pinch; canopy rises |
  | 5 | mid cockpit   |  0.00 | 0.48 | 0.50 | 0.25 | max bubble + sidepods |
  | 6 | engine bay    | -0.25 | 0.42 | 0.32 | 0.16 | canopy drops into engine cover |
  | 7 | rear axle     | -0.50 | 0.70 | 0.24 | 0.12 | rear flare (widest point) |
  | 8 | rear deck     | -0.75 | 0.55 | 0.14 | 0.08 | flat low deck (wing base) |
  | 9 | tail cutoff   | -1.00 | 0.50 | 0.08 | 0.06 | sharp Kammback |

  Clamp the bottom ring vertices to a hard flat base (`yOffset − height/2`) → a crisp floor splitter
  line that catches track shadow.
- **End caps:** do NOT collapse the nose/tail rings to a single point — `computeVertexNormals()` then
  pinches and shades badly under bloom. Terminate with a small flat vertical ring + a cap triangle
  fan, or weld + average boundary normals.
- **Hard edges:** duplicate vertices where you want a crease (e.g. sidepod-meets-floor) to break the
  smoothing group → crisp premium reflections instead of a soft blob.
- **Wheels — keep the geometric spin** (`spinGroup.rotation.x`); Gemini's honest call was that a
  UV-offset/shader fake looks flat at this size because speculars don't shift across edges. To kill
  the wagon-wheel strobe, change WHAT spins: **solid, slightly-concave "turbofan" disc wheels**
  (Le-Mans/cyberpunk look) with a heavy stepped outer rim — very low-poly, gorgeous sweeping
  speculars under neon, zero spoke aliasing. Paint a **bold ASYMMETRIC neon graphic on the disc face**
  via a canvas texture: reads as rotation at low speed, blurs into a clean neon halo at speed (no
  stepping). Optional tread: tileable texture with `map.offset.y += velocity*dt` and
  `minFilter=LinearMipmapLinearFilter` + `anisotropy=getMaxAnisotropy()` to avoid moiré.

### Integration solutions (agreed with Gemini)
- **Wheels are ground truth (coordinate reconciliation).** Don't derive wheel anchors from the
  normalized table — bend the loft to the engine's fixed wheel anchors + the contact-shadow boxes.
  Stations 3 (z_pct +0.5) and 7 (−0.5) sit over the axles, so their normalized separation (1.0) =
  the world wheelbase. Scale: `worldLen = wheelbase × 2.0` (table spans +1..−1 = 2.0 normalized);
  per vertex `worldZ = z_pct × wheelbase + centerZ`, with `centerZ = (frontZ + rearZ)/2`. Fenders
  then always sit over the wheels regardless of the physics wheelbase. Pass the engine's **track
  width** into the builder and clamp stations 3/7 `halfWidth` to the wheel inner lip so the fender
  never pierces or floats off the tyre.
- **Canopy = recessed tub + separate glass + gasket trim (NO boolean cut).** Keep the hull solid;
  at stations 4–6 the upper ring vertices form a shallow recessed cockpit valley. Build the
  transmissive canopy as a SEPARATE mesh (teardrop / half-cyl cap) whose rim seats DOWN into the
  valley, and generate a raised dark non-reflective **gasket/trim ring** around the tub boundary to
  mask the intersection. Avoids z-fighting and a floating-bubble seam; the canopy keeps its own
  transmissive `cockpitMat`.
- **4 forms = ONE builder + config (not 4 loops).** A single car builder parses
  `{ table, wingType, canopyScale, trackWidth }`. Pitfalls: (1) **UV stretch** on longer variants —
  compute the V texture coord from **cumulative world-distance along the spine**, not `i/stationCount`;
  (2) **fender scrape** — clamp station 3/7 halfWidth to a safety offset from the wheel inner lip.

### Aesthetic acceptance test (objective floor — agreed; final taste sign-off stays with Tibba)
Pass/fail spec checked from 3 screenshots (front-3/4, side, top-down) + a 2-frame wheel diff:
- (a) **Silhouette scalability** — downscaled to ~120×60px, the negative-space gap between tyres and
  the undercarriage stays a visible line of pixels (if it blobs into a dark mass → fail).
- (b) **Coke-bottle pinch** — front axle and rear axle must be clearly wider than the waist:
  `station3.halfWidth / station4.halfWidth ≥ 1.5` AND `station7.halfWidth / station4.halfWidth ≥ 1.6`.
  (NOTE: Gemini wrote this ratio inverted — `waist/axle` — which is wrong; the table values
  0.65/0.38 = 1.71 and 0.70/0.38 = 1.84 satisfy the CORRECTED axle/waist form above.)
- (c) **Canopy ratio** — canopy front-to-rear Z length ≤ 25% of total bounding-box length.
- (d) **Topological integrity** — the hull is ONE unified BufferGeometry; zero overlapping primitive
  meshes for the core body.
- (e) **Strobe check** — a 2-frame diff at max velocity (≈3 ticks apart) shows the wheel's asymmetric
  disc graphic rotated **30°–150°**; landing near 0/180/360° means wagon-wheel — adjust graphic weight
  or the spin multiplier.
- (f) **Specular continuity** — orbit one DirectionalLight on Y; the highlight band must sweep
  linearly down the flank. Any flicker / flashing dark polys = reversed indices or un-averaged normals
  at a station seam.

Sources (research): Gemini (this session, plan agreed flaw-free), [three.js docs](https://threejs.org/docs/),
[ExtrudeGeometry](https://threejs.org/docs/pages/ExtrudeGeometry.html),
[three.js geometry guide](https://learnwithhasan.com/threejs-guide/geometry/),
[three-subdivide](https://github.com/stevinz/three-subdivide),
[three.js subdivision example](https://threejs.org/examples/webgl_modifier_subdivision.html),
[three-low-poly](https://github.com/jasonsturges/three-low-poly),
[low-poly cars (Imphenzia-style)](https://github.com/nbogie/three-js-cars-3).

---

## 5. Wiring checklist (do not forget)
- [ ] `group.userData = { iridescent, boostShell, baseEmis, baseEmisI, grad }` set from the HULL material.
- [ ] `group.wheels` (4) + `group.frontWheels` (2) populated; each wheel `userData.spinGroup`.
- [ ] `ghost` path: translucent/dim, low envMapIntensity, no shadows.
- [ ] `setShadows(group)` at the end (non-ghost).
- [ ] envMap passed into all reflective materials.
- [ ] Bump `js/scene.js?v=` in `index.html`; if `game.js` changes too, bump it; re-copy
      `index.html` + `js/scene.js` into `apk-build/www/`.
- [ ] Update `tests/verify_m2_features.js` finders + add THREE mocks for any new geometry type.

## 6. Verification — an efficient car-inspection harness

Do NOT drive races to inspect the car (slow, the car is tiny on a chase cam). The **garage showcase
is a ready-made close-up turntable** — use it. One reusable eval + a handful of screenshots covers
everything. (Screenshot prerequisites: `__fit()` sizes the renderer to the real viewport; avoid CSS
`mask`; see memory `driftdream-preview-harness-limits`.)

**Harness (one eval, paste once):** `__inspectCar(angleDeg, garageOverride)` that:
- ensures `G.state==='garage'` and the showcase car is built (`buildGarageMenu`/`updateShowcaseCar`),
  optionally applying `{grad,finish,form}` first;
- frames the car with a fixed close orbit camera at `angleDeg` (reuse the garage orbit math: set
  `G.garageDragYaw` or position the camera directly at radius ~6, height ~2.2, looking at the car);
- calls `DD.poseCar(carMesh, [0,0,0], 0, [0,1,0], 0, 0, wheelSpin, steer, 0)` so wheels/steer pose;
- `__fit()` + `G.composer.render()`. Then `preview_screenshot`.

**Checklist (≈6 screenshots total):**
1. **Silhouette** — capture front-3/4, side, rear-3/4 (`angleDeg` 35 / 90 / 215). Confirm: elegant
   flowing form, no self-clipping, no floating halo/discs/rings, reads well small.
2. **Wheels rotate** — two captures at the same angle with `wheelSpin` advanced between them
   (e.g. call `__inspectCar` twice, bumping `spinGroup.rotation.x` by ~0.6 rad between); compare
   spoke positions → they must visibly move. Also bump `steer` to confirm front wheels turn.
3. **Customization** — re-capture with 2–3 `{finish}` (Gloss / Iridescent / Neon Edge) and a couple
   `{form}` values; confirm paint gradient, finish, and chassis form all still apply.
4. **In-context sanity** — ONE in-race shot (existing drive harness) to confirm it reads at chase-cam
   distance against the neon world and the boost-glow/trail still work.

**Then:**
5. `node --check js/scene.js`; `node tests/verify_m2_features.js` (rewritten) → pass;
   `node tests/drivability.js verify_determinism.js verify_camera.js verify_colors.js` → pass.
6. Foundation re-check: draw calls (car should be **fewer** meshes now), `gl.getError()` 0,
   light pool still 12/0/1.
7. Update `STATUS.md` + `ARCHITECTURE.md` §6 (car description) once it lands.

## 7. Key file/line touchpoints (as of session 10)
- `js/scene.js`: `DD.buildCar` ~2012, wheel loop ~2287, `userData` wiring ~2371-2380,
  `setShadows` ~2382, `DD.poseCar` ~2447 (consumes wheels/frontWheels), `DD.buildShadow` ~2474
  (sdBox boxes hardcode wheel positions), `getCarbonTexture` (carbon weave map).
- `js/game.js`: boost-glow + iridescent shimmer read `carMesh.userData.*` (~loop body);
  `DD.buildTrail(G.carMesh.userData.grad)` in `startTrack`.
- `tests/verify_m2_features.js`: car asserts ~308-352.
- Garage UI: `js/game.js buildGarageMenu`; `DD.GARAGE` in `js/theme.js`.
