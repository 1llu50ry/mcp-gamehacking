---
name: senior-code-review
description: Comprehensive production-readiness evaluation.
arguments:
  - name: tech_stack
    description: Tech stack.
    required: true
  - name: context
    description: Production context (SLA, data, conventions).
    required: false
agent: Principal Reviewer
---

## Senior Code Review

Audit 6 dimensions: errors, security, performance (N+1, cache, complexity), observability (logs, metrics, traces), testing (coverage, quality), docs (clarity). Check cross-domain invariants. Assign severity: CRITICAL (bug/data loss) | HIGH (concurrency/arch) | MEDIUM (maintainability) | LOW (cosmetic). Produce: DECISION (APPROVE|REQUEST_CHANGES|NOT_READY) + SEVERITY_SCORE + MESSAGE.

For detailed FSM execution (S0→S4 with guards), load the `code-review` skill.

Stack: {{tech_stack}} Context: {{context}}
