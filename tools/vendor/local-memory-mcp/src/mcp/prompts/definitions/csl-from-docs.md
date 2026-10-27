---
name: csl-from-docs
description: Create atomic CSL coding standards entries from a local file or directory path.
arguments:
  - name: path
    description: Local path (file or directory) containing documentation or standards.
    required: true
agent: Documentation Processor
---

## CSL from Docs

Discover path (dir→list+read each, file→read). Extract atomic rules: 1 entry=1 rule, keep code examples, preserve source meaning. Dedup via standard-search. Store via standard-store (parent→children, context, version, is_global, metadata). Verify stored count matches extracted.

Refuse if path doesn't exist, content isn't normative, or no source-backed standards can be extracted.

For detailed FSM execution (G0→S4 with guards), load the `csl` skill.

Path: {{path}} Owner: {{current_owner}} Repo: {{current_repo}}
