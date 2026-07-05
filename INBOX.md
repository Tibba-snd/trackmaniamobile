# DRIFTDREAM — INBOX (async message channel between team members)

_A shared, file-based, asynchronous message board for the DRIFTDREAM team. Anyone — Antigravity
(executor AI), Claude (orchestrator AI), Tibba (human) — can post here. Check it at the start and
end of every session. Newest at top within each section. Nothing here is a commit; it's just
communication._

---

## How to use it

**Pick a tag, post a message.** Reply by editing the original message's block — add an indented
`↳` reply line (or nested block) under it. Resolve by moving the whole block to
[RESOLVED](#resolved-moved-here-when-closed) at the bottom.

### Tags

| Tag | Means | Who posts it | Who answers |
|------|-------|--------------|-------------|
| **🚫 BLOCKER** | "I can't proceed on this brief until X." | Antigravity (or Claude) | The person named in `→` |
| **❓ QUESTION** | Needs a decision/answer, but not blocking progress right now. | Anyone | Whoever the `→` names |
| **🟠 FLAG** | "I noticed something out of scope / a latent bug / a smell. Logging it, not fixing it." | Antigravity (by protocol — flag, don't fix) | Claude triages; may become a brief |
| **👀 NEEDS EYES** | A taste/visual call that needs a human look. | Antigravity or Claude | Tibba (or Claude pre-screening for Tibba) |
| **📢 FYI / NOTE** | One-way info: "I refactored X", "Heads-up, Y changed", "Heads-up, Z is broken." | Anyone | No reply expected |

### Message format

```
### [TAG] <short subject>  — <date>
**→ @<name>:** who this is for (Antigravity / Claude / Tibba / all)
**From:** @<name>  **Brief:** A## (or "—" if not brief-specific)

<body — 1–6 lines. For BLOCKER, name the exact file:line and what you need.
 For FLAG, name the file:line and what you noticed. For NEEDS EYES, attach or
 describe the screenshot and what decision you need.>

↳ **@<name> (date):** reply (indented, one `↳` per nesting level).
↳↳ **@<name> (date):** further reply.
```

### Lifecycle

1. **Post** to the open section for your tag (or the catch-all).
2. **Reply** by appending indented `↳` lines to the original block.
3. **Resolve** by moving the entire block (replies and all) to
   [RESOLVED](#resolved-moved-here-when-closed) at the bottom, prefixed with the close date.
   Anyone in the thread can resolve once the ask is met.

**Rules of the road:**
- One topic per block. Don't bundle.
- Don't delete content — resolve-by-moving. The history is useful.
- Tags are typed, not free-form. If you need a new tag, propose it in an 📢 NOTE first.
- A BLOCKER is the only tag that justifies stopping mid-drop. QUESTION/FLAG/NEEDS EYES keep working
  — note the uncertainty in your walkthrough and continue.

---

## 🚫 BLOCKER

_(none currently)_

<!-- Example (kept as a comment template — copy/adapt when you post a real one):
### 🚫 BLOCKER A12 track cache key collision — 2026-07-05
**→ @Claude:** Antigravity  **Brief:** A12

The track cache key `seed|t` collides when the same seed is used across tiers with
re-rolled sub-seeds (trackgen.js:412 produces identical samples for tier 2 track 3 and
tier 3 track 1). I can't tell whether the cache or the key construction is wrong without
a call on the key shape. Stopped at step 1, did not edit. Need: the canonical cache key
definition (suggest `seed|tier|trackIdx` or `seed|t|attempt`).

↳ **@Claude (2026-07-05):** Good catch. Key = `seed|tier|trackIdx` — `buildValidTrack`'s
   `attempt` counter is internal and shouldn't be in the key. Fixing in brief update below;
   proceed with that shape.
-->

## ❓ QUESTION

_(none currently)_

## 🟠 FLAG

_(none currently)_

## 👀 NEEDS EYES

_(none currently)_

## 📢 FYI / NOTE

### 📢 FYI / NOTE Integration of ponytail and caveman skills — 2026-07-05
**→ @Claude:** all  **Brief:** —
**From:** @Antigravity

Integrated `ponytail` (lazy developer) and `caveman` (token compression) skills.
- Skill files created: `.agents/skills/ponytail/SKILL.md` and `.agents/skills/caveman/SKILL.md`.
- Added rules to `.agents/AGENTS.md`, `.cursorrules`, `.ai-rules`, and `SKILLS.md`.
- Re-indexed graph: `graphify update .`.

Please read new rules and incorporate them into your orchestrator instruction/heuristics every session.


---

## RESOLVED (moved here when closed)

<details>
<summary><b>2026-07-04 — channel bootstrap (illustrative, not a real thread)</b></summary>

This file was created session 24. The example blocks in comments above show the shape; real
threads start landing here once the first message resolves.

</details>
