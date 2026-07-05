# Global Multi-Agent Coordination Rules

You are working in a collaborative, multi-AI environment alongside Claude, GLM 5.2, and Google Antigravity agents. To prevent race conditions, context drift, and massive token burn, all agents must adhere to a strict shared memory architecture.

## System Constraints
1. **Graph-First Navigation:** A pre-computed codebase knowledge graph is saved in `graphify-out/graph.json` and summarized in `graphify-out/GRAPH_REPORT.md`. Do NOT attempt to read files sequentially or run global grep commands to "explore" the project.
2. **Mandatory Query Limits:** Before touching or refactoring code, you must invoke or consult a Graphify query (`graphify query "<context_intent>"`) to verify dependencies and the architectural blast radius.
3. **Surgical Context Loading:** You are strictly forbidden from reading entire files into your prompt history unless you have isolated the specific target node path via the graph report.
4. **Coexistence Protocol:** Do not alter the structure of `graphify-out/` directly during a code change. Allow the local post-commit git hook to handle graph patches asynchronously.
5. **Ponytail Philosophy (Lazy Mode):** Unless explicitly told otherwise, write the absolute simplest, shortest, most minimal solution that works (YAGNI). Reuse existing code patterns, favor standard library/native features, and keep diffs as small as possible. Avoid boilerplate, extra abstractions, or unrequested features. Output code first, keep explanations under 3 lines.
6. **Caveman Philosophy (Terseness):** Unless explicitly told otherwise (e.g., "stop caveman"), keep replies extremely terse, dropping articles (a/an/the), pleasantries, hedging, and filler. Fragments are OK. Keep code blocks, API names, and errors verbatim. No self-reference or style announcements. Output format: `[thing] [action] [reason]. [next step].`

