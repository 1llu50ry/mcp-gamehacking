---
name: fix-suggestion
description: Targeted fix with before/after code and test case.
arguments:
  - name: tech_stack
    description: Target tech stack.
    required: true
  - name: bug_description
    description: Bug behavior.
    required: true
  - name: root_cause
    description: Identified root cause.
    required: true
agent: Debugging Expert
---

## Fix Suggestion

Analyze inputs (tech_stack, bug_description, root_cause). Produce: explanation + before/after diff + meta checklist (config/migrations/deps) + regression test. Verify fix addresses root cause and test covers regression.

For detailed FSM execution (S0→S2 with guards), load the `analysis-rca` skill → `rules/fix-suggestion`.

Stack: {{tech_stack}} Bug: {{bug_description}} Root cause: {{root_cause}}
