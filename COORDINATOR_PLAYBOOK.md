# Coordinator Playbook — running sessions with Antigravity

_For Tibba (and whichever Claude instance is coordinating). How to start, review, and close a drop
with Antigravity using the file-based system. Keep this next to you when you run a session._

## The 4 files that carry the context

| File | Role | Who writes it |
|------|------|---------------|
| `ANTIGRAVITY.md` | Antigravity's home — role, rules, file map, growing knowledge base. He reads it first every drop. | Claude maintains; knowledge base grows after each review. |
| `BRIEFS.md` | The task queue. One brief = one drop. | Claude specs + updates status. |
| `INBOX.md` | Async message board (BLOCKER / QUESTION / FLAG / NEEDS EYES / NOTE). | Anyone. |
| `STATUS.md` | Session-by-session review log. | Claude appends after each review. |

**The key idea:** because these files hold the context, Antigravity's boot prompt is short. You don't
paste a wall of instructions — you point him at the docs and they do the work.

---

## 1. Starting a session with Antigravity — the boot prompt

Copy-paste this (adapt the bracketed parts). That's it.

```
You're joining the DRIFTDREAM project as Antigravity (executor). Before doing anything, read these
files top-to-bottom IN THIS ORDER — they carry all the context you need:

1. ANTIGRAVITY.md  ← your home: role, project, rules, file map, KNOWLEDGE BASE (read the KB carefully,
                     it grows every review and holds the lessons from past drops)
2. INBOX.md        ← check for replies to your threads + any message addressed to you
3. BRIEFS.md       ← your task queue; the PROTOCOL + FIELD NOTES sections at the top are mandatory

Then check .agents/skills/<name>/SKILL.md for any subsystem you'll touch.

Your brief for this drop: [A11 — Impact audio fix]. Don't mix scopes — one brief per drop. Follow
the DoD in ANTIGRAVITY.md §4 exactly. Leave changes uncommitted on c4-work. When you hit a wall or
spot something out of scope, post to INBOX.md (don't sit on it). Stop when done and wait for review.
```

**Why this works:**
- The three files do the heavy lifting — your prompt is just a pointer + the brief assignment.
- The KNOWLEDGE BASE means you don't re-explain lessons he should already know.
- INBOX check at boot means any BLOCKER you (or he) posted last session gets picked up.
- Naming the specific brief keeps him from freelancing.

**When to use a shorter variant:** once Antigravity has run several drops and you trust he reads the
docs, you can drop to just: *"New drop. Read ANTIGRAVITY.md → INBOX.md → BRIEFS.md, then do [A12].
DoD per §4."* The first few sessions, use the full version.

**Antigravity has vision/hearing** — the brief's capability note tells you (and him) whether a drop
needs host Chrome, screenshots, or aural confirmation. Factor that into what you can ask for in the DoD.

---

## 2. Reviewing his drop — the checkup loop

When Antigravity signals he's done (or you pull his working tree):

1. **`git status` first** — the session-23 rule. Confirm only the expected files changed. If something
   unexpected is there, that's the first thing to ask him about.
2. **Review the `git diff`**, not his walkthrough. The walkthrough is a map; the diff is the truth.
   Check:
   - Stays inside the brief's scope? (no drive-by refactors)
   - Every changed `js/` file has a bumped `?v=` in `index.html`?
   - No `Math.random` / no new THREE light / no per-frame allocations (the invariants)?
   - No `DD.PHYS` edits unless the brief explicitly sanctioned them?
   - Closed-circuit wrap respected if he touched sample scanning?
3. **Run the suite:** `node dd.js test`. Then **launch the game** (`node dd.js serve` → `/?...`) and
   confirm it boots — green tests don't prove boot (session 21).
4. **Fix/integrate** his drop into a clean commit on `c4-work`. Standard message format:
   `<Workstream-ID>: <short description> — <root cause or outcome>` + caps-section body +
   test-count footer + cache-buster footer. Add the `Co-Authored-By` trailer if you want.
5. **Update the three growing files:**
   - `STATUS.md` — append `## Resolved this pass — <topic> (<date>, session N)`.
   - `ANTIGRAVITY.md` KNOWLEDGE BASE — append a `<details>` block (template is in the file): one
     generalizable tip, one correction, one next-time pointer. **This is what makes him smarter
     every session.**
   - `INBOX.md` — answer any BLOCKER/QUESTION he posted, triage any FLAG (→ new brief or close with
     reason), relay any NEEDS EYES to Tibba.
6. **Update `BRIEFS.md`** — flip the brief's status emoji (🔴→🟢), move it to the LANDED section.

---

## 3. Closing the session

Tell Antigravity the outcome in one line + point him at the updated knowledge base:

```
Reviewed and landed A11 in commit <sha>. Read the new KNOWLEDGE BASE entry in ANTIGRAVITY.md
(top <details> block) — [one-line summary of the tip]. [Any open FLAG/QUESTION you should watch
next drop is in INBOX.md.] Next brief: [A12].
```

That's the closed loop: brief → execute → review → tip fed back → next brief informed.

---

## 4. Cheatsheet — what each voice handles

| Situation | Goes in |
|-----------|---------|
| Antigravity can't proceed, needs a decision | INBOX 🚫 BLOCKER |
| Antigravity needs a call but can continue | INBOX ❓ QUESTION (assumption in walkthrough) |
| Antigravity spotted an out-of-scope issue | INBOX 🟠 FLAG (not fixed) |
| Visual/taste call needs Tibba | INBOX 👀 NEEDS EYES |
| "I changed X, heads up" / "Y is broken" | INBOX 📢 NOTE |
| Claude's distilled lesson after a review | ANTIGRAVITY.md KNOWLEDGE BASE |
| Session retrospective (what landed, bugs caught) | STATUS.md |
| The task queue + status emojis | BRIEFS.md |
| Project rules that don't change | ANTIGRAVITY.md §3 + .agents/AGENTS.md |

---

## 5. Troubleshooting the system itself

- **He ignored an open BLOCKER and shipped anyway** → tighten the protocol; the same way session 23's
  sweep incident produced the `git status` rule. Surface it in his next KNOWLEDGE BASE entry.
- **The knowledge base is getting long** → that's fine; `<details>` blocks collapse. Just keep
  newest on top so the freshest lesson is one click away.
- **He keeps re-asking something the docs answer** → the docs aren't emphatic enough. Add it as a
  KNOWLEDGE BASE entry (it'll self-correct) or promote it to §3 Hard Rules.
- **INBOX is going stale (threads never resolve)** → resolve-by-moving is everyone's job. If you
  notice stale open threads, ping the owner or resolve them yourself on review.
- **You want to delegate a hard brief to him** → write the full "Verified root cause (Claude, date)"
  + numbered scope yourself first, like the A11–A14 briefs. The hard structural work happens in the
  brief authoring, not in his execution. Physics stays Claude-side.
