# G-ROOM — Garage Room Art Direction (Wave 4 item 12)

> **Status:** design spec, **LOCKED** (antigravity brief received 2026-07-05). Ready for T14 build.
> **Register:** minimalist studio with high-end gallery finish. Focus entirely on car curves.
> **Replaces:** Wave-1 interim garage stage (session 17 — `buildGarageStage` platform + `garageHide` registry).

## Goal

Replace the interim garage stage (a carbon platform parked on the raceway with the track world behind it, with poles/arches hidden) with a **dedicated garage room**: a self-contained "admire + edit" environment. Built once, cheap to render, no track world behind it.

Per IMPROVEMENT_PLAN item 12: "Dedicated environment (not the raceway): dark reflective floor, rim-light rig, slow env rotation, biome-neutral dusk backdrop."

## Why a room, not the raceway

- The raceway has biome decor, gate arches, sky, mountains. Hiding them (the `garageHide` interim fix) leaves a half-empty stage. A dedicated room is intentional, not a hole.
- A controlled lighting rig makes the car read consistently across biomes (no neon-canyon red bleed, no frozen-blue tint). The car is the hero; the room serves it.
- Built once = no per-biome garage cost. The track world never loads behind it.

## Art direction — LOCKED (antigravity brief 2026-07-05)

**Register:** minimalist studio with high-end gallery finish. Focus entirely on car curves.

### Floor
- **Mirror-polished obsidian black.** Solid — no grid lines (cleaner; antigravity confirmed exclusion).
- Under-car reflection clear; contact shadow (SDF `sdBox`) reads crisp on top via depth-fade, not a second surface.
- Single plane, no track geometry. Cheap.

### Backdrop
- **Biome-neutral deep indigo → pitch-black vertical gradient.** No sky dome, no mountains, no stars, no architectural elements.
- Pure shader/CSS gradient behind the car — no extra geometry.

### Light rig
- **One soft overhead rectangular softbox keylight.** No side point lights. This is the hero light.
- **Accent:** single horizontal neon wire on the back wall **at car-roof height** (antigravity confirmation: roof height, not ground level).
- **Accent color:** biome-tied cyan/magenta/gold, **15% opacity emissive bloom** (NO real light — bloom post-process only, per the §3 glow discipline).
- **Fill:** low ambient so shadows aren't pure black, but the softbox does the heavy lifting.
- Total real lights: 1 (the softbox). Accent wire = emissive material. Well under every cap.

### Accent color binding
- Biome-tied: reads current track theme's `--accent` (cyan=neon, gold=dune, magenta=canyon, white=frozen).
- Single source of truth: the room's accent wire + the car's under-car reflection tint both pull the same value, so the room always belongs to the biome without theming the whole space.

### Camera
- FOV narrowed to **60°** (vs race 68°) — premium, distortion-free product shot (antigravity).
- Slow auto-orbit continues (existing). Pinch-zoom (T6) works.

### Environment map (reflections)
- A dedicated garage env map (CubeCamera size 16, per the §3 cap) captured ONCE from the room's center. The car's PBR shell reflects the room (obsidian floor + softbox + accent wire), not the raceway.
- Currently `G.scene.environment` is the raceway capture. The room build captures a new one and swaps it in for the showcase car only; race car keeps the raceway env.

## Implementation surface (post-image)

| File | Change |
|------|--------|
| `js/scene-car.js` | Replace `buildGarageStage()` (lines 443-461) with `buildGarageRoom(envMap, accent)`. New: floor plane, backdrop, light rig, dedicated env-map capture. |
| `js/scene-core.js` | Stop emitting `garageHide` (no longer needed — room replaces the raceway view). Or keep as a fallback if room build fails. |
| `js/game.js` | Garage state: hide `G.track` meshes entirely while `state === 'garage'` (room is self-contained). Swap env map on car build. |
| `tests/verify_m2_features.js` | No new assertions (room is decorative). |

## Antigravity brief — received + locked

All four open questions resolved by antigravity's 2026-07-05 brief:
- **Register:** minimalist studio (confirmed over cyberpunk bay).
- **Floor:** solid mirror-polished obsidian, NO grid lines (cleaner).
- **Accent line:** horizontal neon wire on back wall at **car-roof height** (not ground level).
- **FOV:** 60° (narrowed from race 68°).

No further art-direction input needed before build. The build (T14) is unblocked.

## Definition of done (post-build)

1. `node dd.js test` green.
2. `node dd.js sync`.
3. **Visual spot-check (required, not optional):** screenshot the showcase car in the new room. Headless can't judge aesthetics — this is art direction. Compare against antigravity's brief + iterate via the back-and-forth loop below.
4. Car reflections show the room (obsidian + softbox + accent wire), not the raceway.
5. No perf regression: room render cost ≤ current interim stage cost.

## Back-and-forth loop with antigravity (post-build polish)

Per Tibba 2026-07-05: once the build is code-complete, run a visual-iteration loop:
1. Build agent ships T14, screenshots the garage.
2. Antigravity receives the screenshot + describes what differs from the brief + what reads well.
3. Lead (this agent) applies the deltas, re-syncs, re-screenshots.
4. Repeat until the screenshot matches the brief's intent.

This loop is art-direction polish only — code is done before the loop starts.
