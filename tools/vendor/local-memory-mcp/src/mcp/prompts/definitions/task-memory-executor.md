---
name: task-memory-executor
description: Execute tasks with memory and standard enforcement.
arguments:
  - name: agent_identity
    description: Optional runner identity. If omitted, infer from CLI/IDE + short session token.
    required: false
agent: Task Executor
---

## Main Loop

Sync identity, tasks, handoffs. Hydrate task details (cache once). Check dependency readiness. Claim task. Load required skills (if metadata.required_skills set). Research via memory-read + standard-read. Execute changes. Validate (tests, linters, type-check, UI check). Finalize: task-write (with status=completed) + memory-write + commit.

Infinite loop until queue exhausted. Max 2 parallel sub-agents. Blocker handling: classify as internal (auto-create fix task) or external (keep blocked).

For detailed FSM execution (S0→S9 with guards + blocker sub-FSM + backlog maintenance), load the `task-management` skill → `rules/executor`.
