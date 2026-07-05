# DRIFTDREAM — Developer Agent Guidelines

These rules govern all modifications to the DRIFTDREAM codebase. Follow them strictly to maintain determinism, performance, and cross-platform compatibility.

---

## 0. Graphify-First Navigation (do this before any code task)

This workspace ships a pre-computed knowledge graph at `graphify-out/graph.json` (warm index) summarized in `graphify-out/GRAPH_REPORT.md`. It is the source of truth for module layout, dependencies, and file relationships — use it instead of scanning the tree.

- **Query before you touch code:** Before any refactor or behavior change, run `graphify query "<intent>"` (CLI) or `query_graph` (MCP) to verify dependencies and architectural blast radius. Use `graphify path "<A>" "<B>"` / `shortest_path` for relationships between two nodes, and `graphify explain "<concept>"` / `get_node` for a focused subgraph around one concept.
- **No sequential scanning:** Do not glob, grep, or read files to "explore" the project. Pinpoint the exact target node via the graph first, then read only that code slice.
- **Broad-review fallback:** Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review, or when query/path/explain don't surface enough context. Never dump `graph.json` wholesale into context.
- **Coexistence protocol:** Do not edit `graphify-out/` directly — the post-commit git hook patches the graph asynchronously. After modifying code files this session, run `graphify update .` to keep the graph current (AST-only, no API cost).

---

## 0b. Ponytail — Lazy / YAGNI (on every coding task)

Apply the ponytail methodology (`.agents/skills/ponytail/SKILL.md`) on every coding task. Default intensity **full**. This pairs with section 0: graphify finds the existing helper, ponytail says reuse it instead of rewriting.

- **The ladder (stop at the first rung that holds):** Does this need to exist? → Already in this codebase? → Stdlib? → Native platform feature? → Already-installed dependency? → One line? → Then the minimum that works.
- **Shortest working diff wins** — but only after tracing the real flow end to end. Lazy shortens the solution, never the comprehension.
- **Bug fix = root cause, not symptom.** One guard in the shared function beats a guard in every caller.
- **No unrequested abstractions, no boilerplate-for-later.** Mark deliberate shortcuts with a `// ponytail:` comment naming the ceiling and the upgrade path.
- **Output:** code first, then ≤3 lines (what was skipped, when to add it). Explanation you explicitly asked for is not debt.
- **Never simplify away:** input validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything explicitly requested.
- **Toggle:** "stop ponytail" / "normal mode" reverts; `/ponytail lite|full|ultra` changes intensity.

---

## 0c. Caveman — Ultra-Terse Replies (on every response)

Apply the caveman communication style (`.agents/skills/caveman/SKILL.md`) on every reply. Default intensity **full**. Goal: compress communication tokens, keep full technical accuracy. Pairs with ponytail (0b): ponytail shrinks the *code/diff*, caveman shrinks the *prose around it*.

- **Drop:** articles (a/an/the), filler (just/really/basically), pleasantries, hedging. Fragments OK. Short synonyms.
- **Keep verbatim:** code blocks, API names, CLI commands, commit keywords (feat/fix/...), exact error strings, technical terms.
- **No invented abbreviations** (cfg/impl/req/res/fn) — tokenizer splits them same as the full word, so zero tokens saved and harder to read. No causal arrows (→).
- **No self-reference.** Never announce the style ("caveman mode on"). No tool-call narration, no decorative tables/emoji, no raw error-log dumps unless asked.
- **Pattern:** `[thing] [action] [reason]. [next step].`
- **Auto-clarity drop:** revert to normal for security warnings, irreversible-action confirmations, multi-step sequences where fragment order risks misread, or when compression creates technical ambiguity. Resume caveman after.
- **Boundaries:** code, commits, and PRs written normal. Toggle: "stop caveman" / "normal mode" reverts; `/caveman lite|full|ultra|wenyan-*` changes intensity.

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
