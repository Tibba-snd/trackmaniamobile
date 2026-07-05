# DRIFTDREAM — Car Design System (cars-as-data)

_Ground truth for the parametric car system. Pairs with `CAR_PROJECT.md` (engine/contract/physics
knowledge) and `CAR_REBUILD_PLAN.md` (the lofting math + aesthetic acceptance rubric). Supersedes the
old "4 hardcoded `if (form===…)` branches" approach in `DD.buildCar`._

## Goal

A car is **data, not code.** One pure renderer turns any valid spec into the mesh. The 4 "philosophy"
variants (Apex Formula / Endurance Prototype / Neon Speeder / Classic Cigar) are **seed data**, not
branches. In the garage, players **tweak presets, swap/add/remove parts, author brand-new parts, set
per-part colour/material, size wheels/spokes/widths, add glow/lighting features, and save + share**
their designs. The 4 presets are **locked, read-only starting points**; "Customize" deep-clones a
preset into a new editable working spec.

This is only possible if *parts themselves are data*. So the model has three pure-data layers; the only
code is the primitive builders and the renderer.

---

## 1. The three layers (all JSON-serializable, all deterministic)

### Block — the atom
One mesh from one parametric primitive.
```
Block = {
  id,                         // stable id (editing / refs)
  prim: 'box'|'cyl'|'sphere'|'torus'|'loft'|'slab',   // PRIMS registry key
  params: {...},              // prim-specific: box{w,h,d}; cyl{rt,rb,h,seg}; torus{r,tube,seg};
                              //   sphere{r,wseg,hseg,scale}; slab{w,h,d,bevel}; loft{station[],section,clamp}
  at: { pos:[x,y,z], rot:[x,y,z], scale:[x,y,z] },     // local transform inside its Part
  mat: MatRef,                // material slot (+ optional override) — see §3
  mirror: false,              // true → auto-duplicate mirrored across X (place one, get a symmetric pair)
  crease: false,              // duplicate boundary verts → hard edge (crisp reflections) for loft/slab
  cast: true                  // cast/receive shadow
}
```
`PRIMS = { box, cyl, sphere, torus, loft, slab }` maps `params → THREE geometry`. Adding a primitive is
the **only** dev-code extension point; players never need it — they compose Blocks from existing prims.
Every prim must have a no-op mock in `tests/verify_m2_features.js` (the loft uses `BufferGeometry`).

### Part — the prefab
A named, reusable group of Blocks with a semantic mount and exposed knobs.
```
Part = {
  key, label,
  blocks: [Block, ...],
  anchor: 'nose'|'tail'|'roof'|'deck'|'frontAxleL'|'frontAxleR'|'rearAxleL'|'rearAxleR'|'underbody'|'free',
  knobs: { width:{min,max,step,default,label}, ... },   // params the blocks read (drive scale/emissive/etc)
  kind: 'decor'|'wing'|'canopy'|'wheel',                // 'wheel' parts MUST expose userData.spinGroup
  budget: <int>               // block count, for the normalize cap
}
```
Catalog parts (`sharkFin`, `biplaneWing`, `lowSpoiler`, `hoverFins`, `ducktail`, `halo`, `splitter`,
`exhausts`, `exposedEngine`, `hoverChannels`, `turbofanWheel`, `multiSpokeWheel`, `glowDiscWheel`,
`classicSpokeWheel`) ship as **Part data** in `DD.CAR_CATALOG`. A player-authored part is the *same
shape*, saved into the player catalog — no code path difference.

### Car — the spec
Chassis + a list of mounted Part instances. This is what saves/shares.
```
CarSpec = {
  schemaVersion: 1,
  name, basePreset,                       // provenance (which locked preset it forked from)
  chassis: {
    L,                                     // length scale
    hardpoints: { frontZ, rearZ, trackF, trackR, frontR, rearR, tyreW },  // wheels live here → shadow reads these
    hull:  { station:[[z,w,h,y]×N], section:{kind,exp}, fenderClamp, mat:MatRef },
    floor: { w, h, z, mat:MatRef } | null
  },
  mounts: [                                // every add-on incl. wheels, canopy, wings, features
    { part:'biplaneWing' | InlinePart,     // catalog key OR an inline authored Part
      at:{pos,rot,scale}, knobs:{...}, matOverrides:{ slotOrBlockId: MatRef } },
    ...
  ],
  palette: {                               // the design's own colour identity, layered OVER garage paint/finish
    accent:[r,g,b], glowColor:[r,g,b], glowI:0..2, metalBias:-0.2..0.2
  }
}
```
Wheels are 4 `kind:'wheel'` mounts at the `*Axle*` anchors; their geometry comes from the chosen wheel
Part, their size from `chassis.hardpoints`. The hull is authored inline on the chassis (not a mount) so
hardpoints and the loft stay co-located.

---

## 1.5 How players edit a part (the editing model)

All editing is **parametric control-point editing**, never raw per-triangle vertex sculpting (that
breaks serialization/watertightness/normals and is unusable on mobile). A part is editable along three
complementary axes, each backed by a small array of numbers:

- **Loft / length axis** — `prim:'loft'`. Cross-sections (`station[]`) along a spine; CatmullRom between
  them. This is the silhouette editor generalized. Ops: drag a station (`w/h/y`), insert/remove a station
  (= add/remove an edge loop), per-station `ring` overrides (pull individual ring points → local
  bulge/crease), `section.curve` toggle. Hull uses this.
- **Profile / cross-section axis** — `prim:'profile'` = a closed 2D outline `pts:[{x,y,smooth}]` + a sweep
  mode (`lathe` | `extrude` | `sweepAlongSpine`). Ops: drag a point, **split an edge** to insert a new
  movable point, toggle a point **corner↔smooth** (smooth = quadratic round between edge midpoints;
  corner = hard vertex), `mirror` across X for symmetric authoring. Wheels = lathe; wings/ducts = extrude.
- **Lattice / warp axis** — `deform:{ lattice:{nx,ny,nz, offsets:[…]} }` on ANY solid block. A control
  cage around the mesh; dragging cage points bends the enclosed geometry (FFD) without changing its
  topology. This is "add movable points to an existing mesh" for box/cyl/etc.

Mapping of the requested capabilities → mechanism:

| capability | mechanism | stored as |
|---|---|---|
| scale / width / height | block transform + W/H/D | `at.scale` |
| point adjust | drag loft station or profile point | `station[].{w,h,y}`, `profile.pts[]` |
| curves | point `smooth` toggle; loft CatmullRom | `pts[].smooth`, `section.curve` |
| adding edges | insert station loop / profile point | grow `station[]` / `pts[]` |
| add movable points to a mesh | split an edge, or lattice-warp a solid | inserted `pts`, `deform.lattice.offsets[]` |

**Out of scope (by design):** free-form per-vertex sculpting and boolean/CSG cutting. Bespoke shapes use
the glTF import escape hatch (`prim:'mesh'`, baked at import; `CAR_PROJECT.md` §6). All control-point
data is bounded by `normalizeSpec` (count caps + range clamps) so any authored/shared part stays safe.

`PRIMS` therefore grows by two beyond the solids: `loft` (already used by the hull) and `profile`
(lathe/extrude/sweep). `deform.lattice` is an optional post-pass on any block. All need no-op mocks in
`verify_m2_features.js`.

---

## 2. The renderer — `DD.buildCarFromSpec(spec, ctx)`

`ctx = { ghost, envMap, garage }`. Pure, deterministic, returns a `THREE.Group` honoring the **full
existing contract** (see `CAR_PROJECT.md` §1a):
1. `spec = normalizeSpec(spec)` (§4) — always safe after this.
2. Build slot materials from `palette` + garage `paint(gradient)/finish` (§3).
3. Loft `chassis.hull` → the hull mesh; this material is `body` slot → wire `userData.boostShell`,
   `iridescent` (if finish Iridescent), `baseEmis`, `baseEmisI`, `grad`.
4. Build `chassis.floor` (carbon slot) if present.
5. Build 4 wheel mounts from `hardpoints` (each a `kind:'wheel'` Part → `userData.spinGroup`); push to
   `group.wheels` / `group.frontWheels`.
6. For each remaining mount: resolve Part (catalog or inline) → instantiate its Blocks (apply `mirror`),
   place at the mount transform, apply knob + material overrides.
7. Optional `userData.glowCore` for a pulsing glow Part (generic; `poseCar` already guards it).
8. `ghost` path (translucent/dim/low envMap), `envMap` on reflective slots, `setShadows(group)` (non-ghost).

`DD.buildCar(garage, ghost, envMap)` shrinks to: `buildCarFromSpec(resolveSpec(garage), {ghost,envMap,garage})`
where `resolveSpec` returns the working spec (a custom design if the player has one selected, else the
locked preset for `garage.form`).

---

## 3. Materials — slots, so garage paint still works

A Block's `mat` is a **slot reference**, never a raw colour:
```
MatRef = { slot:'body'|'carbon'|'glass'|'accent'|'glow'|'chrome'|'custom', override?:{...} }
```
- `body`   → garage gradient + finish (the themed shell; the `boostShell`/`iridescent` hook). Players
  recolour the whole car by changing paint, exactly as today.
- `carbon` → the weave PBR (existing `getCarbonTexture`).
- `glass`  → transmissive `cockpitMat` (transmission 0.65 / ior 1.52 — keep, the test asserts it).
- `accent` → `palette.accent` (a solid livery colour).
- `glow`   → **emissive + bloom only.** `palette.glowColor`/`glowI`. NEVER a `THREE` light — enforced in
  normalize. This is the hard lesson from the light-pool + 16-texture-unit memories: decor/car glow must
  be emissive material, or shadows/perf break.
- `chrome` → high-metal low-rough PBR (vintage trim).
- `custom` → explicit bounded PBR `{color,metal,rough,clearcoat,emissive,emissiveI,transmission}`.

Player "adjust colour/material" = edit a slot or a per-block override. Garage paint themes `body`;
`accent`/`glow` give the design its own identity on top.

---

## 4. `normalizeSpec(spec)` — the guardrail

Runs before every build. Makes any edited/saved/shared spec safe:
- Clamp every numeric to its schema range; fill defaults; coerce types.
- Drop unknown `prim`/`part`/`slot` names (forward-compat with `migrate()` on `schemaVersion`).
- **Cap total Block count and mount count** (draw-call budget; the car must stay cheaper than the old
  primitive car — it's the heaviest per-load allocation, ×2 with the ghost).
- Guarantee exactly 4 `kind:'wheel'` mounts, each producing a `userData.spinGroup`.
- Force `glow` slot to emissive (strip any attempt to inject a real light).
- Keep wheel `hardpoints` within the chassis bounds; the shadow derives from them so they can't desync.

Output is **always renderable and contract-valid**, so the editor and share-codes can't brick a car.

---

## 5. Contact shadow — spec-driven (kills the last hardcode)

`buildShadow()` is an SDF `sdBox` plane. **P0 note:** it stays baked at `±0.86/1.5 · ±0.9/-1.35`
for now — harmless because P0 doesn't move wheels (all 4 presets keep anchors near those constants),
and `buildCarFromSpec` already stashes `group.userData.hardpoints` ready for the wiring. Making
`updateShadow()` read those hardpoints (4 wheel boxes) + hull bounds (body box) moves to **P2**,
alongside the editor that actually relocates/resizes wheels. (`verify_m2_features` still asserts the
`sdBox` shader + the 5 box terms exist either way.)

---

## 6. Persistence & sharing (Phase 3)

- `localStorage`: the player's **working spec**, a list of **named custom designs**, and a **player part
  catalog** (authored Parts). All plain CarSpec/Part JSON.
- **Share code** = `base64(deflate(JSON.stringify(spec)))`. Importing runs `migrate()` →
  `normalizeSpec()` so foreign codes are always safe.
- `schemaVersion` + `migrate(spec)` keeps old saves/codes working as the schema evolves.

---

## 7. Determinism, perf, contract — non-negotiables

- **No `Math.random`** anywhere in build/normalize (goldens are load-bearing).
- **Physics never reads the mesh** (`DD.PHYS` is fixed) → custom cars affect *only their own visuals*,
  never race outcome or fairness. The design system is purely render-side.
- **Glow = emissive + bloom, never real lights** (light pool + texture-unit limit).
- **Block/draw-call cap** in normalize; the spec car must be ≤ the old car's mesh count.
- **Contract preserved**: `wheels`/`frontWheels`/`spinGroup`, `userData.{boostShell,iridescent,baseEmis,
  baseEmisI,grad}`, ghost path, envMap, `setShadows`, local frame +Z fwd/+Y up/origin ground-centre.
- `verify_m2_features.js` rewritten to assert the contract against a preset built via
  `buildCarFromSpec` (not the old exact-primitive sniffing); add prim mocks as needed.

---

## 8. The 4 presets (locked seeds)

Each is a `CarSpec` JSON in `DD.CAR_PRESETS`, read-only. Chassis hull = the silhouette Tibba sculpted in
the editor (numbers below); mounts = the philosophy-appropriate catalog parts.

| preset | L | wheels fr/rr/width | hull character | signature mounts | gallery paint |
|---|---|---|---|---|---|
| Apex Formula | 0.94 | .34/.40/.47 | narrow at both axles, wide cockpit bulge | multiSpokeWheel, multiWing(front), biplaneWing, halo, splitter, diffuser | Deep · Gloss |
| Endurance Prototype | 0.93 | .34/.42/.34 | full teardrop, raked-up tail, fenders cover wheels | turbofanWheel, splitter, lowSpoiler, sharkFin, diffuser | Noir · Gloss |
| Neon Speeder | 0.98 | .40/.50/.42 | chunky, dramatic cockpit bulge (.89), flared tail | glowDiscWheel, splitterGlow, hoverFins, hoverChannels, glowCore | Dream · Neon Edge |
| Classic Cigar | 1.02 | .40/.44/.20 | slim near-constant tube, gentle swell, Kammback | classicSpokeWheel, ducktail, exposedEngine, exhausts, chrome | Gold · Gloss |

Sculpted hull station tables `[z_pct, halfWidth, height, yOffset]` (× WIDTH/HEIGHT in the loft):
- **Apex**: `[1,.07,.05,.09][.75,.19,.21,.19][.5,.32,.29,.27][.25,.49,.35,.23][0,.70,.38,.27][-.25,.74,.37,.26][-.5,.43,.42,.25][-.75,.39,.25,.25][-1,.37,.15,.33]` · fenderClamp .76
- **Endurance**: `[1,.24,.08,.06][.75,.54,.40,.22][.5,.84,.44,.28][.25,.70,.43,.28][0,.72,.48,.28][-.25,.72,.52,.30][-.5,.85,.52,.30][-.75,.81,.54,.35][-1,.60,.13,.52]` · fenderClamp .95
- **Neon**: `[1,.16,.08,.08][.75,.34,.16,.12][.5,.46,.37,.18][.25,.52,.46,.24][0,.89,.50,.26][-.25,.88,.52,.27][-.5,.74,.47,.24][-.75,.44,.20,.20][-1,.50,.31,.32]` · fenderClamp .95
- **Classic**: `[1,.10,.10,.10][.75,.22,.18,.14][.5,.30,.22,.16][.25,.34,.26,.18][0,.36,.30,.20][-.25,.34,.26,.18][-.5,.32,.22,.16][-.75,.26,.18,.14][-1,.18,.12,.12]` · fenderClamp .70

---

## 9. Build phases

- **P0 — foundation (no visible change): ✅ DONE.** `js/carspec.js` (THREE-free: schema ranges,
  `normalizeSpec`, 4 locked `DD.CAR_PRESETS`, `resolveSpec`) + scene.js renderer (`buildHull`,
  `buildCanopy`, `buildWheels`, `DD.CAR_WHEEL_BUILDERS`, `DD.CAR_PARTS`, `DD.buildCarFromSpec`);
  `buildCar` → wrapper. Shadow left baked (see §5). All node tests green; carspec.js wired into
  index.html + apk-build/www. (`profile`/`lattice` prims deferred to P2 — not needed by presets.)
- **P1 — validate: ✅ DONE.** `gallery.html` (root-only dev tool, not shipped) — a dedicated display
  stage (dusk sky/stars/lights + flat platform), deliberately **not** wired to the random track
  generator (no trackgen.js/physics.js dependency; avoids the road width/curvature fight that a
  generated track's road introduces for a fixed-layout comparison shot). Renders all 4 presets in a
  row with screen-projected name labels + camera helpers (`frameRow`/`frameCar`/`bumpWheelSpin`/
  `orbitSun`) for the `CAR_REBUILD_PLAN.md` §4 rubric. Findings: canopy ratio passes all 4; fender/
  tyre clipping clear for Apex/Neon/Classic; Endurance's hull-over-wheel overlap confirmed intentional
  ("fenders cover wheels"); specular sweep clean. Open (not yet acted on): Classic Cigar reads very
  needle-thin; `glowDisc` (Neon Speeder) has no asymmetric marking so it can never show a visible spin
  cue — `multiSpoke`/`turbofan` already do. See STATUS.md session 14 for the full pass.
- **P2 — designer (live 3D, direct manipulation):** the editor IS the garage showcase turntable wired to
  the spec — ONE orbitable real car, no separate 2D "views." The player switches **edit mode**, not
  screen, and the camera assists:
  - **Orbit** — spin/zoom; raycast-pick a ring or control point.
  - **Length (rings): ✅ slice A done + fixed up (sessions 15-16).** `DD.buildEditHandles` (one handle
    sphere per station) + raycast pick + drag → mutates `station[].{w,h}` live, `DD.CAR_SCHEMA`-clamped,
    layers correctly under garage paint/finish. A "customize" button forks the locked preset into a
    session-only `G.workingSpec`; "reset to preset" clears it. Live-drag is cheap (`DD.updateHullGeometry`
    swaps just the hull's geometry — nothing else depends on `station[]`) and the ambient camera spin
    freezes while customizing so dragging isn't a moving target (session 16). The garage itself now sits
    on a dedicated `DD.buildGarageStage()` platform, not the raceway (session 16). **Not yet done:**
    fore-aft (`z`)/raise-lower (`y`) — same pattern, quick follow-up. See STATUS.md sessions 15-16.
  - **Cross-section** — on grabbing a ring, camera tweens **end-on** (down the spine) so the ring reads as
    a flat outline; the §1.5 profile editor now operates as the 3D viewport at that angle (drag/split/
    curve points, mirror). Exit → it's a 3D bulge on the car.
  - **Add / remove** — insert a ring loop, split an edge, delete a point/ring.
  Handles are drawn ON the mesh (ring loops + grabbable dots); `mirror` is a global X-symmetry plane.
  Implementation: raycast picking, screen-projected handle drag (project control point → drag in screen
  space → unproject onto the ring/cross-section plane), camera tween for the end-on snap, live
  `buildCarFromSpec` rebuild on every edit. The editor only ever writes `CarSpec` arrays, so it's a pure
  controller over the data — P0 is unaffected. Also exposes per-slot colour/material, wheel/spoke/width,
  and glow features. Forks a locked preset into an editable working spec.
- **P3 — persistence:** save/name custom designs + player part catalog + share codes (localStorage,
  base64, `migrate()`).

## 10. File touchpoints
- New: `js/carspec.js` (PRIMS, catalog, normalize, builder, presets). Load before `scene.js` in
  `index.html` (bump `?v=`, copy to `apk-build/www/`).
- `js/scene.js`: `DD.buildCar` → wrapper; `DD.buildShadow`/`updateShadow` read hardpoints; `poseCar`
  unchanged (already generic).
- `js/theme.js`: `DD.GARAGE.forms` → preset selector labels.
- `js/game.js`: garage menu (P2 editor), `updateShowcaseCar`, save schema (P3).
- `tests/verify_m2_features.js`: rewrite car asserts + add prim mocks.
