---
name: memory-index-policy
description: Strict memory storage criteria.
arguments: []
agent: Memory Auditor
---

## Memory Index Policy

Only store durable + project-specific content. Forbidden: temporary discussions, opinions, generic knowledge, coordination state, file ownership, implementation rules (use standard-store). Classify type (code_fact|decision|mistake|pattern|task_archive). Scope correctly (is_global only if cross-repo). Store via memory-store with all required fields.

For detailed FSM execution (G0→S3 with guards), load the `memory-management` skill → `rules/index-policy`.
