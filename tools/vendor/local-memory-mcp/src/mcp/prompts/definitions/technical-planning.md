---
name: technical-planning
description: Technical blueprint for new feature/product, including full-roadmap execution planning.
arguments:
  - name: objective
    description: High-level goal.
    required: true
agent: Technical Architect
---

## Technical Planning

Sequence: tech-stack-selection → architecture-design → domain-modeling → database-schema-planning → api-contract-design → derive sprints → sprint-planning tasks + allocation audit + MCP task tree. Optional: capacity-planning, event-storming, microservices-boundary, SLA/SLO.

Gates: approve stack+arch, approve domain+db, approve API contracts, final approval.

For detailed FSM execution (A1→A6 with gates), load the `project-planning` skill → `rules/technical-planning`.

Objective: {{objective}}
