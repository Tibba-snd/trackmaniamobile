# Handoff → next agent (Fable or anyone) — DRIFTDREAM C4 balance pass

_From: Claude (orchestrator). Date: 2026-07-04. You're picking up the C4 work mid-stream; two of
four C4 slices are landed (drift + bot/medals), two are delegated and in-flight (audio + campaign).
Read this top-to-bottom, then the ground-truth docs below._

## 0. What changed since you last saw the project

If you knew the game at commit `8df94c5` (session 23, "all A-briefs landed"), the C4 balance pass
has now started on a **new branch**. The drift and the bot are meaningfully different — read this
before driving the car or trusting medal times.

**Branch layout (memorize this):**
- `c4-work` — **you are here.** Active branch. Sessions 24+. C4 + campaign work.
- `baseline-v1` — **frozen playable version** at `8df94c5` (the pre-C4 game). `git checkout baseline-v1`
  to see/play what Tibba had before any C4 changes. Never commit here.
- `master` — untouched trunk (still at the initial commit). PRs merge here eventually.

**New collaboration docs (read in order):**
1. `BRIEFS.md` — the active Antigravity brief queue (A11–A14 + opportunistic O1–O8) with verified
   root causes + DoD. **Start here for what's open.**
2. `ANTIGRAVITY.md` — Antigravity's standing instructions + knowledge base. Read if you're acting
   as executor; skim if you're orchestrating.
3. `IMPROVEMENT_PLAN.md` §"Division of labor" — C4 is now broken into C4a/C4b/C4c/C4d with status.
4. `STATUS.md` — newest "Resolved this pass" entry (session 24) has the C4b/C4c details.

## 1. The two-agent model (how work happens now)

**Claude (orchestrator)** specs briefs, owns physics (`DD.PHYS`) + architecture, reviews every
`git diff`, fixes/integrates, commits, updates STATUS. **Antigravity (executor)** takes one brief
per drop, works uncommitted in the shared checkout, has **vision + hearing** (briefs are tagged with
which is needed). Nothing merges unreviewed.

**Critical workflow rule (learned session 23, reaffirmed session 24):** `git status` before EVERY
stage/commit. Antigravity's WIP is often in the tree. Session 24 hit this three times — Claude had
to stash Antigravity's audio.js/game.js/index.html changes, commit only its own files, then restore.
The pattern: `git stash push -m "ag-wip" -- <their files>` → commit yours → `git stash pop` → resolve
the inevitable `index.html` cache-buster conflict (take the higher `?v=` per file). Do NOT sweep
unreviewed work into your commit.

## 2. C4 status — what's done, what's open

### C4b — Drift retune ✅ LANDED (Claude, committed `27106f3`)
**Problem:** "drift looks good but understeers, not beneficial vs brake-and-turn."
**Root cause (verified):** velocity-follows-heading coupling was flat 2.2/s vs grip's 12/s. Nose
rotated in fast, velocity plowed ~16m wide at 35 m/s.
**Fix:** speed-scaled `driftCouplingLo 7.0` / `driftCouplingHi 3.5` (`physics.js` DD.PHYS); scrub
0.5/0.22 → 0.38/0.16 (`physics.js:415`). Test 15 rewritten to steady-state radius — proves the
**~25 m/s crossover** where drift becomes tighter than grip. All physics-affecting lines listed in
the commit message (slope-gravity rule).
**Judgment awaiting Tibba:** does the crossover feel right? Is drift too strong/weak at race speed?

### C4c — Bot + medals ✅ LANDED (Claude, committed `163b101`)
**Problem:** "bots very slow, medals too easy."
**Root cause (verified):** expert solver budgeted `(gripF+gripR)*0.5 ≈ 1.66g` while the player's
grip regime allows ~3g → bot at ~0.74× human corner speed.
**Fix:** solver `gripAvail` 0.5 → 0.90 (`physics.js:592`); medals author = bot×1.00, tiers
1.08/1.20/1.45 (`physics.js:728-734,743`). Test 18 added (locks it). Circuit lap ~11.5% faster.
**Judgment awaiting Tibba:** the tier spreads (1.08/1.20/1.45) are a first guess — playtest and
we'll move them. Author-as-bot-reference is the design; the spreads are the dial.

### C4a — Impact audio 🟡 A11 in-flight (Antigravity WIP in tree, uncommitted)
**Problem:** "can't trigger the new noises."
**Root cause (verified):** the A5 sounds fire but are gated too strictly (`speed > 10`, `prevVelY <
-2`) and masked by the engine. NOT broken — just quiet/rare.
**Status:** Antigravity's WIP is in `js/audio.js` + `js/game.js` (scrape-loop, debugAudio flag,
`frameHitWall` accumulation across substeps — a good fix for the race condition). **Claude has NOT
reviewed it yet.** Next step: review the diff, finish integration, commit. Brief in `BRIEFS.md` A11.

### C4d — Campaign rework 🟡 A12 started, A13/A14 pending (Antigravity)
**Problem:** "can't re-enter a finished campaign track; UI is off; needs gamification."
**Root cause (verified):** no track cache (`buildValidTrack` re-runs on every menu open + selection);
`buildCampaignMenu` resets selection to track 1 each open; no replay button on finish screen;
`MEDAL_ICON` gold/silver/bronze all `●`.
**Status:** Antigravity added `#finReplay` button to `index.html` (A12 started). Briefs A12/A13/A14
in `BRIEFS.md` — flow+cache / UI+gamification / polish. **Sequential dependencies:** A12 → A13 → A14.

## 3. Open judgment calls (Tibba playtests needed — do NOT finalize without him)

1. **Drift crossover feel:** is ~25 m/s the right crossover speed? Does drift feel like a tool now,
   or still punishing? (C4b numbers are physics-derived; feel is Tibba's call.)
2. **Medal tier spreads:** 1.08/1.20/1.45 is a first guess against the new fast bot. May need
   widening/narrowing after real play. (C4c.)
3. **Campaign scope:** the A13/A14 UI/gamification direction needs Tibba's taste sign-off on
   screenshots (Antigravity has vision — use it).

## 4. Opportunistic briefs (pick up when C4 is blocked on a review/playtest)

`BRIEFS.md` §"OPPORTUNISTIC BRIEFS" — O1 through O8. Highlights:
- **O1 — e2e golden re-baseline** (needs host Chrome): every session since Wave 1 deferred this;
  the e2e suite is effectively un-runnable until it's done. High value, vision+host required.
- **O3 — terrain decor on the new C3 landforms** (vision): decor placement doesn't check slope;
  canyon walls/dune crests want crystal-studding.
- **O6 — glowDisc spin cue**, **O7 — wall-hit cam shake tuning** (vision, small, self-contained).

## 5. How to verify your work (the rules that keep biting people)

1. **Run the FULL suite after your FINAL edit:** `node tests/drivability.js` (now 43 tests),
   `verify_determinism`, `verify_colors`, `verify_m2_features`, `verify_camera`, `verify_sky_stars`.
   Or `node dd.js test`.
2. **A green suite does not prove the game BOOTS.** Launch it: `node dd.js serve` → open
   `/?seed=...` (NOT `/index.html?...` — the server strips query strings on redirect) → start a
   race → reach `play` → watch the console. Sessions 19 & 21 shipped "all tests pass" with crashing
   games.
3. **Bump `?v=` cache busters** in `index.html` for every changed js file. Without them Tibba's
   browser runs OLD code against NEW html.
4. **`git status` before every commit** — the two-agent workflow means uncommitted WIP is usually in
   the tree. Don't sweep it in. Stash → commit → restore → resolve the cache-buster conflict.
5. **Walkthrough lists every gameplay-affecting line.** The slope-gravity deletion (session 18) is
   the canonical incident. If you changed a `DD.PHYS` number or removed a term, say so.

## 6. Hard invariants (unchanged — don't cross without a design note)

Determinism (no `Math.random` in sim; new trackgen randomness = new derived rng stream), `DD.PHYS`
changes are Claude-reviewed, `buildCar` contract (`verify_m2_features`), `normalizeSpec` (glow =
emissive only), light pool rule (`addLightSource`, 12-point cap), `DD.GLOW` discipline (no magic
glow constants), closed-circuit wrap (modulo N when `track.closed`).
