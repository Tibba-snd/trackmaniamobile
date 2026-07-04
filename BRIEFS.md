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

# ACTIVE CRITICAL BRIEFS (C4 — do these first)

## A11 — Impact audio fix (hearing + vision required)  🔴

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

## A12 — Campaign flow fixes + track caching (foundation, no visual change)  🔴
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

## A13 — Campaign UI rebuild (vision-friendly)  🔴
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

## A14 — Campaign polish + progression feel (vision-friendly)  🔴
**Depends on: A13 landed.**

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

## O1 — E2E golden re-baseline (vision + host Chrome required)  🔴

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

## O3 — Terrain decor placement polish (vision)  🔴
**Depends on: C3 (already landed). The C3 "remaining" item — landform-aware decor placement.**

C3 raised landforms (canyon rises +65m) but emissive decor (`buildEmissiveElements`,
`scene-decor.js`) is placed without checking slope. Sprinkle emissive ground-features ON the new
slopes/ridges (registered to the light pool where near the track), so canyon walls feel crystal-
studded and dune crests catch the sun. DoD: field notes 1–3 + per-biome screenshots (canyon, dune,
frozen, neon) showing decor reads on the new relief, `DD.debugGL()` draw calls within ±2.

## O4 — HUD speed-feel: speed-recede at high velocity (vision)  🔴

STATUS "Still open" (session 8): side panels keep full opacity at all speeds; the speed-based fade
described in the original redesign vision was never implemented. Low priority but a nice feel win.
Risk: clarity vs. cool factor — keep it subtle (target ≥0.5 opacity floor). DoD: field notes 1–3 +
a screenshot at >90% speed showing the recede, with the timer still clearly readable.

## O5 — Garage: cross-section editor mode (Claude specs, then delegable)  ⚪

C5 / Wave 4. The ring-drag Length mode (session 15) proved the raycast→drag→mutate→rebuild pattern;
cross-section reuses it. Claude must spec the camera tween + `profile` primitive first; then it
becomes a delegable brief. **Defer until C4 + campaign lands.**

## O6 — Wheel spin cue for `glowDisc` (vision)  🟡

STATUS #14 (open from session 14): `glowDisc` (Neon Speeder's wheel) is rotationally symmetric — it
can never show a visible spin cue. Add an asymmetric blade/marker to the `glowDisc` builder
(`scene-car.js` `CAR_WHEEL_BUILDERS`). Small, self-contained. DoD: field notes 1–3 + a garage
screenshot showing the wheel reads as spinning.

## O7 — Wall-impact camera shake tuning (vision)  🟡

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
- **A5** impact audio (implemented but gated/masked → **re-opened as A11**)
- **A7** terrain color bake, **A8** lap HUD, **A9** emissive variety, **A10** chevron boards — session 23
- **Wave 1** (ghost-on-retry, glow budget, sky/sign/particle/garage, car presence, close camera) — session 17
- **Wave 2** (drift rework, author ghost, expert bot v2) — session 18
- **C2** multilap/closed circuits — session 20 · **C3** terrain height-policy rework — session 22
