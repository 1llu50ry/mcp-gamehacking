# Functional Specification Document (FSD)


This document specifies the functional behavior of the `@vheins/local-memory-mcp` application.

## 1. Knowledge Management (Memory)

- **Description**: Provides storage, retrieval, and synthesis of semantic context snippets and behavioral patterns.
- **Key Tools**:
  - `memory-store`: Store a new knowledge entry with collision detection and supersedes support.
  - `memory-search`: NAVIGATION LAYER — returns pointer table of matching IDs with hybrid search.
  - `memory-synthesize`: Advanced reasoning tool using client sampling to synthesize grounded answers.
  - `memory-detail`: Fetch full content and metadata for a specific memory by ID or short code.
  - `memory-acknowledge`: (MANDATORY) Acknowledge memory as used/irrelevant/contradictory after code gen.
  - `memory-update`: Update an existing memory entry (fields: status, importance, title, content, metadata).
  - `memory-delete`: Soft-delete one or more memory entries (single `id` or bulk `ids`).
  - `memory-summarize`: Update the high-level global summary for a repository.
  - `memory-recap`: AGGREGATED OVERVIEW — stats by type + top memories pointer table.
- **Upstream Aliases** _(LEGACY DESIGN INTENT — NOT IMPLEMENTED, verified 2026-08-08; no alias tools shipped — use the canonical tools above)_: `remember_fact` → `memory-store`, `remember_facts` → bulk store, `recall` → `memory-search`, `forget` → `memory-delete`.
- **Rules**:
  - Collision detection at similarity > 0.55.
  - Supersedes versioning: old memories archived when superseded.
  - Importance must be 1-5.
  - Soul Maintenance: automatic decay after 7 days inactivity.

## 2. Task Management

- **Description**: Tracks agent progress through a structured 6-state lifecycle with strict transition rules.
- **Key Tools**:
  - `task-list`: PRIMARY navigation — tabular list with status/phase/query filters.
  - `task-create`: Register one or more tasks (single or bulk via `tasks` array).
  - `task-create-interactive`: Guided creation via elicitation for missing fields.
  - `task-detail`: Fetch full description, phase, priority, and comments for a task.
  - `task-update`: Update task(s) with transition validation. Supports `id`/`task_code`/`ids`/`task_codes`.
  - `task-delete`: Hard deletion of task records (single `id` or bulk `ids`).
  - `task-search`: Dedicated search by title or task_code.
- **Statuses**: `backlog`, `pending`, `in_progress`, `completed`, `canceled`, `blocked`.
- **Transition Rules**:
  - Must pass through `in_progress` to reach `completed`.
  - `est_tokens` required on completion.
  - Auto-archives to task_archive memory on completion.
- **Coordination**: Claims (task-claim, claim-list, claim-release) and handoffs (handoff-create, handoff-list, handoff-update).

## 3. Coding Standards

- **Description**: Reusable coding rules stored with vector search for pre-implementation compliance checks.
- **Key Tools**: `standard-store`, `standard-search`, `standard-update`, `standard-delete`, `standard-detail`.
- **Scoping**: Per-language, per-stack, per-repo, or global.
- **Lifecycle**: `active`, `deprecated`, `superseded`.

## 4. Knowledge Graph

- **Description**: Entity-relationship-observation storage with NLP auto-extraction.
- **Key Tools**: `create-entity`, `delete-entity`, `create-relation`, `delete-relation`, `delete-observation`, `kg-backfill`.
- **Auto-Extraction**: NLP Archivist via `compromise` library runs on every `memory-store`.
- **Visualization**: Force-directed graph in the dashboard.

## 5. Agent Tools

- **`agent-context`**: Contextual recall for active session (queries memories + tasks for current agent; `GET /api/agent-context` in dashboard).
- **`prompt-read` (20th tool)** — Unified LIST / DETAIL access to the prompt catalog (`src/mcp/prompts/definitions/`, 32 prompts). LIST (no `name`) returns catalog `[{ name, description, agent, arguments }]`; DETAIL (`name` present) loads one prompt with `{{var}}` substitution via `substitution.ts` and auto-injects `{{current_owner}}`/`{{current_repo}}` from session context (read-only; no DB/lock; pure loader-cache function — `src/mcp/tools/prompt.read.ts`, `src/mcp/tools/schemas/prompt-read.ts`, `src/mcp/types/tool-definitions/prompt.ts`). Mirrors `prompts/list` + `prompts/get` for tool-only clients (e.g. opencode). Tests: `src/mcp/tests/prompt.read.test.ts` (LIST + DETAIL).
- **`decision-log`** / **`session-summarize`**: Absorbed into `memory-write` convenience modes (type=`decision` / type=`task_archive`) — ADR-007.

### Runtime profiles (`MCP_RUNTIME_PROFILE`)

`minimal` / `balanced` / `full` (default) — profile defaults are defined in `src/mcp/runtime-capabilities.ts` (`RUNTIME_PROFILES`, `RuntimeCapabilityRegistry`) and honoured by the startup/queue wiring in `src/mcp/server.ts`. See also [Operations runbook](../../application/modules/codebase-index/runbook.md#2-configuration) for the env-var table and benchmark.

## 6. Reference Catalog (Resources & Prompts)

- **Resources**:
  - `repository://{owner}/{name}/memories`: Paginated list of memories.
  - `repository://{owner}/{name}/tasks`: Paginated list of tasks.
  - `repository://{owner}/{name}/summary`: Global summary for a repository.
  - `repository://{owner}/{name}/actions`: Audit stream of agent tool actions.
  - `repository://{owner}/{name}/standards`: Coding standards for a repo.
- **Prompts**: 31 prompt templates covering engineering roles, workflows, and lifecycle management.

## 7. Dashboard UI

- **Tabs**: Dashboard (Stats), Activity (Audit), Memories (Search), Tasks (Kanban), Reference (Capability), Standards, Handoffs, Knowledge Graph.
- **Functionality**: Real-time data fetching, drag-and-drop Kanban, force-directed KG visualization.

## 8. Activity Audit

- **Requirement**: Every tool call generates an entry in `action_log`.
- **Content**: Input parameters, execution timestamp, and results summary.
- **Burst Condensation**: Identical actions within 10-minute window are condensed.

## 9. Memory Lifecycle (Soul Maintenance)

- **Decay**: Unused memories lose importance after 7 days (configurable).
- **Decay Rate**: 0.5 multiplier per cycle.
- **Immunization**: Tag-based exclusion from decay.
- **Archiving**: Memories below min importance (1) moved to `memories_archive`.
