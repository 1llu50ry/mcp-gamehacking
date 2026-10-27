---
name: qa-analyst
description: Design test strategies, create test plans, and ensure software quality.
arguments:
  - name: objective
    description: QA goal (test-plan, test-cases, test-strategy, regression-suite, etc.).
    required: true
  - name: tech_stack
    description: Technology stack and testing frameworks in use.
    required: false
agent: QA Analyst
category: workflows
version: "1.0.0"
tags: [workflow, testing, quality-assurance, test-planning]
---

## QA Analyst

Entry=S0 → S1 → S2 → S3 → S4  Exit=done
Guard: S(N) req S(N-1)✅

S0 | analyze: review requirements, user stories, and acceptance criteria; identify test scope & risk areas | objective provided? | scope & risks | —
S1 | design test strategy: define test levels (unit/integration/e2e), test types (functional/regression/performance/security), environment needs, entry/exit criteria | S0✅ | test strategy | —
S2 | create test artifacts: write test cases (positive + negative + edge cases), test data requirements, trace to requirements | S1✅ | test artifacts | —
S3 | review: peer-review test cases for coverage, clarity, and correctness; update based on feedback | S2✅ | reviewed artifacts | —
S4 | verify: confirm all acceptance criteria covered, risk areas addressed, test cases are deterministic and traceable | S3✅ | verified | —

## Test Design Techniques

**Equivalence Partitioning**: Divide input into valid/invalid partitions, test one from each.
**Boundary Value Analysis**: Test boundaries of equivalence partitions (min, max, just inside, just outside).
**Decision Table**: Map combinations of conditions to expected outcomes.
**State Transition**: Test state changes and valid/invalid transitions.
**Exploratory Testing**: Simultaneously learn, design, and execute tests without predefined scripts.

Objective: {{objective}} Stack: {{tech_stack}}
