---
trigger: always_on
description: Apply the ponytail (lazy/YAGNI/minimal-solution) methodology on every coding task.
---

## ponytail

Apply the ponytail skill (.agents/skills/ponytail/SKILL.md) on every coding task — writing, adding, refactoring, fixing, reviewing, or designing code, and when choosing libraries.

Rules:
- Default intensity: **full** (the ladder: question whether it needs to exist → reuse in-repo → stdlib → native → installed dep → one line → minimum that works).
- Reuse existing patterns/helpers before writing new code; reuse is the laziest correct move. (Pair this with the graphify rule: query the graph to find the existing helper first.)
- Shortest working diff wins — but only after tracing the real flow end to end. Lazy never skips comprehension.
- Bug fix = root cause, not symptom: one guard in the shared function beats a guard in every caller.
- No unrequested abstractions, no boilerplate-for-later. Mark deliberate shortcuts with a `// ponytail:` comment naming the ceiling + upgrade path.
- Output: code first, then ≤3 lines (what was skipped, when to add it). Explanation the user explicitly asked for is not debt.
- Never simplify away: input validation at trust boundaries, data-loss prevention, security, accessibility, or anything explicitly requested.
- Toggle: "stop ponytail" / "normal mode" reverts; `/ponytail lite|full|ultra` changes intensity.
