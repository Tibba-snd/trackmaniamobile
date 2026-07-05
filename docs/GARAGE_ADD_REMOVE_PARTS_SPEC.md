# G-PARTS — Add/Remove Parts Editor (Garage P2 slice)

> **Status:** design spec (Claude-owned per CAR.md §9 / IMPROVEMENT_PLAN item 13). Once approved, becomes delegable build brief (Wave 6 T13).
> **Predecessors:** G3 wing knobs (landed — parts already read `knobs`). DD.CAR_PARTS catalog (16 builders, live).

## Goal

Let the player add and remove parts from their car's `spec.mounts[]` via a garage UI. This unlocks the "swap / add / remove parts" rungs of the authoring ladder (CAR.md goal). No new geometry — every part already has a builder in `DD.CAR_PARTS`. This brief is purely **catalog UI + spec mutation + normalize enforcement**.

## Non-goals

- **NOT** authoring new part types. That's a future primitive-composer (CAR.md §1.5 lattice). v1 only toggles the existing 16 parts on/off.
- **NOT** per-part positioning (mount-point picking). Parts self-position from `ctx.hp`/`ctx.L`. v1 keeps that.
- **NOT** per-part color/material override UI. That's a separate brief (per-slot editing, CAR.md §3). v1 uses the part builder's default material slots.

## Data model — already done

`spec.mounts[]` entries: `{ part: 'frontWing', knobs: {...}, at?: {...} }`. `normalizeSpec` already:
- Drops unknown `part` names (forward-compat).
- Caps `mounts.length` at `MAX_PARTS = 16`.
- Caps per-part block count at `MAX_MOUNT_BLOCKS = 64`.
- Sanitizes `knobs` (drops Infinity/NaN/objects).

So the schema needs **zero changes**. This brief is pure UI.

## UX

### New tab: `parts` (7th garage tab)

Add `parts` to the tab bar (after `wings`). Only visible when `G.workingSpec` is set (customize-only, like body/wheels/wings).

### Layout

```
┌─────────────────────────────────┐
│ PARTS (8/16)                    │  ← counter shows current/Max
├─────────────────────────────────┤
│ ✔ front wing          [edit]    │  ← mounted; toggle removes
│ ✔ rear wing (biplane) [edit]    │
│   rear spoiler (low)            │  ← unmounted; toggle adds
│   hover fins                    │
│ ✔ splitter                       │
│   splitter (glow)               │
│   halo                          │
│   shark fin                     │
│   diffuser                      │
│   exhausts                      │
│   exposed engine                │
│   hover channels                │
│   glow core                     │
│   ducktail                      │
│   chrome trim                   │
│ ✔ light bar           [edit]    │
└─────────────────────────────────┘
```

- Each row = one part from `DD.CAR_PART_NAMES` (16 total).
- **Mounted** (in `spec.mounts[]`): checkbox ✔, name, optional `[edit]` button → jumps to the `wings` tab if the part has knobs (frontWing/rearWingBiplane/rearSpoilerLow/hoverFins/lightBar), else no edit button.
- **Unmounted**: checkbox empty, name dimmed. Click toggles on.

### Toggle behavior

- **Add:** push `{ part: partName, knobs: {} }` to `workingSpec.mounts[]`. If at MAX_PARTS (16), refuse + flash counter red.
- **Remove:** filter out the first `mounts` entry with `part === partName`. (If multiple, removes the first — presets never have duplicates, but normalize tolerates it.)
- After either: `updateShowcaseCar()` live rebuild. Don't reassign `G.workingSpec` (stale-closure lesson from T4 — mutate `mounts[]` in place).

### Counter

`mounts.length` / `MAX_PARTS`. Red when at cap. Tiny CSS, no transitions on pseudo-elements (WebView).

## Implementation surface

| File | Change |
|------|--------|
| `js/game.js` | New `renderParts()` in `buildGarageMenu`. Toggle handler. Counter. Reuses `mkSeg`/`gItem` styles. |
| `index.html` | New `tabParts` content panel + `tabBtnParts` button. One-line CSS if needed (likely reuses `.gItem`). |
| `js/carspec.js` | **No changes.** Schema already enforces caps. |
| `tests/verify_carspec.js` | **No new cases needed** — caps already tested. Optional: add a case confirming add-beyond-16 is clamped. |

## Definition of done

1. `node dd.js test` green.
2. `node dd.js sync`.
3. **Manual:** customize → parts tab → toggle parts on/off → car updates live. Counter accurate. At 16 parts, adding refused. Removing a part with knobs and re-adding restores default knobs (empty `{}`).

## Risks

- **Stale closures:** `renderParts()` captures `workingSpec.mounts` — must mutate the array in place, never reassign. Same lesson as T4 sliders.
- **Knob loss on remove/re-add:** removing a part loses its knobs; re-adding gives `{}`. Acceptable for v1 (presets re-seed defaults; players re-tune).
- **MAX_PARTS=16 vs catalog=16:** the cap exactly equals the catalog size, so a player CAN mount everything. That's fine — it's the documented budget. If perf suffers, lower MAX_PARTS (normalize enforces).

## Open questions for Tibba

1. **Per-part rename?** No for v1 (parts are typed, not named). Confirm.
2. **Duplicate mounts?** Allow (e.g., two `lightBar`s)? Spec says remove-first; presets never duplicate. Confirm or enforce uniqueness in normalize.
3. **Edit button target?** Spec routes all knobbed parts to the `wings` tab. Alternative: a per-part knob panel. Confirm routing.
