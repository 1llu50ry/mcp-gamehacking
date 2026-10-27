# Database Schema

> **CORRECTED (2026-08-08):** current schema version is **23** (`SCHEMA_VERSION = 23`, src/mcp/storage/migrations/index.ts), not v16. The tables below are the core set; additional shipped tables not listed here: `codebase_files`/`codebase_symbols` (v01), `memories_fts` (v10), `queue_jobs` (v09, embedding outbox), `codebase_references` (v21), `kg_degrees` (v22), `codebase_references` edge targets (v23). `memory_summary` is written by `repo-summarize` (formerly `memory-summarize`); the "updated via memory-summarize and memory-synthesize" claim below uses legacy names. All columns listed per table verified against migrations (memories incl. supersedes/expires_at/hit/recall stats; tasks incl. task_code/phase/finished_at; coding_standards with `name`/`content`/`scope`/`stack`; KG entities/relations/observations; action_log; _schema_version). The `memory_vectors`/`standard_vectors` (384-dim BLOB, versioned) and soft-delete patterns verified.
>
> **CORRECTED (2026-08-10):** schema version is now **24** (`SCHEMA_VERSION = 24`, src/mcp/storage/migrations/index.ts:29) — migration **v23** (`codebase-references-edge-targets`, Phase 1.1) extended `codebase_references` with `target_file`/`target_symbol_id` + `extends`/`implements` kinds; migration **v24** (`relations-confidence`, TASK-325) adds a single display-only `confidence REAL NOT NULL DEFAULT 1.0` column to KG `relations` (no index, no query use — heuristic mapping + first-write-wins gap documented at the `relations` table below). Neither touches the codebase or core entity tables above.

This document specifies the database schema used in the MCP Local Memory system. The implementation logic for these tables is modularly distributed across specialized entities in `src/mcp/entities/` (inheriting from `src/mcp/storage/base.ts`). Schema versioning is managed by `src/mcp/storage/migrations/` (versioned index — `index.ts` + `vNN-*.ts`; current version: v16).

## Tables

### `memories`

The primary storage for knowledge items. Knowledge is scoped by repository and supports semantic tracking and expiration.

| Column           | Type    | Description                                                                 |
| :--------------- | :------ | :-------------------------------------------------------------------------- |
| `id`             | TEXT    | Primary Key (UUID v4).                                                      |
| `type`           | TEXT    | Memory type: `code_fact`, `decision`, `mistake`, `pattern`, `task_archive`. |
| `title`          | TEXT    | Human-readable title (max 255 chars).                                       |
| `content`        | TEXT    | The main body of the memory (min 10 chars).                                 |
| `importance`     | INTEGER | Rating from 1 (Low) to 5 (Critical).                                        |
| `agent`          | TEXT    | Name of the agent that created the memory.                                  |
| `role`           | TEXT    | Role of the creator (e.g., Composite Senior Authority).                     |
| `model`          | TEXT    | AI model used at time of creation.                                          |
| `scope_owner`    | TEXT    | Repository owner for scoping.                                               |
| `scope_repo`     | TEXT    | Repository name for scoping.                                                |
| `scope_branch`   | TEXT    | Optional branch scoping.                                                    |
| `scope_folder`   | TEXT    | Optional folder path scoping.                                               |
| `scope_language` | TEXT    | Optional programming language scoping.                                      |
| `tags`           | TEXT    | JSON array of strings for categorization.                                   |
| `metadata`       | TEXT    | JSON object for arbitrary context.                                          |
| `is_global`      | INTEGER | 1 if shared across all repositories, 0 otherwise.                           |
| `status`         | TEXT    | Current status: `active`, `archived`.                                       |
| `supersedes`     | TEXT    | UUID of the memory this entry replaces.                                     |
| `expires_at`     | TEXT    | Optional ISO-8601 timestamp for automatic expiration.                       |
| `hit_count`      | INTEGER | Number of times the memory was retrieved.                                   |
| `recall_count`   | INTEGER | Number of times the memory was acknowledged as used.                        |
| `recall_rate`    | REAL    | Ratio of recall_count / hit_count (computed).                               |
| `last_used_at`   | TEXT    | ISO-8601 timestamp of last retrieval/acknowledgment.                        |
| `created_at`     | TEXT    | ISO-8601 creation timestamp.                                                |
| `updated_at`     | TEXT    | ISO-8601 update timestamp.                                                  |

### `memory_vectors`

Storage for semantic embeddings used in vector search.

| Column           | Type    | Description                                                    |
| :--------------- | :------ | :------------------------------------------------------------- |
| `memory_id`      | TEXT    | Primary Key / Foreign Key to `memories(id)` ON DELETE CASCADE. |
| `vector`         | BLOB    | Float32Array binary vector (384 dimensions).                   |
| `vector_version` | INTEGER | Version of the embedding model used.                           |
| `updated_at`     | TEXT    | ISO-8601 timestamp.                                            |

### `memories_archive`

Historical storage for decayed/archived memories. Mirrors the `memories` table with all columns plus `archived_at` timestamp.

### `memory_summary`

Condensed repository-level context, updated via `memory-summarize` and `memory-synthesize`.

| Column       | Type | Description                        |
| :----------- | :--- | :--------------------------------- |
| `owner`      | TEXT | Primary Key (Repository Owner).    |
| `repo`       | TEXT | Primary Key (Repository Name).     |
| `summary`    | TEXT | Markdown summary of project state. |
| `updated_at` | TEXT | ISO-8601 timestamp.                |

### `tasks`

Manages project execution and coordination between agents.

| Column           | Type    | Description                                                              |
| :--------------- | :------ | :----------------------------------------------------------------------- |
| `id`             | TEXT    | Primary Key (UUID v4).                                                   |
| `task_code`      | TEXT    | Short human-readable code (e.g., `TASK-001`), unique per repo.           |
| `title`          | TEXT    | Task objective.                                                          |
| `description`    | TEXT    | Detailed task instructions.                                              |
| `status`         | TEXT    | `backlog`, `pending`, `in_progress`, `completed`, `canceled`, `blocked`. |
| `phase`          | TEXT    | Project phase (e.g., `Research`, `Implementation`, `Review`).            |
| `priority`       | INTEGER | 1 (Low) to 5 (High).                                                     |
| `agent`          | TEXT    | Current agent assigned to the task.                                      |
| `role`           | TEXT    | Role of the assigned agent.                                              |
| `doc_path`       | TEXT    | Path to relevant documentation.                                          |
| `scope_owner`    | TEXT    | Repository owner.                                                        |
| `scope_repo`     | TEXT    | Repository name.                                                         |
| `tags`           | TEXT    | JSON array of strings.                                                   |
| `metadata`       | TEXT    | JSON blob for custom state.                                              |
| `parent_id`      | TEXT    | Foreign Key to `tasks(id)` for hierarchy (nullable).                     |
| `depends_on`     | TEXT    | Foreign Key to `tasks(id)` for sequencing (nullable).                    |
| `est_tokens`     | INTEGER | Actual tokens used (recorded on completion).                             |
| `created_at`     | TEXT    | ISO-8601 timestamp.                                                      |
| `updated_at`     | TEXT    | ISO-8601 timestamp.                                                      |
| `finished_at`    | TEXT    | Completion timestamp.                                                    |
| `canceled_at`    | TEXT    | Cancellation timestamp.                                                  |
| `in_progress_at` | TEXT    | Timestamp when task moved to `in_progress`.                              |

### `task_comments`

Audit trail and discussion history for tasks.

| Column            | Type | Description                                   |
| :---------------- | :--- | :-------------------------------------------- |
| `id`              | TEXT | Primary Key (UUID v4).                        |
| `task_id`         | TEXT | Foreign Key to `tasks(id)` ON DELETE CASCADE. |
| `comment`         | TEXT | The comment content.                          |
| `agent`           | TEXT | Author name.                                  |
| `role`            | TEXT | Author role.                                  |
| `model`           | TEXT | AI model used.                                |
| `previous_status` | TEXT | Task status before this comment.              |
| `next_status`     | TEXT | Task status after this comment.               |
| `created_at`      | TEXT | ISO-8601 timestamp.                           |

### `coding_standards`

Reusable coding standard entries for automated compliance checking.

| Column           | Type    | Description                                                                  |
| :--------------- | :------ | :--------------------------------------------------------------------------- |
| `id`             | TEXT    | Primary Key (UUID v4).                                                       |
| `title`          | TEXT    | Short rule name (e.g., "Use UUID Primary Keys").                             |
| `description`    | TEXT    | Detailed rule description.                                                   |
| `scope`          | TEXT    | JSON object with `owner`, `repo`, `folder`, `language`, `stack` for scoping. |
| `context`        | TEXT    | When this rule applies.                                                      |
| `recommendation` | TEXT    | What to do instead.                                                          |
| `rationale`      | TEXT    | Why this rule exists.                                                        |
| `tags`           | TEXT    | JSON array of strings.                                                       |
| `is_global`      | INTEGER | 1 if cross-repo, 0 if repo-specific.                                         |
| `parent_id`      | TEXT    | For hierarchical rule grouping (nullable).                                   |
| `status`         | TEXT    | `active`, `deprecated`, `superseded`.                                        |
| `created_at`     | TEXT    | ISO-8601 timestamp.                                                          |
| `updated_at`     | TEXT    | ISO-8601 timestamp.                                                          |

### `standard_vectors`

Vector embeddings for coding standard search.

| Column           | Type    | Description                                                   |
| :--------------- | :------ | :------------------------------------------------------------ |
| `standard_id`    | TEXT    | Primary Key / FK to `coding_standards(id)` ON DELETE CASCADE. |
| `vector`         | BLOB    | Float32Array binary vector.                                   |
| `vector_version` | INTEGER | Embedding model version.                                      |
| `updated_at`     | TEXT    | ISO-8601 timestamp.                                           |

### `handoffs`

Agent-to-agent handoff communication for context transfer.

| Column        | Type | Description                                      |
| :------------ | :--- | :----------------------------------------------- |
| `id`          | TEXT | Primary Key (UUID v4).                           |
| `task_id`     | TEXT | Optional FK to `tasks(id)`.                      |
| `from_agent`  | TEXT | Source agent name.                               |
| `to_agent`    | TEXT | Destination agent name (nullable for broadcast). |
| `summary`     | TEXT | Short handoff objective.                         |
| `context`     | TEXT | Structured transfer payload (JSON).              |
| `status`      | TEXT | `pending`, `accepted`, `rejected`, `expired`.    |
| `scope_owner` | TEXT | Repository owner.                                |
| `scope_repo`  | TEXT | Repository name.                                 |
| `created_at`  | TEXT | ISO-8601 timestamp.                              |
| `accepted_at` | TEXT | Timestamp of acceptance.                         |
| `expires_at`  | TEXT | Auto-expiry timestamp.                           |

### `claims`

Task ownership tracking for multi-agent coordination.

| Column        | Type | Description                                   |
| :------------ | :--- | :-------------------------------------------- |
| `id`          | TEXT | Primary Key (UUID v4).                        |
| `task_id`     | TEXT | FK to `tasks(id)` ON DELETE CASCADE (unique). |
| `agent`       | TEXT | Agent name holding the claim.                 |
| `role`        | TEXT | Role of the agent.                            |
| `metadata`    | TEXT | JSON blob for operational context.            |
| `scope_owner` | TEXT | Repository owner.                             |
| `scope_repo`  | TEXT | Repository name.                              |
| `claimed_at`  | TEXT | Timestamp of claim.                           |
| `released_at` | TEXT | Timestamp of release (nullable).              |

### `entities`

Knowledge graph nodes.

| Column        | Type | Description                                                      |
| :------------ | :--- | :--------------------------------------------------------------- |
| `name`        | TEXT | Primary Key (entity name, unique).                               |
| `type`        | TEXT | Entity type (e.g., `person`, `concept`, `technology`, `system`). |
| `description` | TEXT | Optional description.                                            |
| `scope_owner` | TEXT | Repository owner.                                                |
| `scope_repo`  | TEXT | Repository name.                                                 |
| `created_at`  | TEXT | ISO-8601 timestamp.                                              |
| `updated_at`  | TEXT | ISO-8601 timestamp.                                              |

### `relations`

Knowledge graph edges (directed).

| Column                                            | Type | Description                                                                                                                                                                          |
| :------------------------------------------------ | :--- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from_entity`                                     | TEXT | FK to `entities(name)` ON DELETE CASCADE.                                                                                                                                            |
| `to_entity`                                       | TEXT | FK to `entities(name)` ON DELETE CASCADE.                                                                                                                                            |
| `relation_type`                                   | TEXT | Type of relation (e.g., `uses`, `depends_on`, `implements`).                                                                                                                         |
| `scope_owner`                                     | TEXT | Repository owner.                                                                                                                                                                    |
| `scope_repo`                                      | TEXT | Repository name.                                                                                                                                                                     |
| `confidence`                                      | REAL | Per-edge confidence label `0..1`, `NOT NULL DEFAULT 1.0` (migration **v24**, `relations-confidence`, TASK-325). **Display-only** — no index, never used in queries/filters/ORDER BY. |
| `created_at`                                      | TEXT | ISO-8601 timestamp.                                                                                                                                                                  |
| **PK**: `(from_entity, to_entity, relation_type)` |

>
> - `1.0` — explicit/manual (dashboard `createRelation`) + default when omitted (`params.confidence ?? 1.0`, `src/mcp/entities/knowledge-graph/entity.ts:78,336` — backward compatible).
> - `0.9` — parser-deterministic codebase edges (`saveCodebaseRelations`, `KG_RELATION_CONFIDENCE_CODEBASE`, `src/mcp/tools/kg-archivist/relations.ts:31`): call/instantiation/import/extends/implements from indexed code — no NLP noise, but name-based target resolution (ADR-002).
> - `0.8` — structured semantic metadata (`KG_RELATION_CONFIDENCE_SEMANTIC`, `relations.ts:21`): task `depends_on`/`inspired_by`, standard `extends`/`related_to` (explicit fields or similarity search).
> - `0.55` — NLP auto-extraction co-occurrence (`KG_RELATION_CONFIDENCE_AUTO_EXTRACTION`, `src/mcp/tools/kg-archivist/extract.ts:352`): `co_mentioned` from the embedding worker — heaviest discount (spec anchor).
>
> **Known gap — first-write-wins:** inserts use `INSERT OR IGNORE` (`entity.ts:69`), so a later writer re-attempting an existing edge is a no-op and the **first writer's confidence sticks**; within one worker cycle `saveExtractions` (0.55) runs before the semantic/codebase writers, so a colliding `co_mentioned` pair keeps 0.55. Full confidence recomputation from observations (scoring from source documents instead of insert-time constants) is deferred.

### `observations`

Knowledge graph observations per entity.

| Column        | Type | Description                               |
| :------------ | :--- | :---------------------------------------- |
| `id`          | TEXT | Primary Key (UUID v4).                    |
| `entity_name` | TEXT | FK to `entities(name)` ON DELETE CASCADE. |
| `observation` | TEXT | The observation text.                     |
| `scope_owner` | TEXT | Repository owner.                         |
| `scope_repo`  | TEXT | Repository name.                          |
| `created_at`  | TEXT | ISO-8601 timestamp.                       |

### `action_log`

Chronological record of system usage for performance and audit analysis.

| Column         | Type    | Description                                    |
| :------------- | :------ | :--------------------------------------------- |
| `id`           | INTEGER | Primary Key (Autoincrement).                   |
| `action`       | TEXT    | Tool or operation name (e.g., `memory-store`). |
| `query`        | TEXT    | Input parameters or search query (JSON).       |
| `response`     | TEXT    | Summary or full raw response (truncated).      |
| `memory_id`    | TEXT    | Optional FK to associated memory.              |
| `task_id`      | TEXT    | Optional FK to associated task.                |
| `scope_owner`  | TEXT    | Repository owner.                              |
| `scope_repo`   | TEXT    | Repository name.                               |
| `result_count` | INTEGER | Number of items returned.                      |
| `created_at`   | TEXT    | ISO-8601 timestamp.                            |

### `_schema_version`

Schema migration tracking.

| Column       | Type    | Description                           |
| :----------- | :------ | :------------------------------------ |
| `version`    | INTEGER | Current schema version.               |
| `applied_at` | TEXT    | ISO-8601 timestamp of last migration. |

## Indexes

- `idx_memories_scope_type_created`: Efficient memory retrieval by repo + type.
- `idx_memories_scope_hit_count`: Performance-based ranking.
- `idx_tasks_scope_status`: Optimized task board rendering by repo/status.
- `idx_task_comments_task_id`: Fast comment lookup by task.
- `idx_action_log_scope_created`: Efficient history pagination.
- `idx_handoffs_scope_status`: Handoff listing by repo/status.
- `idx_claims_task_id`: Claim lookup by task.
- `idx_entities_scope`: Entity lookup by repo.
- `idx_relations_from_entity`: Outgoing relation lookup.
- `idx_relations_to_entity`: Incoming relation lookup.
- `idx_observations_entity`: Observation lookup by entity.
- `idx_standards_scope`: Standard listing by repo/language.
