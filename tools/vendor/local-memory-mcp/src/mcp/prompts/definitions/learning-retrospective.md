---
name: learning-retrospective
description: Harvest knowledge from completed work.
arguments:
  - name: task_id
    description: ID of completed task.
    required: false
agent: Knowledge Harvester
---

## Learning Retrospective

Identify mistakes (bugs/quirks), decisions (trade-offs/pivots), patterns (conventions). Store via memory-store (type=mistake|decision|pattern, include tech tags, concise) or decision-log. Verify stored count matches identified items.

For detailed FSM execution (S0→S2 with guards), load the `learning-retrospective` skill.

Task: {{task_id}}
