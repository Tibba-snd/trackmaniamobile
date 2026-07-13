# DRIFTDREAM — Antigravity Briefs (BRIEFS.md)

_Living doc of every active Antigravity brief. Claude (orchestrator) specs + reviews; Antigravity
executes one brief per drop, uncommitted, in the main checkout. Read this top-to-bottom before
every drop. Status legend: 🔴 open · 🟡 in-progress · 🟢 landed · ⚪ deferred._

> **→ Antigravity: read [`ANTIGRAVITY.md`](ANTIGRAVITY.md) first, every drop.** It's your standing
> instructions + file map + rules, and its **KNOWLEDGE BASE** section grows after each review with
> distilled tips. Newest entries at the top — scan them before you start editing. This file is just
> your task queue; `ANTIGRAVITY.md` is your home.

**Branch layout (2026-07-04):**
- `baseline-v1` — **frozen playable version**, current game BEFORE the C4 balance pass. Never commit here. `git checkout baseline-v1` to see/play the pre-C4 game.
- `c4-work` — **active branch**, all C4 + campaign work. You are here.
- `master` — untouched trunk (still at the initial commit).

---

## PROTOCOL (re-read every drop)

1. **One brief per drop.** Don't mix. Leave changes uncommitted in the working tree on `c4-work`.
2. **Check [`INBOX.md`](INBOX.md)** at the start of every drop — for replies to your threads and for
   any message addressed to you. Post there (don't sit on doubts): 🚫 BLOCKER to stop+ask,
   ❓ QUESTION to keep going, 🟠 FLAG for out-of-scope issues you notice but aren't fixing. See
   `ANTIGRAVITY.md` §7 for the full taxonomy.
3. **Definition of Done for every brief:**
   - All listed tests green (`node tests/...`).
   - `?v=` cache busters bumped in `index.html` for **every** changed `js/` file.
   - **Launch the game** (`node dd.js serve`, open `/?...` not `/index.html?...`, start a race, reach `play`, watch the console) after ANY structural change. A green suite does not prove the game boots.
   - A walkthrough listing **every gameplay-affecting line** (the slope-gravity incident, session 18 — an undocumented physics change is a defect even if tests pass).
4. **Post unresolved notes to [`INBOX.md`](INBOX.md)** before stopping — 🚫 BLOCKER, ❓ QUESTION (with the assumption you proceeded on), or 🟠 FLAG for anything out-of-scope you noticed. Don't leave a silent doubt; the next session won't have your context.
5. **Claude reviews the `git diff`** (not the walkthrough), fixes/integrates, commits, updates STATUS.md. Nothing merges unreviewed.

## FIELD NOTES (hard-won from review cycles — READ BEFORE EVERY DROP)

1. **Run the FULL suite after your FINAL edit**, not mid-way: `node tests/drivability.js`,
   `verify_determinism`, `verify_colors`, `verify_m2_features`, `verify_camera`,
   `verify_sky_stars`. Sessions 19 & 21 both shipped "all tests pass" claims with crashing tests.
2. **A green suite does not prove the game BOOTS. Launch it** after ANY structural change.
   Session 21 shipped two loader-killing ReferenceErrors inside a "done" drop.
3. **Bump `?v=` cache busters** in `index.html` for every changed js file. Without them Tibba's
   browser runs OLD code against NEW html. **`git status` immediately before every commit** (mirror
   of this rule caught the unreviewed-sweep incident in session 23).
4. **Moving code between the scene files? Move its file-local closure consts too** (or route them
   through `DD._sceneShared`). Grep each identifier you touched: defined-in-file vs used-in-file
   must match.
5. **Walkthrough lists every gameplay-affecting line.** If you changed a number in `DD.PHYS` or
   removed a term, say so, even if "it seemed unused".
6. **Tracks can be CLOSED CIRCUITS now** (`track.closed`, `track.laps`). Any new code that scans
   `track.samples` forward/backward MUST wrap modulo N when `track.closed` (never bare
   `Math.min(N-1, i+k)`); progress/ghost indexing is `lap*N + idx`; `car.awaitSeam` gates the seam
   handoff — don't fight it.
7. **New randomness in trackgen = a NEW derived rng stream** (`DD.makeRng(seed + '::yourFeature')`),
   never an extra draw from the main sequence — existing seeds must keep generating identical tracks.
8. **Testing URL params:** `npx serve` / `node dd.js serve` strip the query string when redirecting
   `/index.html?x=y` — use `/?x=y`.
9. **`DD.game` is the live game state** — use it to verify at runtime (teleport the car, inspect
   meshes, force `DD.testMode`/`DD.autodrive` for bot-driven visual checks). Boot-time `?testMode=true`
   forces quality LOW — set flags at runtime when you need full visuals.

## HARD INVARIANTS (nobody crosses without a Claude-reviewed design note)

- **Determinism** — no `Math.random` in sim paths. New trackgen randomness = a new derived rng stream.
- **`buildCar` contract** — `verify_m2_features` guards it (`wheels`/`frontWheels`/`spinGroup`, `userData.*`).
- **`normalizeSpec` guarantees** — glow = emissive only, never real lights.
- **Light pool rule** — `addLightSource`, never raw lights (12-point pool on high, 8 on medium).
- **`DD.GLOW` discipline** — no new magic glow constants; centralize in `DD.GLOW`.
- **`DD.PHYS` changes are Claude-reviewed by design** — physics is not Antigravity's to retune.
- **Closed-circuit wrap** — any forward/backward sample scan wraps modulo N when `track.closed`.

---

# C4 BRIEFS (balance/audio/campaign) — all 🟢 LANDED session 24, kept for reference

## A11 — Impact audio fix  🟢 LANDED (session 24)

**Verified root cause (Claude, 2026-07-04):** the audio path is *healthy* — `initAudio`
(`audio.js:17`) sets master gain 1, `volumes.sfx` defaults to **0.8** (`audio.js:10`), unlocked on
first gesture (`game.js:1270-1272`), `noiseSfx` (`audio.js:187`) is correct. The sounds DO fire.
They're just **gated too strictly and psychoacoustically masked**:
- Wall thud (`game.js:723`): `speed > 10` (36 km/h) is a high bar; one-shot edge-detection means a
  scrape fires once; the 150 Hz lowpass sits under engine sub-bass → masked.
- Landing whump (`game.js:735`): `prevVelY < -2` (7 km/h down) + masking → near-silent except hard
  landings.
- `hitWall` resets every `stepCar` (`physics.js:161`); with up to 4 substeps/frame a brief glance
  can read false at render time.

**Scope (touch ONLY `js/audio.js` + the two wiring lines in `js/game.js`):**
1. Lower the wall-thud trigger `speed > 10` → `> 5` (`game.js:723`).
2. Add a **scrape-loop** variant in `audio.js`: a sustained filtered-noise bed while `hitWall &&
   speed > 5`, gain scaled by speed, cut on release — so a wall scrape isn't a single thud but an
   audible grinding. Wire it alongside the one-shot thud (thud on the rising edge, loop while held).
3. Raise the whump trigger `prevVelY < -2` → `< -1` (`game.js:735`); brighten the filter (90 Hz →
   ~140 Hz) and add a ~70 Hz body tap so it cuts through the engine.
4. Add a **debug overlay**: `DD.debugAudio` — `console.log`s every fire with speed/vol, gated on
   `?debugAudio=true` OR `DD.debugAudio` set at runtime. This lets you (Antigravity, vision) *hear
   + see* it fire in the preview and confirm via a console-log screenshot.

**DoD:** field notes 1–3 + a console-log screenshot showing BOTH sounds firing (wall hit at <10 m/s,
and a jump landing) + your aural confirmation. **No changes outside `audio.js` + the game.js wiring.**

---

## A12 — Campaign flow fixes + track caching  🟢 LANDED (session 24)
**Depends on: nothing (do first of the campaign trio).**

**Verified root cause (Claude, 2026-07-04):**
- No track caching exists → `buildValidTrack` runs on every menu open AND every selection
  (`game.js:228,1071`), blocking the main thread for seconds each time (the documented load-time
  hotspot). `buildValidTrack` may also ship a different attempt than a bare `generateTrack`.
- `buildCampaignMenu` resets selection to track 1 on every open (`game.js:1128`) — finishing a track
  and returning loses your place.
- Finish screen has no "replay this track" button — only retry (fast-countdown same-run), next, menu
  (`index.html:948-951`). So a finished campaign track can only be re-entered by navigating the menu
  again, and even then selection jumps back to track 1.
- `MEDAL_ICON` gold/silver/bronze are all the same glyph `●` (`game.js:41`) — no visual distinction.

**Scope:**
1. `DD.trackCache` object (keyed `seed|t`), populated by `startTrack` AND `selectCampaignTrack`;
   `buildValidTrack` only called on cache miss. Clear cache on screen-dispose / tier-change as
   needed. Solves the main-thread block.
2. Persist `selectedCampTrack` across `buildCampaignMenu` rebuilds — don't reset to track 1; restore
   the last-selected (or first-without-author-medal as a "next goal" default).
3. Add **"replay"** button to the finish screen (`#finReplay`): full-countdown clean restart of the
   same campaign track (distinct from `#finRetry`'s fast-countdown same-run restart). Wire in
   `game.js` next to `finRetry`/`finNext`.
4. Fix `MEDAL_ICON` to **distinct** glyphs/colors per medal (author ◆ gold 🥇/● silver ● bronze ● —
   pick a combination that reads; gold/silver/bronze must be visually distinguishable).

**DoD:** field notes 1–3 + a live walkthrough screenshot-log showing: open campaign (no hitch) →
select track 5 → DRIVE → finish → REPLAY → same track reloads (not track 1).

---

## A13 — Campaign UI rebuild + gamification  🟢 LANDED (session 24)
**Depends on: A12 landed (uses the track cache + persisted selection).**

**Scope:**
1. Rebuild the campaign screen layout (`index.html:767-800`, CSS `120-240` + `539-551`): left = tier
   list with per-track medal badges + PB, right = preview (minimap, medal targets, PB, DRIVE button).
   Mobile-aware breakpoints — fix the fragile flex at `index.html:232-234` (`flex-direction: column`
   on narrow). The current `.tierRow` 5-wide grid is cramped on phones; consider 5-wide only on
   wide viewports, 3-4-wide on mobile.
2. **Gamification elements:**
   - Total medal count header (e.g. "17 / 50 MEDALS").
   - Per-tier completion bar (e.g. "TIER 2 — 7/10").
   - "Next unlock" hint on locked tiers (e.g. "2 more medals in tier 2 to unlock").
   - Best-medal badge on every track button — distinct color per medal (the A12 icon fix), with
     a subtle glow for author medals.

**DoD:** field notes 1–3 + screenshots at **desktop AND mobile landscape** showing all 5 tiers
(locked tiers must clearly show the lock state + hint). `node dd.js serve` → `/?seed=...`.

---

## A14 — Campaign polish + progression feel  🟢 LANDED (session 24, folded into A13)
**Depends on: A13 landed.**

## A15 — Road-decal height ladder (z-fight elimination)  🟢 LANDED (drop reviewed clean + committed by Claude, session 27 — `DD.DECAL` in core.js, polygonOffset on NormalBlending decals, ?v= bumped)

_Tibba: "track elements visually clip into each other — two planes on the exact same level and the
graphics can't decide which to show."_ Claude already landed the two structural halves (camera near
0.1→0.35 in `game.js`, circuit seam stitch in `scene-decor.js`, session 26). What remains is
mechanical: every flat overlay on the road sits at an ad-hoc height and several share levels.

**Verified current offsets (all along `s.u` above the ribbon):** kerbs 0.035
(`scene-decor.js:614`), centre dashes 0.05 + rail2 0.05/0.06 + edge strips 0.06 (`scene-core.js:
340-370`), glass shine 0.07 (`scene-core.js:378`), a decor plate at 0.09 (`scene-decor.js:813`).
Boost pads / landing pads / start plates: audit `buildBoostPads`, `buildLandingPads`, `buildGates`
for their own constants.

**The change:**
1. Add `DD.DECAL = { kerb: 0.03, glass: 0.05, centre: 0.07, edge: 0.09, rail2: 0.10, boost: 0.11,
   landing: 0.13 }` in `js/core.js` (single source of truth, same spirit as `DD.GLOW`).
2. Replace every literal offset above with its `DD.DECAL.*` entry — one unique height per overlay
   type, nothing shares a level with anything it overlaps.
3. Every NormalBlending road decal material gets `polygonOffset: true, polygonOffsetFactor: -1,
   polygonOffsetUnits: -1`. (Additive `depthWrite:false` strips don't z-fight but DO pop when
   coplanar — they just get their ladder height, no polygonOffset needed.)
4. Do NOT touch the ribbon itself, the road body, guardrail walls (they're vertical), or anything
   in `physics.js` — heights here are visual only.

**DoD:** all suites green (this is render-only — `drivability`/`verify_slide` must be untouched);
game launched, one race per biome eyeballed at distance for flicker (dune + neon minimum);
`?v=` bumps for every touched js file. e2e goldens will shift a pixel or two where decals moved
up — flag it in the walkthrough, Claude decides on re-baseline.

---

## A16 — Track dressing (MASTERPLAN 3.4, session 29)  🟢 LANDED (retro-reviewed session 30)

> **Review note (Claude, session 30):** the drop was accidentally committed inside the PWA commit
> `885a187` (534 lines of scene-decor.js unlisted in the commit message) — another instance of the
> session-23 sweep incident; `git status` before every commit, always. Retro red-flag scan clean:
> all six items instanced/merged, no raw lights, no pool violations, decals on the `DD.DECAL`
> ladder. Antigravity's walkthrough reported all suites green.

_Corner furniture + race framing so the new Phase 3 pieces read at speed. Scene-decor only —
zero trackgen/physics edits._

**The set (all instanced/merged, decal-ladder heights, light-pool rule — no real-time lights):**
1. **Braking boards** — "100 / 50" distance boards before each detected corner (`track.corners`;
   the corner entry sample is `corners[i].entry`, boards at −100 m / −50 m along the sample walk,
   OUTSIDE edge = `-insideSign`). Reuse the corner-sign panel/post pattern (`buildCornerSigns`).
2. **Apex cones** — 3-4 small cones on the inside edge over each corner's apex span
   (`corners[i].apex ± 3`), just off the kerb band (lateral `w/2 + 1.4`). One InstancedMesh.
3. **Hazard chevron paint** on `tighten` pieces — alternating chevron decal on the deck along the
   tightening span (pieceName === 'tighten'), `DD.DECAL.centre` height, polygonOffset like every
   NormalBlending decal (A15).
4. **Start grid slab** — dark rectangular slab + painted grid box lines under the start
   (`startIdx ± 6`), below the existing start texture rung (`DD.DECAL.start`).
5. **Distance-to-finish boards** each 25% of `track.length` — small roadside panel, plain text
   texture ("75% / 50% / 25%"), skip if within 80 m of a checkpoint gate (visual clutter).
6. **Checkpoint ring variety** — per-biome accent on the existing checkpoint gates: frozen =
   icy blue-white halo, canyon = amber, dune = warm white, neon = magenta. Colour swap only
   (`theme.biome` branch where gates get their material) — no geometry change.

**Hard rules:** deterministic (any randomness = derived stream `seed + '::dressing'`, NEVER main
rng draws); every new mesh instanced or merged (GPU is fill-rate bound — overdraw is the enemy,
geometry is cheap); decals on the `DD.DECAL` ladder; `addLightSource()` pool only, and sparingly;
NOTHING may spawn on apron spans (`s.apron`), shortcut corridors (`track.shortcuts` chords ± 16 m),
or gap/landing spans. Wrap modulo N for any sample scan when `track.closed`.

**DoD:** all suites green (render-only — `drivability`/`verify_slide`/`verify_world` untouched);
game launched + one track per biome eyeballed; `?v=` bumps for every touched js file; walkthrough
in INBOX with screenshots.

---

# MOBILE UI PASS (Tibba-directed, 2026-07-13) — menus/screens must be playable on a phone

_Context: the game now ships as an installable PWA (`manifest.json` + `sw.js`) and as a Capacitor
APK (`apk-build/`, cloud-built by `.github/workflows/android.yml` on every push to master). The
new `tap` control scheme (tap-steer + auto-gas, brake-only button) landed in `885a187`. What's
left is making every non-race screen work at phone scale. **All of these are CSS/DOM-first briefs:
zero physics, zero trackgen, zero renderer changes.**_

**Shared rules for A17–A19:**
- Test at **360×800 portrait** and **812×375 landscape** (Chrome devtools device toolbar), plus
  one rotate mid-screen sanity check.
- Touch targets ≥ 44px on coarse pointers (`@media (pointer: coarse)`).
- **No `backdrop-filter` on anything visible during active racing** (menu-only screens may keep it).
- **No CSS transitions on pseudo-elements** (`::before`/`::after` freeze on Android WebView).
- Respect `env(safe-area-inset-*)` on every screen-edge-anchored element.
- `?v=` bump for every touched js file; suites green; launch + eyeball before hand-off;
  walkthrough with screenshots in INBOX.

## A17 — Garage mobile layout  🟢 LANDED (session 30 — post-hoc review; on-device verify pending)

_Portrait: the 320px left sidebar covers most of the phone screen and the car showcase is
invisible behind it. Landscape: workable but cramped._

1. **Portrait ≤ 768px: sidebar becomes a bottom sheet.** `.garage-sidebar` → `width:100%`,
   `height:52%`, anchored bottom (top border instead of right border, shadow up). Car showcase
   (canvas) owns the top half. Keep the existing `@media (max-height:480px)` landscape compaction
   as-is.
2. **Tabs → one horizontally scrollable row** in the sheet (`overflow-x:auto`, no wrap,
   `min-height:44px` per tab). Azeret 9px is too small on phones — bump to 11px on coarse pointers.
3. **`.garage-instruction` ("drag to rotate")**: hide below 768px width — it overlaps the sheet
   and phones don't need the mouse hint.
4. **`#editModeBar`**: portrait → centered at top over the showcase (it currently offsets
   `left:calc(50% + 160px)` assuming the desktop sidebar). Must not overlap the sheet.
5. **`.gItem` rows ≥ 44px tall** on coarse pointers (currently 10px padding + 11px font).
6. Orbit-drag on the showcase must keep working with the sheet up (drag region = top half).

**Files:** `index.html` (CSS only, ideally). If a class toggle is unavoidable, smallest possible
`game.js` hook + `?v=` bump.
**DoD:** shared rules above; garage usable end-to-end (pick paint/finish/preset, save, back) on
both test viewports.

## A18 — Campaign / settings / finish mobile compaction  🟢 LANDED (session 30 — post-hoc review; on-device verify pending)

1. **Campaign portrait** (existing 55/45 split stays): compact `.campaign-left` padding
   (`min(6vh,35px)` → 12px on ≤480w), `.trackBtn` ≥ 44px tall, DRIVE button always visible
   without scrolling the details pane (sticky bottom inside `.details-content` if needed).
2. **Campaign short-landscape (≤470h):** header row + subtitle compact so ≥ 2 tier cards visible.
3. **Settings:** `.panel` → `max-height:78vh`; `.setRow` wraps to two lines on ≤380w (label row +
   control row, range full width); every checkbox/range/select hit area ≥ 44px on coarse pointers.
4. **Finish card ≤ 480w:** padding `20px 16px`, `#finTime` 40px, `.finRow` → 2-column grid,
   buttons ≥ 44px tall. Card must fit 812×375 landscape without clipping.
5. **Replay HUD ≤ 480w:** tighter padding, buttons ≥ 44px, slider thumb 20px.
6. **Main menu polish:** `.mbtn` vertical padding +2px on coarse pointers; verify the short-
   landscape scroll block (`@media (max-height:470px)`) still reaches every button with the seed row.

**Files:** `index.html` CSS only.
**DoD:** shared rules; full loop (menu → campaign → race → finish → replay → menu) on both test
viewports without any clipped/unreachable control.

## A19 — Tap-scheme polish (the new default mobile feel)  🟢 LANDED (session 30 — post-hoc review; item 5 two-finger restart consciously dropped — on-screen buttons reachable since the z-index fix)

_The `tap` control scheme landed functional but raw. Known issues found in review._

_Update session 30: `tap` is now the DEFAULT controlMode for fresh saves (core.js), and item 1
below is already FIXED by Claude (`#gameButtons` → `z-index:7`) — don't redo it, but do verify it
on-device as part of this brief's DoD._

1. ~~**BUG — zones swallow the in-game buttons**~~ 🟢 fixed session 30 (`#gameButtons z-index:7`;
   zones at z6 below).
2. **Brake placement in tap mode:** `#padBrake` still sits at the old offset next to the (hidden)
   gas pad. In tap mode move it to the bottom-right corner slot (`right:max(24px, env(...))`) and
   enlarge to 112px — it's the only button, make it obvious. Body class exists? If not, toggle
   `body.tap-mode` from `updateSteerPadsVisibility()` (`game.js`, tiny diff, `?v=` bump).
3. **Steer feedback:** brief edge indicator while a zone is held — a slim (≤48px wide) static
   gradient strip at the screen edge, toggled by class on touchstart/end. Class toggle + static
   styles ONLY (no transitions on pseudo-elements, no repaint-heavy full-screen overlays).
4. **First-run hint:** entering a race in tap mode → centered overlay "◀ tap left · right tap ▶ ·
   hold to steer" for 2.5s, once per session (`sessionStorage`), `pointer-events:none`.
5. **Two-finger restart gesture** (`bindCanvasGestures`) is dead in tap mode — zones eat canvas
   touches. Either re-bind the gesture on the zones or accept the on-screen restart button as the
   only path (your call; note it in the walkthrough).

**Files:** `index.html`, `js/input.js`, `js/game.js` (small diffs each, bump all touched `?v=`).
**DoD:** shared rules; drive a full race in tap mode in device emulation — steer, brake, restart,
respawn, exit all reachable; hint shows once; suites green (`node tests/drivability.js` at
minimum — input.js is sim-adjacent).

## A20 — APK launcher icon + adaptive icon set  🔴 OPEN

_The installed app still shows a placeholder/default launcher icon. Make DRIFTDREAM look like a
real app on the home screen. **Art + native resources only — zero game-code changes.**_

**Design spec (the identity, not a suggestion):**
- Background layer: near-black radial `#07040e` center → `#140b2e` edge (subtle, not flat black).
- Foreground glyph: a **forward-leaning double-chevron "DD" monogram** (speed chevrons that read
  as DD), gradient stroke `#9d7bff → #ff7bd5` with a thin warm `#ffb37b` edge light on the
  leading edges. Optional faint horizon line behind the glyph, nothing else.
- NO text, no thin strokes under ~8 px at 1024², no fine detail — must read at 48 px.
- Adaptive-icon safe zone: glyph fits the central **66% circle** (Android masks corners freely —
  test round + squircle crops).

**Deliverables:**
1. `assets/icon-source.svg` — hand-authored vector master (foreground + background as separate
   top-level groups, so the layers can be exported independently).
2. `assets/icon.png` (1024², full composite) + `assets/icon-foreground.png` +
   `assets/icon-background.png` (1024² each). Rasterize the SVG however is reproducible on this
   machine — the e2e host-Chrome screenshot path works (load the SVG in a page, capture at size).
3. Android resources in `apk-build/android/app/src/main/res/`:
   - `mipmap-anydpi-v26/ic_launcher.xml` + `ic_launcher_round.xml` referencing foreground/
     background layers (adaptive icon).
   - All density buckets (`mipmap-mdpi` 48 → `mipmap-xxxhdpi` 192, plus round variants).
   - Prefer `npx @capacitor/assets generate --android` (dev-dep in `apk-build/`) over hand-sizing;
     hand-fix only what it gets wrong.
4. Splash stays **solid black** (deliberate — seamless into the black canvas). Do not add a logo
   to the splash without a 👀 NEEDS EYES post first.

**DoD:** `gradlew assembleDebug` compiles (CI proves it on push); walkthrough in INBOX with the
icon rendered at 192/96/48 px + a masked-circle preview so Tibba can judge the crop; every
generated file listed. No `?v=` bumps (no web-code changes).

---

# TRACK REWORK — width, modules, furniture, set-pieces (Tibba-directed, 2026-07-05)

_Tibba: "tracks are too narrow for creative driving — you always hit the fence drifting. I want
wider tracks + more module variety + track-attached lights/poles/tunnels/signs, road loops, bigger
wider jumps, wallride rework, better boost pads, better start line, better checkpoints."_

**Two decisions locked with Tibba:**
1. **Full campaign re-roll.** Existing campaign PBs/medals are invalidated and re-derived from the
   new bot on the new wider tracks. (Daily/random seeds are unaffected — they regenerate anyway.)
   → **Claude does this** (it's a `buildValidTrack`/seed change, physics-adjacent). Do NOT preserve
   old campaign layout — the whole point is new tracks built for the new width + new pieces.
2. **Everything in parallel.** The T-briefs below are independent (different files / different
   subsystems) and can be picked up simultaneously. Each is self-contained.

**Verified root causes (Claude, 2026-07-05):**
- **Width:** `wBase = lerp(13.5, 9, tier)` → **13.5m T1 → 9m T5**, varied 0.8–1.35×/piece. A tight
  T5 corner hits **7.2m** wide. F1 car ~2m → ~2.6m each side. Drifting a rear-end-out at 250 km/h
  needs ~6m+ each side. THIS is why you always hit the fence. (`trackgen.js:31`)
- **Boost pads have NO visual** — `SURF.BOOST` is a physics flag only; nothing in `scene-decor.js`
  marks where a pad is. You can't see them.
- **No tunnels, no loops, no dedicated start line** — nothing overhead; the grammar is yaw-only
  banking (pitch is gentle hills, can't make a vertical loop); start line reuses the finish torus.
- **Checkpoints** are thin additive torus rings (`buildGates`, `scene-decor.js:796`) — easy to miss
  at speed, no "sector" numbering, no progress feel.
- **Wallride** is narrower than normal track (0.7–0.85× width) — backwards for a piece that needs
  commitment room.

## T1 — Widen all tracks (Claude-owned, physics-adjacent)  🟢 LANDED (session 24)

**Scope (touch ONLY `js/trackgen.js` `makePieces` + the `wBase` line):**
- `wBase`: `lerp(13.5, 9, t01)` → `lerp(20, 14, t01)` (T1 ~20m, T5 ~14m — both wide enough to drift
  at race speed; T5 stays tighter than T1 for skill curve).
- `wVar` floor: `rng.range(0.8, 1.35)` → `rng.range(0.92, 1.35)` (no piece narrower than 92% of an
  already-wider base — kills the 7.2m horror case).
- Hairpin `wVar() * 1.25` → `* 1.45` (tight corners get EXTRA runoff for drift entry/exit).
- Wallride `wBase * range(0.7, 0.85)` → `wBase * range(1.05, 1.2)` (wider than normal — it's a
  commitment piece, give it room).
- Re-derive campaign medals after (the bot re-runs on the wider tracks). In `core.js`, bump the
  save version so old `driftdream_v1` saves clear campaign progress on load (Tibba approved this).

**DoD:** field notes 1–3 + drivability green (the wider tracks may shift bot times — re-run test 11
"all generated tracks bot-completable" and confirm). The campaign re-roll means existing campaign
PBs are gone — that's intended. **Touch nothing in physics or scene.**

## T2 — Boost pad visuals  🟢 LANDED (session 24)
**Parallel-safe: touch ONLY `js/scene-decor.js` (new `buildBoostPads` + call in `buildTrackScene`).**

Boost pads are invisible today (`SURF.BOOST` flag only). Build a clear, readable pad:
- Scan `track.samples` for `surf === DD.SURF.BOOST`; for each contiguous run, build a glowing
  chevron-arrow pad on the road surface (emissive only, additive, `fog:false`, registered to the
  light pool via `addLightSource` if near the front of the field).
- **Instanced** (one InstancedMesh for the pad plates, one for the chevron arrows across all pads —
  the instancing rule is load-bearing, see field notes). Bright accent/boostColor, animated forward
  scroll in the loop (reuse the shared breath LFO or a dedicated fast scroll for "energy flowing").
- Make it OBVIOUS from a distance — a driver at 300 km/h must see the pad coming and aim for it.
**DoD:** field notes 1–3 + screenshot of a boost pad approached at speed (reads clearly), draw calls
within ±2 (`DD.debugGL()`).

## T3 — Dedicated start line + finish gantry  🟢 LANDED (session 24, integrated into buildGates)
**Parallel-safe: touch ONLY `js/scene-decor.js` (`buildGates` or a new `buildStartLine`).**

The start line reuses the finish torus — no sense of "this is the start." Build a proper gantry:
- A start gantry over `startIdx`: two lit posts + a crossbar + a big "START / SECTOR 0" sign panel
  (chevron-board treatment from A10, emissive frame). Grid markings on the road surface (painted
  start-line stripes via a strip overlay).
- The finish gantry (at `finishIdx`) gets a distinct treatment — a "FINISH" sign + a checkered
  accent so the two are visually distinct (you should instantly know which is which).
- Keep checkpoint rings but make them clearly "intermediate" (see T4).
**DoD:** field notes 1–3 + screenshot of the start gantry (reads as a start line, not a checkpoint),
draw calls within ±3.

## T4 — Checkpoint rework  🟢 LANDED (session 24, integrated into buildGates)
**Parallel-safe: touch ONLY `js/scene-decor.js` (`buildGates`).**

Tibba: "better looking and more evident checkpoints." Current = thin additive torus rings, easy to
miss at speed. Rework:
- Heavier gantry-style frames (posts + crossbar, not just a floating ring) so they read as gates
  you drive THROUGH, not rings you drive past.
- **Sector numbering**: each checkpoint shows its number (1, 2, 3…) on the crossbar — use the
  existing chevron-board dial-in styling. On circuits, number wraps per lap.
- Brighter, more present: stronger emissive + a brief flash/pulse as you pass (wire in `game.js` the
  existing `justCkpt` event — the purple sector flash already exists, extend it to a gate-mesh
  pulse). Accent2 color so they're distinct from the start (accent) and finish.
- Keep exactly one InstancedMesh strategy if you instance the posts; respect the 12-light pool.
**DoD:** field notes 1–3 + screenshot of a checkpoint approached at speed (number reads, gate is
unmistakable), draw calls within ±3.

## T5 — Tunnels  🟢 LANDED (session 24)
**Parallel-safe: touch ONLY `js/scene-decor.js` (new `buildTunnels`).**

Nothing overhead exists today. Add tunnel gates at chosen sample ranges (e.g. on long straights or
crest pieces, biased by biome — neon gets more tunnels, frozen/dune fewer):
- Place tunnel "rings" (arched cross-section frames) at intervals over a sample range, with a
  semi-transparent roof mesh between them (dark, so it reads as enclosed). Emissive frame edges in
  accent color; lights hanging inside (registered to the pool). The enclosed feeling is the point —
  you drive INTO and OUT of a lit tube.
- Choose placement via a NEW derived rng stream (`DD.makeRng(seed + '::tunnels')`) — never draw from
  the main trackgen sequence (existing non-campaign seeds must stay identical).
- **Instance** the ring frames (one InstancedMesh across all tunnels). Roof can be a few merged
  meshes per tunnel.
**DoD:** field notes 1–3 + screenshot of entering a tunnel (reads as enclosed, frame edges glow),
draw calls within ±4.

## T6 — Big ramp jumps  🟢 LANDED (session 24)
**Parallel-safe: touch ONLY `js/trackgen.js` (the `kicker` and `jumpgap` piece builders) AND
`js/scene-decor.js` (landing-pad visual).**

Current kicker is a small hop; jumpgap is a flat gap. Tibba wants "bigger wider jumps."
- Widen both: `kicker` `wVar() * 1.15` → `* 1.5`; `jumpgap` `wVar() * 1.1` → `* 1.5` (wider = less
  fence-punishment on a bad landing).
- Add a new `bigjump` piece: longer lip (25–35m up-ramp at ~0.22 pitch), longer gap
  (`rng.range(40, 70 + 15*t01)`), wider landing (`w * 1.6`), gentle downslope on landing for
  smoothness. Weight it into the rhythm/vertical/mixed archetypes (low weight — signature piece, not
  every track).
- Landing-pad visual in scene-decor: a glowing chevron target zone where you should land (emissive,
  additive — pairs with T2's boost-pad builder pattern).
- Use a NEW derived rng stream for any new randomness (`seed + '::bigjump'`) so existing seeds keep
  their non-bigjump layout identical.
**DoD:** field notes 1–3 + screenshot of a bigjump approached + landed, draw calls within ±2.

## T7 — Vertical loops (the big one — Claude specs, then delegable)  🔴

This needs a design note first because the trackgen integrator is yaw-only. Two sub-pieces:

**T7a (Claude): loop piece design** — spec how a vertical loop works in the current integrator:
- A loop = a sample range where `pitchT` ramps to steep up → continues past vertical → the car is
  inverted at the top → comes back down. The physics `stepGrounded` already tracks surface normal
  (`s.u`), so driving upside-down works IF the road mesh follows. The gap: the integrator's
  `pitchT` is currently clamped to gentle hills; needs a "loop mode" where pitch is unclamped and
  the up-vector follows the heading continuously.
- Output a design note in `IMPROVEMENT_PLAN.md` (the loop math + the integrator change + the
  bot/expert-solver implication — the bot must be able to drive a loop or it'll fail validation).
  **T7a blocks T7b.**

**T7b (Antigravity, vision): loop rendering + placement** — after T7a lands, build the loop mesh
(ribbon already follows samples, so the road bends through the loop naturally; add side-rollover
guard rails so you can't fall off the side while inverted, + a glowing loop-frame). Place 0–1 loops
per track (signature piece, high-tier only).
**DoD:** field notes 1–3 + screenshot of a loop. **Do NOT start until T7a design note is in.**

## T8 — Wallride rework  🟢 LANDED (session 24, banking in trackgen)
**Parallel-safe: touch ONLY `js/trackgen.js` (the `wallride` piece) + `js/scene-decor.js` (visual).**

- Widen (covered by T1's `wBase` change + wallride-specific `1.05–1.2×` here).
- Make the wallread BANK actual (currently `bankT: 0` — it's a flat curved piece flagged `wall:1`,
  relying on the invisible wall). Give it real banking `bankT: dir * rng.range(0.4, 0.7)` so the
  road surface tilts and the car genuinely sticks — reads as a wallride, not a flat corner with a wall.
- Visual: emissive edge strips that climb the bank (so the tilt reads), accent2 color.
**DoD:** field notes 1–3 + screenshot of a banked wallride (surface clearly tilts), draw calls ±2.

**Scope:**
1. Tier-completion celebration: an unlock animation/flash when crossing the 5-medal threshold to
   unlock the next tier (use existing `screen-boot`/`boot-flicker` patterns, not raw CSS `mask`).
2. "All author medals" special badge per tier (a full-clear indicator).
3. Per-track attempts counter + last-played highlight (data already in the save record —
   `rec.attempts`, `rec.lastPlayed`).
4. Dial-in/boot animations consistent with the rest of the UI (`dialInText` on track name, etc.).

**DoD:** field notes 1–3 + screenshot of an unlock moment + a fully-cleared tier.

---

# OPPORTUNISTIC BRIEFS (improve the game bit-by-bit; pick up when C4 is blocked or interleaved)

_These are NOT blocking. They're scoped, valuable improvements Antigravity can pick up whenever
the critical path is waiting on a Claude review or a Tibba playtest. Vision-friendly unless noted._

## O1 — E2E golden re-baseline  🟢 LANDED (session 24)

Every prior session flagged this as "needs a host re-baseline" and deferred it. Bloom/camera/car
(all of Wave 1) + physics (Wave 2) + terrain (C3) have all moved since the last goldens. The e2e
suite is effectively un-runnable until this is done.

- Run `node tests/e2e_runner.js -u` on the host (needs real Chrome via CDP — not headless-sandbox).
- Eyeball each new golden; flag any that look wrong to Claude before committing.
- DoD: `node tests/e2e_runner.js` (no `-u`) passes clean afterwards.

## O2 — Performance: per-frame allocation sweep  🟡 (Claude-coordinated; parts delegable)

STATUS #10 (still open): `DD.v` ops allocate arrays throughout; the A3 drop cached render-path
scratch but the physics/`DD.v` path was untouched by design. Look for **non-hot-path** `DD.v`
allocations (menu setup, track build, one-shot) that can use the existing `DD._ip*` in-place
helpers without touching determinism. **Do NOT touch the sim path** (`stepCar` and below) — that's
Claude's. DoD: field notes 1–3 + a before/after `renderer.info` or `performance.mark` measurement
showing reduced allocations on a known scene.

## O3 — Terrain decor placement polish  🟢 LANDED (session 24)
**Depends on: C3 (already landed). The C3 "remaining" item — landform-aware decor placement.**

C3 raised landforms (canyon rises +65m) but emissive decor (`buildEmissiveElements`,
`scene-decor.js`) is placed without checking slope. Sprinkle emissive ground-features ON the new
slopes/ridges (registered to the light pool where near the track), so canyon walls feel crystal-
studded and dune crests catch the sun. DoD: field notes 1–3 + per-biome screenshots (canyon, dune,
frozen, neon) showing decor reads on the new relief, `DD.debugGL()` draw calls within ±2.

## O4 — HUD speed-feel: speed-recede  🟢 LANDED (session 24)

STATUS "Still open" (session 8): side panels keep full opacity at all speeds; the speed-based fade
described in the original redesign vision was never implemented. Low priority but a nice feel win.
Risk: clarity vs. cool factor — keep it subtle (target ≥0.5 opacity floor). DoD: field notes 1–3 +
a screenshot at >90% speed showing the recede, with the timer still clearly readable.

## O5 — Garage: cross-section editor mode (Claude specs, then delegable)  ⚪

C5 / Wave 4. The ring-drag Length mode (session 15) proved the raycast→drag→mutate→rebuild pattern;
cross-section reuses it. Claude must spec the camera tween + `profile` primitive first; then it
becomes a delegable brief. **Defer until C4 + campaign lands.**

## O6 — Wheel spin cue for `glowDisc`  🟢 LANDED (session 24)

STATUS #14 (open from session 14): `glowDisc` (Neon Speeder's wheel) is rotationally symmetric — it
can never show a visible spin cue. Add an asymmetric blade/marker to the `glowDisc` builder
(`scene-car.js` `CAR_WHEEL_BUILDERS`). Small, self-contained. DoD: field notes 1–3 + a garage
screenshot showing the wheel reads as spinning.

## O7 — Wall-impact camera shake tuning  🟢 LANDED (session 24)

The camera kick on `hitWall` exists (`scene-core.js:700`) but is a fixed `-0.7` magnitude regardless
of impact speed. Scale it with `speedNorm` and add a FOV punch on heavy hits. Pair with A11 (you'll
be hitting walls to test audio anyway). DoD: field notes 1–3 + before/after screenshot of a hard
wall hit framing.

## O8 — Analog touch steering (mobile)  ⚪

STATUS #3 (still open): touch steer is binary `±1` (`input.js`); the physics' progressive modulation
is invisible to touch players. Tilt is the only analog steer. Harder than it looks — needs a
steering-zone pad with magnitude. **Parked by Tibba** in the plan but listed here for when mobile
work resumes.

---

# DEFERRED / PARKED (do NOT pick up without explicit Tibba sign-off)

- **Mobile:** haptics (#6 STATUS), mobile quality auto-default, worker-based track gen (#12 STATUS).
- **`js/scene-decor.js` split / dead-code deletes:** do opportunistically when touching those files.
- **`DD.PHYS` / medal retuning:** Claude-owned (C4b/C4c) — physics is not Antigravity's to tune.
- **C2 trackgen variety** (elevation drama, width modulation, surface rhythm): Claude-owned, after
  the bot playtest-report telemetry (item 8 in the plan) exists.

---

# LANDED (reference — don't redo)

- **A1** theme knobs (aurora/foggy/edgelit/shimmer) — session 19
- **A2** ghost UX, **A3** zero-alloc render path, **A4** scene split, **A6** sign backs — session 21
- **A5** impact audio (implemented but gated/masked → re-opened as A11, now landed)
- **A7** terrain color bake, **A8** lap HUD, **A9** emissive variety, **A10** chevron boards — session 23
- **Wave 1** (ghost-on-retry, glow budget, sky/sign/particle/garage, car presence, close camera) — session 17
- **Wave 2** (drift rework, author ghost, expert bot v2) — session 18
- **C2** multilap/closed circuits — session 20 · **C3** terrain height-policy rework — session 22
- **C4b** drift honest-model retune (v1 + v2) · **C4c** bot grip budget + medal retune — session 24
- **A11** impact audio (scrape loop, whump body tap, debugAudio, substep hitWall accumulation) — session 24
- **A12** campaign flow (track cache, finReplay, selection persistence, medal icons) — session 24
- **A13** campaign UI + gamification (tier cards, progress bars, medal colors, unlock animation) — session 24
- **O1** e2e golden re-baseline · **O3** terrain decor on slopes · **O4** HUD speed-recede · **O6** glowDisc spin cue · **O7** wall cam-shake — session 24
