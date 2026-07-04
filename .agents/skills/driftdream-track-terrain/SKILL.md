---
name: driftdream-track-terrain
description: Handles track generation piece grammar, pacing curves, signature set-pieces, occupancy grids, and heightfield value-noise terrain.
---

# DRIFTDREAM Track and Terrain Generation

This skill covers the procedural generation of tracks and underlying terrain. All algorithms here are **Three-free** to allow testing in headless environments.

## File Map
- **Track & Terrain Generation:** `js/trackgen.js` → `DD.generateTrack()`, piece builders (straights, sweepers, chicanes, kickers, etc.), road ribbon framing (`f/u/r` basis vectors), checkpoint placement, corner detection, and `buildTerrainData()`.
- **Theme Coupling:** `js/theme.js` → defines the biome (`dune`, `neon`, `canyon`, `frozen`), which in turn dictates the terrain amplitude (`theme.terrainAmp`), terracing, weather, and signature set-pieces.
- **Rendering Road & Terrain:** `js/scene.js` → `buildRibbon()`, `buildTerrainMesh()`, decor generation, and instanced emissive props.

## Technical Details

### 1. Piece Grammar & Pacing
- Tracks are integrated incrementally at 2-meter samples.
- The grammar uses 6 archetypes (`speedway`, `technical`, `rhythm`, `drift`, `vertical`, `mixed`) with weighting tables.
- The pacing curve shapes the track:
  - **0% - 30%:** Flowing, fast start.
  - **30% - 75%:** Technical middle with the **signature set-piece** injected near 40% (`gorge`, `corkscrew`, `ice_slalom`, or `void_extreme` depending on campaign tier/theme).
  - **75% - 100%:** Fast, high-speed finish.
- Braking straights are added before tight corners to help the bot and player prepare.

### 2. Occupancy Grid
- Cell size is 22. It tracks self-intersections.
- Each piece tries up to 3 alternate generations when a collision is detected. If all fail, it falls back to a forced overlap (`overlapForced`).

### 3. Terrain Basin
- A 120x120 value-noise heightfield covers the track AABB with a 340-meter margin.
- **Elevation Rules:** Heights are clamped to remain at least 8 meters below the lowest track sample to prevent clipping. It is raised under the road (embankments) and pushed deep down under gap segments.
- Bilinear interpolation via `DD.terrainAt(x, z)` and `DD.terrainNormal(x, z)` retrieves terrain altitude and normals.

## Rules & Gotchas
- **No Three.js:** `js/trackgen.js` must NEVER import or reference Three.js.
- **Determinism:** All generation parameters must use the seed-based RNG via `DD.makeRng(seed)`.
- **Performance:** `buildTerrainData` performs a double scan of the heightfield and is a heavy main-thread blocker. Do not increase the grid resolution (`RES = 120`) without optimizing the lookup.
