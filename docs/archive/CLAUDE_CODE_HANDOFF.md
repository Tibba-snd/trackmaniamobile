# DRIFTDREAM — Handoff to Claude Code (garage feature + repo streamline)

_Paste the "PROMPT" block below into Claude Code opened at the repo root. Everything above it is
context you (Claude Code) should verify against the live files — do not trust it blindly, the sim
docs drift._

---

## PROMPT (paste this)

```
You are the orchestrator on DRIFTDREAM — a deterministic, procedurally-generated Three.js mobile
racer (plain <script> files, no bundler; core/theme/trackgen/physics are THREE-free + Node-tested).
You are on branch `c4-work`. There is a mature file-based multi-agent system here — READ THESE FIRST,
in order, before touching anything:

1. README.md            — run/build/test/controls + repo layout
2. STATUS.md            — current state, known issues, session log (read the top)
3. ARCHITECTURE.md      — how each system works (file:line pointers)
4. CAR_DESIGN_SYSTEM.md — the cars-as-data model (schema, presets, P2 live editor, P3 persistence)
5. .agents/AGENTS.md    — the HARD RULES (determinism, THREE-free split, light pool, WebView)
6. BRIEFS.md + COORDINATOR_PLAYBOOK.md — the task-queue + how drops/reviews work with "Antigravity"

### What already landed this session (uncommitted on c4-work — review the diff, then commit)
The Claude-owned, headless-verifiable GARAGE FOUNDATION is done and tested (60/60 assertions in
`tests/verify_carspec.js`). Changes:
- `js/carspec.js`:
  - schema ranges added: `rimRadiusPct [0.40,0.90] def 0.82`, `tyreRoundness [0,1] def 0`; `CAP_STYLES`
    enum `flat|pointed|rounded|hollow`.
  - `normalizeSpec` now clamps `hardpoints.rimRadiusPct`, `hardpoints.tyreRoundness`,
    `hardpoints.spokeCount` (int 3–8 or null=style-native), `hull.capStyleFront/capStyleRear`,
    sanitizes freeform part `knobs` (drops non-finite → no NaN reaches geometry), and passes through a
    string `id` (null for presets). All new defaults reproduce the PRE-CHANGE look (backward-compatible).
  - `DD.createCustomDesign(source, seq, name)` — forks a preset index or a spec into a normalized
    custom design with a stable id `cd<seq>` (deterministic; NO Math.random/Date.now).
  - `DD.resolveSpec(garage, customDesigns?)` — returns the active custom design when
    `garage.activeCustom` matches one in `customDesigns`, else the locked preset for `garage.form`.
    `customDesigns` is OPTIONAL → every existing `resolveSpec(garage)` call still works unchanged.
- `js/core.js`: default save gains `garage.activeCustom:null`, `customDesigns:[]`, `meta.customSeq:0`;
  `loadSave` additively backfills these on old saves and re-normalizes every stored design on load.
  NO SAVE_VER bump (campaign progress preserved — the new fields are purely additive).
- `index.html`: cache-busters bumped `carspec v2→v3`, `core v18→v19`.
- `tests/verify_carspec.js`: new headless test (schema clamps, idempotence, createCustomDesign,
  resolveSpec both paths, loadSave migration).
- DELIBERATELY NOT TOUCHED: `js/scene-car.js`, `js/game.js` — rendering + UI need a browser to verify,
  so they are the delegated briefs below.

### Your job (in order)
**1. Verify the foundation.** Run the full node suite AND the new test, confirm green:
   `node tests/drivability.js && node tests/verify_determinism.js && node tests/verify_colors.js &&
    node tests/verify_m2_features.js && node tests/verify_camera.js && node tests/verify_sky_stars.js &&
    node tests/verify_carspec.js`
   Then LAUNCH the game (`node dd.js serve`, open `/?seed=DREAM-7F3K2`) and confirm it boots to a race
   and the garage still works — a green suite does not prove boot. Then commit the foundation on
   `c4-work` (message: `Garage P3 foundation: custom-design schema + persistence (headless-verified)`).

**2. Streamline the docs (Tibba's #1 ask: "one doc mainly, others only if needed").** Do this as its
   own commit. There are ~13 root .md files with real overlap and factual DRIFT:
   - README.md + ARCHITECTURE.md still describe `scene.js` as ONE file — it was split into
     `scene-core/scene-car/scene-decor/scene-fx`. `carspec.js`'s header comment also says "scene.js".
     Fix all such drift; refresh stale "verified against code" dates.
   - Make **README.md the single front door** (what it is, run/build/test, controls, corrected file map,
     architecture-in-brief with code-as-source-of-truth pointers, the collaboration model in a
     paragraph, and "where to go next").
   - KEEP the live collaboration loop working and un-renamed: `ANTIGRAVITY.md`, `BRIEFS.md`, `INBOX.md`,
     `STATUS.md`, `.agents/AGENTS.md` (other agents' boot prompts reference these exact paths).
   - CONSOLIDATE the rest: merge `CAR_PROJECT.md` + `CAR_DESIGN_SYSTEM.md` + `CAR_REBUILD_PLAN.md` into a
     single `CAR.md` (garage/car design reference); fold `COORDINATOR_PLAYBOOK.md` into `AGENTS.md` (or a
     short `COLLABORATION.md`); move `HANDOFF_C4.md`, `HANDOFF_FABLE.md`, and this file into
     `docs/archive/`; fold the live parts of `IMPROVEMENT_PLAN.md` into STATUS/BRIEFS and archive the rest.
   - Trim STATUS.md: keep current-state + backlog + the latest 2 sessions at the top; move the long
     resolved-session history to `docs/archive/STATUS_HISTORY.md`. Fix EVERY cross-reference you move.

**3. Queue the full-vision garage as single-scope, parallel-safe briefs (G-series) in BRIEFS.md**,
   matching the existing T1–T8 pattern (verified-root-cause + scope[files] + DoD each). The improved
   decomposition (pushback on the original monolithic spec — see "Plan notes" below):
   - **G0 (Claude, DONE ✅)** — schema + persistence foundation (this session).
   - **G1 (browser)** — Hull caps: implement `capStyleFront/Rear` in `buildHull`'s `cap(m,rev)` —
     `flat`=current centroid-fan; `pointed`=push cap centre ±0.3L along Z (nose/tail cone);
     `rounded`=hemisphere Z-offset on cap verts; `hollow`=skip the cap tris (open intake/exhaust bay).
     `scene-car.js` ONLY.
   - **G2 (browser)** — Parametric wheels in `buildWheels`: use `hp.rimRadiusPct` (replace hardcoded
     `r*0.82`); `hp.tyreRoundness` → beveled `CylinderGeometry`/`TorusGeometry` tread; `hp.spokeCount`
     drives `multiSpoke`/`classicSpoke` counts. `scene-car.js` ONLY.
   - **G3 (browser)** — Wing/part knobs: `frontWing`/`rearWingBiplane`/`rearSpoilerLow`/`hoverFins`
     read `knobs {angle, scale, width}` (exactly like `lightBar` already reads its knobs). `scene-car.js` ONLY.
   - **G4 (browser)** — Garage sidebar tabs + sliders: Paint · Finish · Chassis(Presets/Custom) · Body
     Stations · Wings & Parts · Wheels; finger-friendly `<input type=range>` for wheel size, tyre width,
     rim size, tyre roundness, canopy offset(y/z), wing angles, glow intensity. NO CSS transitions on
     `::before/::after` (WebView freezes them). `index.html` + `game.js` + CSS.
   - **G5 (browser)** — Custom Designs UI: list existing, "+" create-from-preset (`DD.createCustomDesign`
     + `save.meta.customSeq++`), select (set `garage.activeCustom`), rename, delete, persist; and WIRE
     `resolveSpec`/`buildCar` to pass `G.save.customDesigns` at the 4 call sites (`game.js:139,258,427,1380`).
     `game.js` + `index.html`.
   - **G6 (browser)** — Direct manipulation: extend the session-15/16 ring-drag (`buildEditHandles` →
     `updateHullGeometry`) to fore-aft(z)/raise-lower(y); add cross-section mode (needs a Claude camera-
     tween spec first — that's brief O5); add pinch-zoom + one-finger orbit on the turntable. `scene-car.js`
     + `game.js`.
   - **G7 (optional)** — Share codes: `base64(deflate(JSON.stringify(spec)))`, import runs `migrate()`→
     `normalizeSpec()`. P3 sharing.

**4. Execute the G-briefs** (either yourself with browser verification, or hand the browser-verifiable
   ones to Antigravity via the playbook). After each: bump `?v=` cache-busters for every changed js file,
   `node dd.js sync` for `apk-build/www`, launch + screenshot, commit on `c4-work`, append to STATUS.md.

### HARD INVARIANTS (from .agents/AGENTS.md — do not cross without a design note)
- THREE-free split: `core/theme/trackgen/physics/carspec` stay Node-runnable (no THREE import).
- Determinism: no `Math.random`/time in track/car spec generation or normalize (custom designs are
  player data, not seed data — they only affect their own visuals; physics never reads the mesh).
- Glow = emissive + bloom ONLY, never a real light; ≤12 PointLight pool (8 on medium) via `addLightSource`.
- No CSS transitions on pseudo-elements; touch-friendly controls.
- Bump `?v=` cache-busters for every changed js file; `git status` before every commit; launch to verify.

### Plan notes (the pushback that shaped the G-series — keep in mind)
- DON'T reinvent: the `CAR_DESIGN_SYSTEM.md` already specs this vision (three-layer Block/Part/Car,
  normalizeSpec guardrail, P2 editor, P3 persistence). EXTEND it. Several requested "new" sliders already
  exist as parameters and just need UI: `chassis.floor {w,h,z}`, `canopy {scale,z,y}`, and the light bar's
  `knobs {len (length), x (flank offset), i (intensity)}` + `palette.glowI`. Those are G4 UI tasks, not schema.
- The original prompt bundled 4 subsystems into one change; the field rule here is "one brief per drop."
  That's why it's decomposed. Claude owns schema/persistence/physics; browser work owns rendering/UI.
```

---

## Why hand off (for Tibba)
This sandbox can't launch the game (no browser) and its file mount was serving stale copies of edited
files, which is friction Claude Code doesn't have. Claude Code reads the repo directly, runs the full
Node suite cleanly, can screenshot the running game for the visual briefs (G1–G6 are all visual), and
has git/GitHub to review, commit, and push. The headless foundation (schema + persistence) is already
done and verified here, so Claude Code starts from a green, committed base.
