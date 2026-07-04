---
name: driftdream-physics-bot
description: Handles the 60Hz deterministic two-axle vehicle physics (grip/slide regimes, gear shifting, collisions) and the curvature-aware bot player.
---

# DRIFTDREAM Vehicle Physics and AI Bot

This skill covers the car's physical model, tire simulation, collision handling, and the headless bot player. The entire physics module is completely independent of Three.js.

## File Map
- **Physics Core:** `js/physics.js` → `DD.PHYS` (tuning table), `DD.createCar()`, `DD.stepCar()`, `updateGear()`, surface checks, and collision/wall reflections.
- **Headless Bot:** `js/physics.js` → `DD.getBotInput()`, `DD.runBot()`, and checkpoint time/medal calculations.

## Technical Details

### 1. Timestep and Simulation
- Simulation ticks at a **fixed 1/60 Hz** (`DD.TICK`).
- The game loop performs up to **4 substeps** per frame to catch up with real time, with a spiral-of-death guard that drops the accumulator if frame rate drops excessively.

### 2. Vehicle Model (Two-axle Slip Model)
The car uses front-wheel steering and rear-wheel drive, with two distinct modes:
- **Grip Regime:** Default mode. Bypasses complex slip math by capping yaw rate and tire lateral forces. Ensures that players don't spin out under normal throttle.
- **Slide (Drift) Regime:** Entered on drift button tap, handbrake tap, low-speed wheelspin, or low-friction surfaces (glass/ice). Uses lateral force integrations and autoself-countersteer assist to catch spinouts.
- **Auto-Countersteer:** Applies helper torque when sliding to prevent complete spinout unless the driver overrides it.

### 3. Gearbox and Engine RPM
- 6-speed gearbox. Up-shifting cuts power for `0.10s`, down-shifting cuts power for `0.26s`.
- Torque peaks at mid-high RPM. Carrying too little speed through corners bog down the engine, forcing downshifts that delay acceleration.

### 4. Surfaces (`DD.SURF`)
- **NORMAL:** Standard grip.
- **GLASS:** Frictionless ice-like surface, triggers sliding easily.
- **BOOST:** Adds high forward acceleration.
- **DIRT:** Drops grip, increases drag, reduces max acceleration.

### 5. Headless Bot & Medals
- The bot computes target speed based on road curvature, banking, downforce, and braking distances.
- It applies a drift tap when taking tight corners above 28 m/s.
- `DD.buildValidTrack` runs the bot over new tracks to verify drivability and sets medal targets:
  - **Author Medal:** `bot.ms * 0.82` (approximate human potential).
  - **Gold:** `author * 1.10`
  - **Silver:** `author * 1.25`
  - **Bronze:** `author * 1.55`

## Rules & Gotchas
- **No Floating-Point Variations:** Do not use `Math.random` or write non-deterministic formulas.
- **PHYS Tuning:** All constants are declared in `DD.PHYS` at the top of `js/physics.js`. Treat this table as the single source of truth.
- **Test Suite:** Always verify physics and handling changes against the test suite:
  ```bash
  node tests/drivability.js
  ```
