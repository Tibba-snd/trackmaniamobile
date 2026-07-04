# DRIFTDREAM — Developer Agent Guidelines

These rules govern all modifications to the DRIFTDREAM codebase. Follow them strictly to maintain determinism, performance, and cross-platform compatibility.

---

## 1. Architectural Integrity (Three-free Split)
- **Rules:** `core.js`, `theme.js`, `trackgen.js`, and `physics.js` must remain **completely independent of Three.js**.
- **Reasoning:** These modules must run in headless Node environments for unit testing and deterministic calculations (like bot medals and race validation).
- **Mocks:** If you introduce new Three.js classes in rendering paths, ensure they are mocked or excluded from tests, or add them to the Three mock in `tests/verify_m2_features.js`.

---

## 2. Strict Determinism
- **Rules:** Never use `Math.random()` or any system time-dependent values inside track generation, theme generation, or physics.
- **Reasoning:** A given seed must produce the exact same track, colors, bot performance, and physics outcome across all platforms.
- **RNG:** Always use the seed-based Mulberry32 generator via `DD.makeRng(seed)`.

---

## 3. WebGL & Rendering Constraints
- **Point Lights:** Do not exceed a hard-capped dynamic pool of **12 PointLights** (on high quality) or **8 PointLights** (on medium quality) to keep draw calls and fill cost reasonable on mobile.
- **Glow & Emissives:** Always use emissive materials and bloom parameters for glow effects. **Never create real lights for glows.**
- **Environment Maps:** Keep the CubeCamera environment map target size small (**16**) to naturally blur specular highlights and avoid jagged edge reflections.
- **CSS Masks:** Never apply a CSS `mask` to WebGL canvas containers, as it causes browser screenshot helpers to hang.

---

## 4. Mobile & WebView Compatibility
- **CSS Transitions:** **Never apply CSS transitions to pseudo-elements** (such as `::before` or `::after`). The Chromium/System WebView on Android freezes these transitions at their start value.
- **Capacitor Sync:** Whenever editing root files in `index.html` or `js/`, you **must** synchronize the changes to the Android wrapper by running `node dd.js sync` before compiling. The Android build points to `apk-build/www/`.

---

## 5. Performance Optimizations
- **Allocations:** Avoid per-frame object allocations (like `new THREE.Matrix4()`, `new THREE.Vector3()`, or `new THREE.Color()`) in loops (`poseCar`, `updateShadow`, or `game.js:loop`). Cache reusable objects at module/file scope to prevent Garbage Collection stutter on mobile.
