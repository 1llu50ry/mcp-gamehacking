# Technical Design Document (TDD)


## Architecture Overview

The system implements a local-first Model Context Protocol (MCP) server designed for semantic memory management, task lifecycle tracking, coding standards, knowledge graphs, and multi-agent coordination.

## Core Components

- **Persistence Engine**: SQLite (via `better-sqlite3`) with WAL mode for concurrent reads.
- **Embedding Engine**: Local ONNX execution via `@xenova/transformers`. Uses `Xenova/all-MiniLM-L6-v2` (384-dim vectors).
- **NLP Engine**: `compromise` + `compromise-dates` for entity extraction and temporal query parsing.
- **State Management**: ACID-compliant transactions with `proper-lockfile` cross-process write locking.
- **Communication Layer**: MCP Standard (STDIO/JSON-RPC 2.0).
- **Schema Validation**: Zod v4 for all tool input validation.
- **Build**: tsup for TypeScript bundling, Vite for dashboard frontend.

## Database Tables (Production)

### `memories` Table

| Column                             | Type         | Description                                         |
| :--------------------------------- | :----------- | :-------------------------------------------------- |
| id                                 | TEXT (UUID)  | PK                                                  |
| type                               | TEXT         | code_fact, decision, mistake, pattern, task_archive |
| title                              | TEXT         | Short descriptor (3-255 chars)                      |
| content                            | TEXT         | Body (min 10 chars)                                 |
| importance                         | INTEGER      | 1-5 Ranking                                         |
| is_global                          | BOOLEAN      | Cross-repo visibility                               |
| scope_owner/scope_repo             | TEXT         | Repository scoping                                  |
| tags                               | TEXT (JSON)  | Tech-stack markers                                  |
| metadata                           | TEXT (JSON)  | Agent, role, model, etc.                            |
| supersedes                         | TEXT         | UUID of superseded memory                           |
| expires_at                         | TEXT         | TTL timestamp                                       |
| hit_count/recall_count/recall_rate | INTEGER/REAL | Usage statistics                                    |
| status                             | TEXT         | active, archived                                    |

### Additional Tables

- `memory_vectors`: 384-dim Float32Array embeddings for semantic search.
- `memories_archive`: Archived/decayed memories (mirrors memories + archived_at).
- `memory_summary`: Per-repo (owner+repo PK) AI-generated summaries.
- `tasks`: Full task lifecycle with 6 states, hierarchical via parent_id, token tracking.
- `task_comments`: Audit trail for task status transitions.
- `coding_standards`: Reusable rules with language/stack scoping and vector search.
- `standard_vectors`: Embeddings for coding standard similarity search.
- `handoffs`: Agent-to-agent context transfer with expiry.
- `claims`: Task ownership tracking (unique per task).
- `entities`: Knowledge graph nodes scoped by composite PK `(name, repo)` (v33).
- `relations`: Knowledge graph edges scoped by `(from_entity, to_entity, relation_type, repo)`.
- `observations`: Knowledge graph observations with composite FK `(entity_name, repo)`.
- `exploration_observations`: Evidence-backed repository findings with subject, fact, confidence, task, agent, and freshness metadata.
- `exploration_evidence`: Normalized file/symbol/line pointers for exploration observations; raw source content is never stored.
- `action_log`: Full audit trail of all tool invocations.
- `_schema_version`: Ordered migration history (current: v33).

## Search Algorithms

### Memory Search (Hybrid)

- **TF-IDF Cosine Similarity**: Client-side computation from token frequency vectors.
- **Neural Vector Similarity**: ONNX embeddings compared via cosine similarity.
- **Combined Score**: Weighted average of both scores for final ranking.
- **Ranking Bias**: Repo affinity boost + importance tiebreaker.

### Standard Search

- Same hybrid approach as memory search, scoped to coding standards.

## Key Implementation Details

### Collision Detection

- `memory-store` performs semantic conflict checking (threshold 0.55) on new entries.

### Task Lifecycle Enforcement

- Transition validation: `backlog`/`pending`/`blocked` → `in_progress` → `completed`.
- Token requirement: `est_tokens` mandatory on completion.
- Auto-archiving: Completion triggers `archiveTaskToMemory()`.

### Soul Maintenance (Memory Decay)

- **Default Configuration**: 7 days inactivity, decay rate 0.5, min importance 1.
- **Immunization**: Tags can exclude memories from decay.
- **Schedule**: Runs at startup (checks if <24h since last run).

### NLP Archivist

- **Library**: `compromise` for entity extraction.
- **Trigger**: Runs on every `memory-store` via `kg-archivist.ts`.
- **Output**: Entities stored in `entities` table, relations inferred from co-occurrence.

### Exploration Observations

Use `observation-write` for evidence-backed facts discovered while inspecting a repository, such as a symbol contract, dependency edge, implementation constraint, or verified defect. Every observation belongs to an `owner`/`repo` scope and must include at least one file pointer; symbol and line coordinates are optional. Bulk writes are committed in one transaction and normalized subject/fact/evidence identity makes retries idempotent.

Use `observation-read` to retrieve those findings by id, subject, task, file, symbol, or confidence. Compact reads return evidence counts only; set `hydrate_evidence: true` when exact pointers are needed. Stale, superseded, and unverifiable observations are excluded from list/context reads unless `include_stale: true`.

Freshness is fingerprint-driven and never invokes an LLM. Each evidence pointer stores the source file checksum plus a structural symbol fingerprint (name, kind, export flags, signature, doc comment, semantic signature). Incremental indexing revalidates only the observations attached to changed files: an unchanged symbol stays `valid` even when its file changed, a changed or deleted symbol becomes `stale`, a missing index makes the observation `unverifiable` rather than silently valid, renames carry evidence pointers to the new path, and deletions mark the row stale with a reason. `observation-write.refresh_ids` is the bounded, owner/repo-scoped lazy revalidation path; a new observation may supersede an old one via `supersedes_id`. Raw source text is deliberately excluded from this domain.

Use `memory-write` instead for durable conclusions that should survive beyond a particular exploration run: architectural decisions, reusable patterns, mistakes, code facts worth recalling semantically, and completed-task archives. An observation is source-grounded evidence; a memory is curated long-term knowledge. Promote a validated observation into memory rather than treating both stores as interchangeable.

### Write Locking

- All mutation tools use `WriteLock.withLock()` via `proper-lockfile`.
- File-based, cross-process locking for multi-process safety.

### Bulk Operations

- All bulk operations use transaction chunk size of 500 records.

### Upstream Compatibility

> **LEGACY DESIGN INTENT — NOT IMPLEMENTED (verified 2026-08-08):** the alias tools below were never shipped; no `remember_fact` / `remember_facts` / `recall` / `forget` tools or aliases exist in `src/mcp`. Canonical tools are `memory-store`, `memory-search`, `memory-delete`, etc. Retained for historical record only.

- Alias tools registered via SDK `registerTool()`:
  - `remember_fact` → `memory-store`
  - `remember_facts` → `memory-store` (bulk)
  - `recall` → `memory-search`
  - `forget` → `memory-delete`

### Reference Catalog

- **Prompts**: 31 markdown files in `src/mcp/prompts/definitions/` loaded via `loader.ts`.
- **Resources**: All exposed via standard MCP resource URIs.
- **Auto-Injection**: `{{current_repo}}` replaced with active repo in prompt templates.
