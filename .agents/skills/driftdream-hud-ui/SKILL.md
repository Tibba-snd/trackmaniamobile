---
name: driftdream-hud-ui
description: Handles DOM overlay interfaces, settings persistence, input mappings (keyboard/touch/tilt), HUD telemetry cards, odometer animations, and biome CSS custom variables.
---

# DRIFTDREAM HUD and UI System

This skill covers the game's menu interfaces, HUD overlays, control bindings, and visual telemetry responses.

## File Map
- **HUD & UI Layout / Style:** `index.html` → DOM structure, styling classes, fonts (Azeret Mono, Chakra Petch), and key animations (skew transitions, flashes).
- **HUD & UI Binding / State Loop:** `js/game.js` → `DD.boot()`, UI panel transitions (`showScreen`), text scrambling animations (`dialInText`), continuous delta ribbon calculations, and the checkpoint sector flash.
- **Dynamic Accent Colors:** `js/theme.js` & `js/game.js` → maps generated biome accent colors to CSS custom properties (`--accent`, `--accent2`, `--warm`).
- **Input Mappings:** `js/input.js` → event bindings for Keyboard, device tilt (analog steering, ±22°), and Touch pads.

## Technical Details

### 1. HUD Animations and Visual Cues
- **Entry Streaks:** When entering a race or restarting, HUD cards (`#hudLeftBox`, `#hudMedals`, `#hudSpeedBox`) slide into place from screen margins with high-speed skewing translations (`streak-in`) relative to travel direction.
- **Odometer Digit Roll:** Speed updates and timer seconds ticks apply a brief vertical bounce and sub-pixel blur animation (`.digit-change`) to the numbers to simulate mechanical split-flap dials.
- **Segmented LED RPM & Shift Light:** The RPM bar uses a slanted repeating gradient mask. A neon red `SHIFT` indicator blinks above the gear glyph near redline.
- **Continuous Delta Ribbon:** Measures the player's live time against the PB ghost times and renders a continuous green (ahead, left-sided) or red (behind, right-sided) ribbon (`#hudDeltaRibbon`) below the timer.
- **RPM Breathing Glow:** Syncs `#hudSpeedBox` border color alpha and shadow glow intensity (`--rpm-glow-opacity`) to the engine RPM, breathing faster at higher RPMs.
- **Checkpoint Sector Flashes:** Crossing a checkpoint ahead of the PB ghost triggers a purple sector flash (`.purple-flash`) on `#hudLeftBox`. Beating the PB at the final checkpoint before finish displays a centered "FINAL SECTOR" alert.
- **PB Celebration:** Beating the personal best triggers a white-to-accent overlay flash animation (`pb-flash-overlay`) and runs a rotating border gradient color animation (`gold-glow-flicker`) around the finish stats card.

### 2. Input Modes
- **Keyboard:** Standard arrow keys/WASD, Space for drift, R to restart, E to respawn. Always active.
- **Touch Layout:** Steering buttons (◀ ▶) are on the left thumb; GAS, BRAKE, and DRIFT pads are on the right thumb. Touch steering is binary (`±1`).
- **Tilt Layout:** Device orientation controls steering (analog, ±22° = full lock), calibrated to a neutral captured on race start.

## Rules & Gotchas
- **No Pseudo-Element CSS Transitions:** Never use CSS transitions on pseudo-elements (like `::before`/`::after`) as it freezes on Chromium/WebView engines on Android.
- **Z-Index:** Ensure `#gameButtons` (restart/respawn/exit) are offset below `#hudLeftBox` so their icons don't overlap the live timer.
