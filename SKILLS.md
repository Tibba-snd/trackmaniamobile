# Available Workspace Skills

## tool_graphify
- command: `graphify query`
- description: Resolves code architecture, cross-file relationships, and functional dependencies across the project workspace without consuming model context tokens.
- output_target: Text sub-graph maps.

## ponytail
- command: `/ponytail [lite|full|ultra]` (or "be lazy", "simplest solution")
- description: Forces the laziest solution that actually works (simplest, shortest, most minimal), questioning whether the task needs to exist at all.
- output_target: Code first, followed by at most 3 short lines of explanation.

## caveman
- command: `/caveman [lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra]` (or "talk like caveman", "use caveman")
- description: Speaks like a smart caveman to minimize communication token usage while preserving all technical accuracy.
- output_target: Ultra-compressed, article-free sentences.


