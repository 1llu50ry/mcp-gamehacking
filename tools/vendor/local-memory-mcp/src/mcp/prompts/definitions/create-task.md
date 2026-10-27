---
name: create-task
description: Create structured, atomic tasks in Local Memory MCP.
arguments:
  - name: instruction
    description: Directive to analyze and break into tasks. Derived from active task/pending handoff/recent conversation if omitted.
    required: false
agent: Task Planner
---

## Create Task

Pre-analysis: memory-search + standard-search + handoff-list + task-list dedup. Design atomic tasks (1 logical change, layered, context, min 1 pos+1 neg test). Assign attributes (task_code optional — auto-gen TASK-xxx, phase, priority 1-5). Create via task-create + log decisions.

Forbidden: NO code/edit/delete — MCP tools ONLY.

Description format:

### 1. Context & Analysis

- **Trigger**: finding.
- **Observation**: reasoning.
- **Goal**: objective.

### 2. Step & Implementation

### 3. Acceptance & Verification

For detailed FSM execution (S0→S4 with guards), load the `create-task` skill.

Analyze: {{instruction}}
