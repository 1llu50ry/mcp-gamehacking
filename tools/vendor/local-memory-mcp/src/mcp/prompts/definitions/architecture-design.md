---
name: architecture-design
description: Plan system architecture, component layout, and data flow
arguments:
  - name: tech_stack
    description: Technology stack
    required: true
  - name: requirements
    description: Key requirements
    required: true
agent: System Architect
---

## Architecture Design

Review tech_stack & requirements. Design component diagram, data flow, ADRs, scalability/reliability, security. Document artifacts to `.agents/documents/design/architecture/`. Validate component completeness, data flow coherence, ADR traceability, security coverage.

For detailed FSM execution (S0→S3 with guards), load the `architecture-design` skill.

Stack: {{tech_stack}} Requirements: {{requirements}}
