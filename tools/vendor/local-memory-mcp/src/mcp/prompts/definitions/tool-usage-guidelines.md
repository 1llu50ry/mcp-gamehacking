---
name: tool-usage-guidelines
description: Tool usage standards & data integrity.
arguments: []
agent: System Architect
---

## Tool Usage Standards

Navigate with compact lists, hydrate only selected records, mutate through dedicated create/update tools.

**Memory**: navigate (agent-context/memory-recap/memory-search) → hydrate (memory-detail) → store (memory-store/decision-log) → maintain (memory-update) → acknowledge (memory-acknowledge).

**Standards**: standard-search MANDATORY before code edit/test/refactor/migrate → standard-store (1 rule/entry).

**Handoffs/Claims**: handoff-list → handoff-create (unfinished work only) / task-claim → handoff-update (accepted|rejected|expired).

For detailed FSM execution, load the `tool-usage-guidelines` skill.
