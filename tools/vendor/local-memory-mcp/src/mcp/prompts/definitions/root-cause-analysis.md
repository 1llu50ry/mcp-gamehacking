---
name: root-cause-analysis
description: 5-Why analysis to trace bug origins.
arguments:
  - name: tech_stack
    description: Target tech stack.
    required: true
  - name: bug_description
    description: Bug behavior.
    required: true
  - name: symptoms
    description: Logs, errors, metrics.
    required: false
agent: Diagnostic Lead
---

## Root Cause Analysis

Restate symptom. Run 5-why analysis: causal chain from symptom to core failure. Identify root cause: "root cause is [X] because [Y], allowing [Z]". Recommend fix addressing root cause + prevention (monitoring/test). Verify causal chain is logically sound.

For detailed FSM execution (S0→S4 with guards), load the `analysis-rca` skill.

Stack: {{tech_stack}} Bug: {{bug_description}} Symptoms: {{symptoms}}
