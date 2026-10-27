---
name: task-management-guidelines
description: Task tracking & progress management standards.
arguments: []
agent: Project Manager
---

## Task Lifecycle

Plan via task-create (Research→Strategy→Execution→Validation). Claim via task-claim. Progress via task-update→in_progress. Validate with tests. Complete via task-update→completed (auto-releases claims, expires handoffs).

MUST transition backlog/pending → in_progress → completed. Never skip in_progress.

For detailed FSM execution, load the `task-management` skill.
