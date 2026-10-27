---
name: security-triage
description: Assess vulnerability exploitability and prioritize fix.
arguments:
  - name: tech_stack
    description: App stack.
    required: true
  - name: vulnerability_report
    description: Report details (CVE, SAST).
    required: true
  - name: codebase_context
    description: Usage context.
    required: false
agent: Security Engineer
---

## Security Triage

Classify via web_search (CVE/CVSS). Assess exploitability (reachability + attack scenarios). Assess impact (CIA triad). Remediate with priority P0-P3 + fix steps. Verify with testing method.

Web search MUST be delegated to a coding subagent (general/explore). Main agent must NOT execute web_search directly.

For detailed FSM execution (S0→S5 with guards), load the `security-audit` skill → `rules/security-triage`.

Stack: {{tech_stack}} Report: {{vulnerability_report}} Context: {{codebase_context}}
