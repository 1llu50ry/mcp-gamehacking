---
name: review-and-audit
description: Audit documentation against implementation; generate local tasks for gaps.
arguments:
  - name: target
    description: Module, feature, or component to audit.
    required: false
agent: Quality Auditor
---

## Review and Audit

Sequential discovery: docs → code → UI. Pre-task analysis: agent-context + memory-search + standard-search + handoff-list + task-list dedup. Design atomic tasks (strict description format). Create via task-create + log decisions. Verify count matches gap count.

Forbidden: NO code/edit/delete — MCP tools ONLY. Description format: Context & Analysis / Step & Implementation / Acceptance & Verification.

For detailed FSM execution (S0→S4 with guards), load the `review-audit` skill.

Target: {{target}}
