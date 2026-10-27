# User Stories: Task Management

**Feature:** Stateful Task Lifecycle Management via MCP


## 1. Goal Tracking

- **As an** AI agent, **I want** to use `task-create` to register a new development objective, **so that** my work is explicitly tracked on the global Kanban board.

## 2. Safeguarded Progress

- **As a** Lead Developer, **I want** the system to prevent an agent from moving a task directly from `pending` to `completed`, **so that** it is forced to acknowledge the `in_progress` state during execution.

## 3. Transparent Delivery

- **As a** Project Manager, **I want** every completed task to include an estimate of actual tokens used (`est_tokens`), **so that** I can monitor the resource impact of different features.

## 4. Guided Creation

- **As a** Developer, **I want** the agent to use `task-create-interactive` with elicitation when I provide vague directives, **so that** my tasks always have the necessary metadata before starting.

## 5. Audit Visibility

- **As a** System Auditor, **I want** all status transitions to include a mandatory comment, **so that** there is a logged reason for every change in task state.

## 6. Multi-Agent Coordination

- **As a** Project Manager, **I want** agents to be able to claim tasks and hand off context to other agents, **so that** work can be distributed across multiple AI assistants without duplication.

## 7. Task Hierarchy

- **As a** Technical Lead, **I want** tasks to support parent-child relationships (`parent_id`), **so that** complex features can be decomposed into sub-tasks.

## 8. Auto-Archiving

- **As a** Developer, **I want** completed tasks to be automatically archived as searchable memories, **so that** the rationale and approach are preserved for future reference.
