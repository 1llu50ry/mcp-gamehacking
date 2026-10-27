# Business Requirements Document (BRD)

## Project Overview

`@vheins/local-memory-mcp` solves the problem of "context amnesia" in AI coding assistants by providing a local, high-performance semantic memory and task orchestration server with multi-agent coordination, coding standards, knowledge graphs, and a visualization dashboard.

## Business Objectives

- **Context Retention**: Increase agent efficiency by reducing redundant information gathering across sessions.
- **Agent Safety**: Prevent developmental hallucination by enforcing a structured task state machine and providing conflict detection on memory stores.
- **Auditability**: Provide human-readable activity trails for all agent interactions via `action_log`.
- **Multi-Agent Coordination**: Enable structured handoffs and task claims between multiple AI agents working on the same repository.
- **Privacy Assurance**: 100% local processing compliance with high-security environments — no data ever leaves the machine.
- **Knowledge Management**: Store, retrieve, synthesize, and decay project knowledge automatically.

## Stakeholders

- **AI Agents**: Primary consumers of the memory, task, standard, and coordination tools.
- **Software Engineers**: Owners of the local context and primary users of the Dashboard UI.
- **System Auditors**: Individuals or systems needing to verify the chain of reasoning via the Activity Log and action_log table.
- **Project Managers**: Users tracking task completion metrics and token usage analytics.

## Scope of Work

- Implementation of a persistent MCP-compliant server with SQLite persistence.
- Web-based Dashboard (Svelte 5) for visual inspection and management.
- Hybrid search engine (TF-IDF + ONNX vector embeddings).
- 6-state task lifecycle management with transition safety and token budgeting.
- Coding standards management with vector search.
- Knowledge Graph with NLP-based auto-extraction.
- Multi-agent coordination (handoffs, claims).
- Automated knowledge synthesis protocols via client sampling.
- Soul Maintenance (automatic memory decay and archival).

## Key Metrics

- **Memory Recall Rate**: Ratio of acknowledged uses to retrievals.
- **Task Completion Rate**: Tasks completed vs. tasks created per time period.
- **Token Efficiency**: Actual tokens used per task (via `est_tokens`).
- **Query Latency**: < 50ms for databases with thousands of entries.

## Traceability (BRD → Spec → API / Design / Operations)

| BRD objective / scope item        | FSD / PRD                                                                                                                                                                      | API / Design / Operations                                                                                                                                |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context Retention (hybrid search) | [FSD §1 Knowledge Management](../fsd/core-features.md#1-knowledge-management-memory), [PRD Must Have hybrid persistence](../prd/local-memory-mcp.md#must-have-all-implemented) | [API codebase-index](../../application/api/codebase-index/api-codebase.md), [Design Architecture](../../design/architecture/architecture.md#3-data-flow) |
| Agent Safety (task state machine) | [FSD §2 Task Management](../fsd/core-features.md#2-task-management)                                                                                                            | [Design Architecture](../../design/architecture/architecture.md), [DB schema](../../design/database/schema.md)                                           |
| Auditability (`action_log`)       | [FSD §8 Activity Audit](../fsd/core-features.md#8-activity-audit), [PRD NFR Traceability](../prd/local-memory-mcp.md#non-functional-requirements-nfrs)                         | [Operations runbook](../../application/modules/codebase-index/runbook.md#7-monitoring)                                                                   |
| Multi-Agent Coordination          | [FSD §2 Coordination](../../design/architecture/architecture.md), [PRD Must Have handoffs/claims](../prd/local-memory-mcp.md#must-have-all-implemented)                        | [Design Architecture](../../design/architecture/architecture.md#3-data-flow)                                                                             |
| Privacy (100% local)              | [PRD NFR Privacy](../prd/local-memory-mcp.md#non-functional-requirements-nfrs)                                                                                                 | [Design decisions ADR-001](../../design/decisions/adr-001-use-sqlite.md)                                                                                 |
| Knowledge Management & KG         | [FSD §4 Knowledge Graph](../fsd/core-features.md#4-knowledge-graph)                                                                                                            | [Design Architecture §6 KG](../../design/architecture/architecture.md#6-knowledge-graph-architecture)                                                    |
| Dashboard (Svelte 5)              | [FSD §7 Dashboard UI](../fsd/core-features.md#7-dashboard-ui), [PRD Should Have](../prd/local-memory-mcp.md#should-have-all-implemented)                                       | [Design UI](../../design/ui/)                                                                                                                            |
| Soul Maintenance                  | [FSD §9](../fsd/core-features.md#9-memory-lifecycle-soul-maintenance)                                                                                                          | [Design Architecture §5](../../design/architecture/architecture.md#5-soul-maintenance-memory-decay)                                                      |
