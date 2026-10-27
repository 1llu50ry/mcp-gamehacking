---
name: review-and-post-issue
description: Audit documentation against implementation; generate GitHub issues for gaps.
arguments:
  - name: owner
    description: "GitHub repo owner. (hint: run `git remote -v` to extract from origin URL)"
    required: true
  - name: repo
    description: "GitHub repo name. (hint: run `git remote -v` to extract from origin URL)"
    required: true
  - name: target
    description: Module, feature, or component to audit.
    required: false
agent: Quality Auditor
---

## Review and Post Issue

Sequential discovery: docs → code → UI. Pre-issue analysis: agent-context + memory-search + search_issues dedup. Design issues (atomic, strict body format, labels). Create via issue_write. Verify issue count matches gap count.

Forbidden: NO code/edit/delete — GitHub+MCP tools ONLY. Issue body format: Context & Analysis / Step & Implementation / Acceptance & Verification.

For detailed FSM execution (S0→S4 with guards), load the `review-audit` skill → `rules/audit`.
