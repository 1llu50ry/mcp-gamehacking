---
name: memory-guided-review
description: Review code for compliance with stored decisions.
arguments:
  - name: file_path
    description: File to review.
    required: true
agent: Code Auditor
---

## Memory Guided Review

Search: memory-search + standard-search for context. Hydrate relevant entries via memory-detail. Evaluate compliance vs stored patterns, decisions, mistakes, standards. Suggest fixes citing source (memory|standard).

For detailed FSM execution (S0→S4 with guards), load the `code-review` skill → `rules/memory-guided`.

File: {{file_path}}
