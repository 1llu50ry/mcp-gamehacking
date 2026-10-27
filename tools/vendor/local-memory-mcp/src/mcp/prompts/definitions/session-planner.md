---
name: session-planner
description: Break objective into atomic tasks.
arguments:
  - name: objective
    description: High-level session goal.
    required: true
agent: Strategy Lead
---

## Session Planner

Orient via agent-context/task-list/standard-search/handoff-list. Break into 3-7 atomic verifiable tasks. Phase into research / implementation / validation. Assign hierarchy (parent_id + depends_on) + priority (1-5). Create via task-create. Display plan to user.

For detailed FSM execution (S0→S6 with guards), load the `session-planner` skill.

Objective: {{objective}}
