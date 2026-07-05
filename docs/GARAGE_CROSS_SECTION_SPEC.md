# G-CROSS — Cross-Section Editor Mode (Garage P2 deep slice)

> **Status:** design spec (Claude-owned per CAR.md §9 / IMPROVEMENT_PLAN C5). Once approved, this becomes a delegable build brief (Wave 6 T12).
> **Predecessors:** session-15/16 Length-rings editor (live), G1-G7 (landed). Deferral condition (C4 + campaign) cleared.

## Goal

Add a third edit mode **`cross`** to the garage editor. When the player grabs a ring handle, the camera tweens **end-on** (down the spine) so the ring reads as a flat 2D outline. The player then drags ring points to reshape that cross-section locally (bulge/crease/pinch). Exit → camera tweens back to 3D orbit, hull re-lofts with the new shape.

This is the "make your own body silhouette" power-user tool. It is the deepest authoring slice in the garage.

## Non-goals (this brief)

- **NOT** a free-form 2D outline editor for arbitrary `profile` prims (lathe/extrude). That is T11 / future. Cross-section mode edits the **hull's existing ring**, not a new `prim:'profile'`.
- **NOT** per-station `ring` overrides for every station — only the grabbed station gets local overrides (others keep the global cross-section shape).
- **NOT** adding/removing ring points (`split edge`/`delete point`). That's a follow-up. v1 only drags existing points.

## Data model

### Schema addition (`js/carspec.js`, THREE-free)

Add a per-station `ring` override array. A station becomes `[z, w, h, y, ring?]`. `ring` is OPTIONAL (null/absent = use global superellipse shape; present = local override).

```js
// ring override — 2D outline of ONE cross-section, normalized to [-1,1] around its centroid.
// pts: [{ x, y, smooth }]  — x = horizontal (width axis), y = vertical (height axis, +up).
//   `smooth` = quadratic round between edge midpoints; false = hard corner.
// K (point count) must equal buildHull's ring resolution (currently 18) for a 1:1 drag → vertex map.
// Bounded: |x| ≤ 1.5, |y| ≤ 1.5, 3 ≤ K ≤ 24, K must match hull K or normalize drops the override.
ring: { pts: [{ x: 0.5, y: 0.3, smooth: true }, ...], mirror: true }
```

`mirror: true` (default) means drag the right half → left half mirrors across X. This is the symmetric-authoring mode from CAR.md §1.5.

### `normalizeSpec` rules (additive)

- `station[i].ring` is optional. If absent → hull uses global superellipse for ring `i`.
- If present: validate `pts` is an array of 3–24 `{x,y,smooth}` with finite numbers. Drop invalid.
- Clamp `|x|`, `|y|` ≤ 1.5.
- **K must match buildHull's `K`** (currently 18). If `pts.length !== 18`, drop the override (fall back to global shape) — mismatched counts would break the drag→vertex map.
- Cap total overrides across all stations at `MAX_STATIONS` (24).

### Build path (`js/scene-car.js` `buildHull`)

In the ring loop (lines 110-121), after computing the global `px, py`:

```js
const ringOverride = ST[m].ring && ST[m].ring.pts;
if (ringOverride && ringOverride.length === K) {
  const p = ringOverride[i];
  px = hw * p.x;          // override the global ellipse X
  py = yc + hgt * 0.5 * p.y;  // override the global ellipse Y (relative to station center)
}
```

This keeps a 1:1 map: ring point `i` ↔ hull vertex `i` in station `m`. Drag the handle → mutate `pts[i].{x,y}` → live `updateHullGeometry`.

## Camera tween (the headline interaction)

### State machine (in `js/game.js`)

New edit modes: `orbit` | `length` | `move` | `cross`. `cross` is reached by **grabbing a ring handle while in `length` or `move` mode** (not by clicking the disabled `cross` toolbar button — that becomes enabled once a ring is grabbed).

1. **Pick (length/move mode):** raycast hits a ring handle → `stationIndex` recorded.
2. **Tween start:** on pointer-down-with-handle-hit, set `G.crossSession = { stationIndex, tweenStart: now, fromCam: clone(camera.position), fromTarget: clone(camera.target) }`. Switch `G.editMode = 'cross'`.
3. **Tween (300ms ease-in-out):** camera moves from current orbit position to **end-on down the spine**:
   - Target = grabbed station's world position (`hullStationLocalPos(spec, hp, L, stationIndex)` + car group origin).
   - Position = target + spine-axis offset (`+Z * distance`). `distance` = current orbit radius (~7.5).
   - Up vector = `+Y`.
   - The ring now reads as a flat outline facing the camera.
4. **Edit:** pointer drag mutates `workingSpec.chassis.hull.station[stationIndex].ring.pts[hitPointIndex].{x,y}`. Mirror applies if `ring.mirror !== false`.
5. **Exit:** pointer-up OR Esc OR click empty space → tween back to `fromCam`/`fromTarget`, restore `G.editMode = 'length'`.

### Why tween, not snap

A snap is disorienting (where am I? what am I looking at?). A 300ms tween keeps the player oriented: they SEE the camera swing to end-on, so the 2D outline reads as "the same ring I just grabbed, now flattened."

### Handle projection

In end-on view, ring handles project as 2D dots arranged in the ring's outline. Raycast still works (3D spheres), but the drag mapping is simpler: screen-X → `pts[i].x`, screen-Y → `pts[i].y`, both normalized by the ring's on-screen radius. No Z drag (the ring is a 2D outline in this mode).

Add a per-handle `userData.pointIndex = i` (in addition to `stationIndex`) so `pickHandle` returns both. Current handles only carry `stationIndex`; the cross-session ring builder adds 18 child handles (one per ring point) inside the station's handle group.

## UX details

- **Visual cue during tween:** the grabbed ring's outline highlights (add a thin emissive line loop following the ring's `pts`). Other rings dim to 30% opacity. Tells the player "you're editing THIS ring."
- **Mirror indicator:** if `ring.mirror !== false`, draw a faint vertical line at X=0 (the mirror axis).
- **Esc / right-click:** cancel cross-session, tween back, discard NO changes (edits already applied live).
- **Switching station mid-cross:** clicking another ring's handle re-tweens to that station (no exit-and-re-enter). Cheap because the tween is camera-only; the hull doesn't rebuild.

## Implementation surface (delegable brief)

| File | Change |
|------|--------|
| `js/carspec.js` | Add `ring` to station schema + normalize rules. Headless-testable. |
| `js/scene-car.js` | `buildHull` reads `ring` override. New `buildRingOutline(spec, stationIndex)` helper for the highlight line. New `buildCrossHandles(spec, stationIndex)` for the 18-point child handles. |
| `js/game.js` | `cross` edit mode state machine, camera tween (extend the orbit loop), pointer handler for ring-point drag (mirror logic), Esc/click-empty exit. |
| `index.html` | Enable the `editMode_cross` button (remove `disabled`) once a ring is grabbed; otherwise greyed with tooltip "grab a ring first". |
| `tests/verify_carspec.js` | `ring` normalize cases: valid/invalid/mismatched-K/mirror-absent. |

## Definition of done

1. `node tests/verify_carspec.js` passes (new `ring` cases added).
2. `node tests/verify_m2_features.js` passes (hull mesh still valid with `ring` overrides; add THREE mock if any new class).
3. `node dd.js test` green.
4. `node dd.js sync`.
5. **Manual:** in browser, grab a ring → camera tweens end-on → drag a point → ring reshapes → release → camera tweens back. Mirror mode produces symmetric edits. No NaN/crash on degenerate drags.

## Risks

- **K mismatch:** if `pts.length` ≠ buildHull's K, drop the override. Test this explicitly.
- **Tween jank:** 300ms is the target; if it stutters, drop to 200ms or snap. Don't ship a nauseating camera.
- **Z-fighting on ring outline:** render the highlight line at `renderOrder = 998`, `depthTest = false`.
- **Mobile pinch-zoom conflict:** during cross-session, pinch-zoom (T6) should be disabled — the camera is locked to end-on. Re-enable on exit.

## Open questions for Tibba (resolve before T12 build)

1. **Default `mirror`?** Spec assumes `true` (symmetric authoring is the 95% case). Confirm.
2. **Outline highlight color?** Spec uses `--warm` (gold). Confirm or pick.
3. **Snap-to-grid?** None for v1 (free drag). Add if precision becomes a pain.
