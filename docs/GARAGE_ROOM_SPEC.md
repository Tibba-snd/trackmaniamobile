# G-ROOM — Garage Room Art Direction (Wave 4 item 12)

> **Status:** design spec, **BLOCKED on antigravity mood image**. The visual reference shapes the art direction; do not finalize until image reviewed.
> **Replaces:** Wave-1 interim garage stage (session 17 — `buildGarageStage` platform + `garageHide` registry).

## Goal

Replace the interim garage stage (a carbon platform parked on the raceway with the track world behind it, with poles/arches hidden) with a **dedicated garage room**: a self-contained "admire + edit" environment. Built once, cheap to render, no track world behind it.

Per IMPROVEMENT_PLAN item 12: "Dedicated environment (not the raceway): dark reflective floor, rim-light rig, slow env rotation, biome-neutral dusk backdrop."

## Why a room, not the raceway

- The raceway has biome decor, gate arches, sky, mountains. Hiding them (the `garageHide` interim fix) leaves a half-empty stage. A dedicated room is intentional, not a hole.
- A controlled lighting rig makes the car read consistently across biomes (no neon-canyon red bleed, no frozen-blue tint). The car is the hero; the room serves it.
- Built once = no per-biome garage cost. The track world never loads behind it.

## Art direction — pending mood image

The following is a **strawman** pending the antigravity mood image. The image may revise palette, light rig, backdrop style. Treat these as defaults to react against, not decisions.

### Floor
- Dark, highly reflective (mirror-clear wet asphalt / polished obsidian). The car's underside reflects; the contact shadow (SDF `sdBox`) still reads on top.
- Subtle accent-colored hairline grid (the `--accent` CSS var of the current biome, dimmed to 15%) — ties the room to the biome without bleeding color.
- Single plane, no track geometry. Cheap.

### Backdrop
- Biome-neutral dusk: deep indigo → near-black vertical gradient. No sky dome, no mountains, no stars.
- Optional: very faint volumetric haze behind the car (one sprite, emissive, billboarded). Adds depth without geometry.

### Light rig
- **Key light:** soft top-down spotlight, warm white (~4500K), aimed at the car's roof/hood. The hero light.
- **Rim lights:** two narrow accent-colored strips behind the car, left + right, slightly above. Creates the "car floating in a showroom" rim halo. Accent color = current biome `--accent`.
- **Fill:** low ambient hemisphere light (sky = indigo, ground = black, intensity ~0.15) so shadows aren't pure black.
- Total: 1 spot + 2 strip emissives (NOT real lights — bloom-only) + 1 hemisphere. Well under the 12-PointLight cap; actually uses 1 real light + hemisphere.

### Camera
- Slow auto-orbit continues (existing). Pinch-zoom (T6) works.
- Slight FOV narrowing (60° vs the race 68°) for a more "product shot" framing. Confirm in build.

### Environment map (reflections)
- A dedicated garage env map (CubeCamera size 16, per the §3 cap) captured ONCE from the room's center. The car's PBR shell reflects the room, not the raceway.
- Currently `G.scene.environment` is the raceway capture. The room build captures a new one and swaps it in for the showcase car only; race car keeps the raceway env.

## Implementation surface (post-image)

| File | Change |
|------|--------|
| `js/scene-car.js` | Replace `buildGarageStage()` (lines 443-461) with `buildGarageRoom(envMap, accent)`. New: floor plane, backdrop, light rig, dedicated env-map capture. |
| `js/scene-core.js` | Stop emitting `garageHide` (no longer needed — room replaces the raceway view). Or keep as a fallback if room build fails. |
| `js/game.js` | Garage state: hide `G.track` meshes entirely while `state === 'garage'` (room is self-contained). Swap env map on car build. |
| `tests/verify_m2_features.js` | No new assertions (room is decorative). |

## Antigravity pause — required input

Before the build (Wave 6 T14), I need a **mood image** from antigravity showing the desired look. The image should communicate:

1. **Floor material + reflectivity** (mirror / matte / wet)
2. **Light rig character** (hard spotlight / soft box / neon strips)
3. **Backdrop mood** (pure black / gradient / architectural)
4. **Overall register** (luxury showroom / cyberpunk bay / minimalist studio / industrial garage)

Without this, the build risks shipping a generic "dark room" that doesn't match the vision. The image locks the palette and the light rig in one pass.

## Definition of done (post-build)

1. `node dd.js test` green.
2. `node dd.js sync`.
3. **Visual spot-check (required, not optional):** screenshot the showcase car in the new room. Headless can't judge aesthetics — this is art direction. Compare against the mood image.
4. Car reflections show the room, not the raceway.
5. No perf regression: room render cost ≤ current interim stage cost.

## Open questions (resolve with the mood image)

1. Register: showroom / cyberpunk / studio / industrial?
2. Accent-grid on floor: yes/no?
3. Volumetric haze: yes/no?
4. FOV: narrow (60°) or keep race (68°)?
