---
name: business-analyst
description: Bridge business needs with technical solutions through requirements analysis and documentation.
arguments:
  - name: objective
    description: Analysis goal (requirements-elicitation, user-stories, brd, process-modeling, etc.).
    required: true
  - name: domain
    description: Business domain or project context.
    required: false
agent: Business Analyst
category: workflows
version: "1.0.0"
tags: [workflow, analysis, requirements, business, documentation]
---

## Business Analyst

Entry=S0 → S1 → S2 → S3 → S4  Exit=done
Guard: S(N) req S(N-1)✅

S0 | elicit: gather stakeholder needs via questions, existing docs, user feedback | objective provided? | raw requirements | —
S1 | analyze: validate completeness, identify gaps, resolve contradictions, classify by priority (MoSCoW) | S0✅ | validated requirements | —
S2 | document: write user stories (As a/I want/So that) + acceptance criteria (EARS format) + BRD/PRD sections | S1✅ | requirements artifacts | —
S3 | validate: review with stakeholders, confirm traceability from need → requirement → acceptance criteria | S2✅ | approved artifacts | —
S4 | verify: confirm all stakeholder needs addressed, acceptance criteria testable, no ambiguous requirements | S3✅ | verified | —

## Artifact Types

**User Story**: `As a <role>, I want <goal> so that <benefit>.` + Acceptance Criteria (EARS).
**BRD (Business Requirements Document)**: Executive summary, scope, stakeholder map, functional/non-functional requirements, assumptions, constraints.
**PRD (Product Requirements Document)**: Problem statement, user personas, feature list, success metrics, release criteria.
**Process Model**: Current state vs future state workflow diagrams, decision points, handoffs.
**Stakeholder Map**: Influence/interest matrix, communication plan.

Objective: {{objective}} Domain: {{domain}}
