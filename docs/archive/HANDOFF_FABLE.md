# Handoff → Fable — DRIFTDREAM car design system

_From: Opus. Date: 2026-07-01. You're picking up mid-project; this is a clean checkpoint (Phase 0
landed, tests green). Read this top-to-bottom, then the three ground-truth docs below._

## 0. What this project is

DRIFTDREAM is a stylized neon-dusk drift racer: **plain Three.js r128, global `window.THREE`, NO
bundler / no build step, deterministic, mobile target.** `core`/`theme`/`trackgen`/`physics`/`carspec`
are THREE-free and Node-testable; `scene`/`game` need THREE.

**Read first (ground truth, in order):**
1. `CAR_DESIGN_SYSTEM.md` — the architecture we're building (cars-as-data). **Most important.**
2. `CAR_PROJECT.md` — engine/contract/physics/wheel knowledge + hard-won lessons.
3. `CAR_REBUILD_PLAN.md` — the lofting math + the objective aesthetic acceptance rubric.
4. `.claude/skills/driftdream-car/SKILL.md` — operational checklist.

## 1. The mission (what Tibba actually asked for)

Not "4 hardcoded cars." A **cars-as-data design system**: one pure renderer turns any valid `CarSpec`
into the mesh. The 4 "philosophy" variants (Apex Formula / Endurance Prototype / Neon Speeder /
Classic Cigar) are **locked, read-only preset specs** — *seed data*, not code branches. In the garage,
players will eventually **tweak presets, swap/add/remove parts, author brand-new parts, recolour per
part, resize wheels/spokes, add glow features, and save + share** designs.

Decisions Tibba locked (don't relitigate):
- **Max authoring power** (tweak → swap → add/remove → make new parts → colour/material → wheel size/
  width/spokes → glow → save/share). Presets stay **locked starting points** ("Customize" forks a copy).
- **The editor is a LIVE 3D tool in the garage**, not 2D panels. One orbitable real car; you switch
  *edit mode* (Orbit / Length-rings / Cross-section / Add-remove), not screen. Camera tweens **end-on**
  for cross-section editing so the 2D outline tool == the 3D viewport at that angle. See §9 P2 in
  `CAR_DESIGN_SYSTEM.md` — the design is fully specced there.
- **"New parts" = composing primitives** (box/cyl/sphere/torus/loft/profile/slab + a lattice warp),
  NOT free-form vertex sculpting. Editing is parametric control-point editing (drag/split/curve/mirror).
- **Glow = emissive + bloom, NEVER a real THREE light** (protects the light pool + 16-texture-unit
  limit — see the project memories). `normalizeSpec` is the guardrail.

## 2. Phase 0 — DONE (this is what I just shipped)

The car is now fully data-driven. **No visible in-game change** (presets reproduce the prior look), but
the plumbing is the foundation for everything else.

**New file `js/carspec.js` (THREE-free data layer):**
- `DD.CAR_SCHEMA` — field ranges/defaults used by normalize (and later the editor controls).
- `DD.normalizeSpec(spec)` — clamps ranges, fills defaults, drops unknown parts, caps counts. Any
  edited/saved/shared spec is safe after this. Pure (clones input).
- `DD.CAR_PRESETS` — the 4 locked specs. Hull `station[]` tables = the silhouettes Tibba sculpted in
  the widget editor (Apex/Endurance/Neon are his reshaped versions; Classic is the proposed default).
- `DD.resolveSpec(garage)` — returns the normalized preset for `garage.form`; honors live garage
  paint/finish. (P3 will return a player's custom working spec instead.)
- `DD.CAR_PART_NAMES`, `DD.CAR_WHEEL_STYLES` — the known catalog keys.

**Rewrote `DD.buildCar` in `js/scene.js`** (replaced the old 467-line `if (form===…)` block) into:
- `makeCarMaterials(garage, ghost, envMap, palette)` — the material *slots* (`body`/`carbon`/`glass`/
  `glow`/`chrome`), composed over garage paint+finish.
- `buildHull(hull, hp, L, mat)` — lofts the hull from `station`/`section`/`fenderClamp`.
- `buildCanopy`, `buildWheels`.
- `DD.CAR_WHEEL_BUILDERS = { multiSpoke, turbofan, glowDisc, classicSpoke }` — wheel-style registry.
- `DD.CAR_PARTS = { frontWing, rearWingBiplane, rearSpoilerLow, hoverFins, splitter, splitterGlow,
  halo, sharkFin, diffuser, exhausts, exposedEngine, hoverChannels, glowCore, ducktail, chromeTrim }`
  — part catalog; each self-positions from `ctx.hp/ctx.L` and adds to `ctx.group`.
- `DD.buildCarFromSpec(spec, {ghost, envMap, garage})` — the pure renderer; honors the full contract.
- `DD.buildCar(garage, ghost, envMap)` → thin wrapper = `buildCarFromSpec(resolveSpec(garage), …)`.

**Contract preserved exactly** (other systems poke these — never break them): `group.wheels` (4) /
`group.frontWheels` (2) each with `userData.spinGroup`; `userData.{boostShell, iridescent, baseEmis,
baseEmisI, grad, L, thrusterGlow?, hardpoints}`; ghost path; envMap on reflective slots; `setShadows`;
local frame +Z fwd / +Y up / origin ground-centre. `poseCar` + `buildShadow` unchanged.

**Wiring done:** `carspec.js` added to `index.html` before `scene.js` (scene bumped `?v=45→46`,
carspec `?v=1`); all three copied into `apk-build/www/`. `tests/verify_m2_features.js` now
`require('../js/carspec.js')`.

**Verified (all green):**
```
node --check js/carspec.js        # OK
node --check js/scene.js          # OK
node tests/verify_m2_features.js  # 18/18 PASS (full car contract)
node tests/drivability.js         # OK
node tests/verify_determinism.js  # OK
node tests/verify_colors.js       # OK
```

## 3. What's next (recommended order)

**→ Start here: Phase 1 — the gallery harness (tasks #2 + #4).** Build a standalone page (e.g.
`gallery.html`, mirror `index.html`'s script tags) that loads the libs + carspec + scene and renders
all 4 presets in a row on a turntable under dusk/neon lighting, from front-3/4, side, top-down. Use it
to screenshot + iterate the 4 presets against the **acceptance rubric in `CAR_REBUILD_PLAN.md` §4**
(silhouette-readable-at-120px, coke-bottle ratio [Apex/Neon only], canopy ratio, single hull, wheel
strobe check, specular sweep). Tibba wants to *judge the 4 together*; his sculpted Apex/Endurance/Neon
hulls have wide cockpit bulges I flagged — verify they don't pierce the tyres at the axle stations and
tune each preset's `fenderClamp` if they do. **Final taste sign-off is Tibba's.**

Then **P2 — the live 3D editor** (task #5, fully specced in `CAR_DESIGN_SYSTEM.md` §9), then **P3 —
save/share** (task #6). Task list (`TaskList`) is current: #1, #3 completed; #2, #4, #5, #6 pending.

## 4. Gotchas / rules (don't relearn these the hard way)

- **THREE-free split is deliberate:** data (`carspec.js`) has NO THREE; render (`scene.js`) has the
  geometry/part builders. Keep it that way so specs stay serializable + Node-testable.
- **Test mock:** `tests/verify_m2_features.js` runs under a hand-rolled THREE mock (top of file). Any
  NEW `THREE.*` geometry constructor you call in the car path (e.g. if you implement the `profile`/
  `lattice` prims for P2) must be added there as a no-op or `require('../js/scene.js')` throws.
- **Determinism is load-bearing:** no `Math.random` anywhere in build/normalize (goldens). Physics
  never reads the mesh, so custom cars can't affect race outcome — the design system is render-only.
- **Glow = emissive + bloom, never real lights.** `normalizeSpec` should keep enforcing this.
- **Shadow is still baked** at `±0.86/1.5 · ±0.9/-1.35` (P0 kept it; presets keep anchors near there).
  Make `updateShadow` read `group.userData.hardpoints` in P2 when wheels can actually move.
- **After editing scene.js/game.js:** bump the `?v=` in `index.html` AND copy the changed files into
  `apk-build/www/` (easy to forget; `game.js` reads `carMesh.userData.*`).
- **Preview/screenshot harness limits** (memories `driftdream-preview-harness-limits`,
  `css-pseudo-transition-freeze`): the WebGL buffer can collapse to 1×1 — size the renderer to the real
  viewport first; `rAF` pauses when hidden — drive/pose statically; **never use CSS `mask`** on captured
  content (hangs `preview_screenshot`). The garage showcase is a ready-made turntable.
- **Repo is edited by multiple AI tools and is NOT a git repo** (memory `driftdream-shared-edits`) —
  if something breaks unexplained, check file mtimes.

## 5. Interaction notes with Tibba
He's hands-on and visual — he sculpted all 4 hull silhouettes by dragging an interactive editor widget
(the `station[]` numbers in the presets came from that). He likes seeing/feeling things, not just prose.
He invited "additional ideas / improvements" — surface them as you go. He chose to build Phase 0 first
(foundation) over a throwaway 3D prototype.
