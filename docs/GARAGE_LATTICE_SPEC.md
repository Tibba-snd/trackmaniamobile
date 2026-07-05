# G-LATTICE — Lattice Warp Deformer (advanced authoring, lowest priority)

> **Status:** design spec, **DEFERRED build**. Largest scope, lowest player value of the 8 authoring rungs. Ship only if the other 7 land and time remains.
> **Predecessors:** none blocking. Independent of T8-T10/T12-T14.

## Goal

Add a Free-Form Deformation (FFD) lattice warp to any solid block (`box`/`cyl`/`sphere`/`torus`/`slab`/`loft`). The player drags cage points to bend enclosed geometry without changing topology. This is the "add movable points to an existing mesh" rung (CAR.md §1.5).

## Why lowest priority

- The other 7 rungs (tweak/swap/add-remove/new-parts/colour/wheels/glow/save) cover 95% of player authoring. Lattice is power-user sculpting.
- FFD implementation is non-trivial (trilinear weight computation per vertex, cage point picking, per-frame deformation cost).
- Player value vs engineering cost is the worst ratio in the garage.

## Data model (CAR.md §1.5)

```js
deform: {
  lattice: {
    nx: 2, ny: 2, nz: 2,           // cage resolution (2x2x2 = 8 corner handles minimum)
    offsets: [{x,y,z}, ...]         // length must equal nx*ny*nz; default = identity cage
  }
}
```

- `offsets[i]` is the cage-point displacement from its identity position.
- Identity cage = no deformation (mesh renders as the base prim).
- `normalizeSpec` clamps: `nx/ny/nz` ∈ [2,4] (so max 64 cage points), `|offset|` ≤ 2.0 per axis, drops mismatched-length `offsets`.

## Build path

FFD is a **post-pass** on the base prim's geometry:
1. Build the base prim (`box`/`cyl`/etc.) → `BufferGeometry`.
2. If `deform.lattice` present + valid: compute trilinear weights for each vertex against the cage, apply `offsets`, write back positions + recompute normals.
3. Cache weights per (prim, lattice-resolution) pair so re-deforming on drag is cheap.

## Implementation surface (deferred)

| File | Change | Cost |
|------|--------|------|
| `js/carspec.js` | `deform.lattice` schema + normalize. | Small, testable. |
| `js/scene-car.js` | FFD post-pass function + cage-handle builder. | **Large** — trilinear math, weight cache, drag handler. |
| `js/game.js` | Cage-handle picking (extend existing raycast). | Medium. |
| `tests/verify_carspec.js` | Lattice normalize cases. | Small. |

## Risks

- **Per-frame cost:** FFD on a high-vertex mesh every drag frame could stutter. Mitigate: cap lattice resolution, cache weights, only deform on pointer-move (not every render frame).
- **Normals:** after deformation, recompute vertex normals — costs a `computeVertexNormals()` per edit. Acceptable mid-drag if vertex count stays low.
- **Mirror:** no built-in mirror (lattice is 3D). Players handle symmetry by editing matching cage points manually, or we add a mirror mode later.

## Decision

**Defer build until T8-T10/T12-T14 ship.** Revisit if (a) all 7 other rungs land with time remaining, AND (b) a player/developer specifically requests lattice sculpting. Until then, this spec documents the design so it's not lost.
