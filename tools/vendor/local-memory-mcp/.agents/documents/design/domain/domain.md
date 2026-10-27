# Domain Model


This document specifies the core entities and business logic of the MCP Local Memory system.

## Core Entities

### 1. Memory

Represents a distilled unit of knowledge or a project artifact captured by an AI agent.

- **Attributes:**
  - `id`: UUID v4 Primary Key.
  - `type`: `code_fact`, `decision`, `mistake`, `pattern`, `task_archive`.
  - `title`: Concise human-readable title (3-255 chars).
  - `content`: Body of the memory (min 10 chars).
  - `importance`: 1 (Low) to 5 (Critical) rating.
  - `agent`, `role`, `model`: Attribution metadata for the creator.
  - `scope`: Geographic constraints (`owner`, `repo`, `branch`, `folder`, `language`).
  - `tags`: JSON array for cross-referencing.
  - `metadata`: Arbitrary JSON object.
  - `is_global`: 1 if shared across all repositories.
  - `status`: Lifecycle state (`active`, `archived`).
  - `supersedes`: UUID of the memory this entry replaces (versioning).
  - `expires_at`: Optional TTL-based expiration.
  - `hit_count`, `recall_count`, `recall_rate`: Utility metrics (automatic tracking).
  - `last_used_at`: Timestamp of last retrieval or acknowledgment.

### 2. Task

Represents an atomic unit of work tracked for multi-agent coordination.

- **Attributes:**
  - `id`: UUID v4 Primary Key.
  - `task_code`: Human-readable identifier (e.g., `TASK-001`), unique per repo.
  - `title`: Task objective.
  - `description`: Detailed instructions or acceptance criteria.
  - `status`: `backlog`, `pending`, `in_progress`, `completed`, `canceled`, `blocked`.
  - `phase`: Project phase (e.g., `Research`, `Implementation`, `Review`).
  - `priority`: 1 to 5.
  - `hierarchy`: `parent_id` (parent-child) and `depends_on` (sequencing).
  - `est_tokens`: Token consumption (recorded on completion).
  - `timestamps`: `created_at`, `updated_at`, `in_progress_at`, `finished_at`, `canceled_at`.

### 3. Task Comment

A chronological audit log for tasks, capturing discussions and status transitions.

- **Attributes:**
  - `comment`: Text content.
  - `transition`: Captures `previous_status` and `next_status` for auditability.
  - `attribution`: Linked to a specific agent, role, and model.

### 4. Standard

A reusable coding rule or best practice, stored for automated compliance checking.

- **Attributes:**
  - `id`: UUID v4 Primary Key.
  - `title`: Rule name.
  - `description`: Detailed rule guidance.
  - `scope`: Target scope (`owner`, `repo`, `folder`, `language`, `stack`).
  - `context`: When this rule applies.
  - `recommendation`: What to do instead.
  - `rationale`: Why this rule exists.
  - `tags`: Categorization tags.
  - `is_global`: Cross-repo visibility flag.
  - `status`: `active`, `deprecated`, `superseded`.

### 5. Action Log

High-fidelity telemetry capturing every system operation (tool call).

- **Attributes:**
  - `action`: Name of the tool invoked.
  - `query`: The input parameters or search term (JSON).
  - `result_count`: Quantifiable impact of the action.
  - `memory_id` / `task_id`: Optional links to affected entities.

### 6. Handoff

Represents transient coordination state passed between agents.

- **Attributes:**
  - `from_agent` / `to_agent`: Source and optional destination agent.
  - `task_id`: Optional associated task.
  - `summary`: Short handoff objective.
  - `context`: Structured transfer payload (JSON).
  - `status`: `pending`, `accepted`, `rejected`, `expired`.
  - `expires_at`: Auto-expiry timestamp.

### 7. Claim

Represents task ownership in the dedicated coordination layer.

- **Attributes:**
  - `task_id`: Claimed task (unique — one claim per task).
  - `agent`, `role`: Current owner attribution.
  - `claimed_at`, `released_at`: Claim lifecycle timestamps.
  - `metadata`: Structured operational context.

### 8. Entity (Knowledge Graph)

A node in the knowledge graph representing a real-world concept.

- **Attributes:**
  - `name`: Text Primary Key (unique entity name).
  - `type`: Entity type (e.g., `person`, `concept`, `technology`, `system`).
  - `description`: Optional human-readable description.

### 9. Relation (Knowledge Graph)

A directed edge connecting two knowledge graph entities.

- **Attributes:**
  - `from_entity`, `to_entity`: Source and target entities (FKs).
  - `relation_type`: Type of relationship (e.g., `uses`, `depends_on`, `implements`).
  - `confidence`: Per-edge confidence label `0..1` (migration **v24** / TASK-325, `REAL NOT NULL DEFAULT 1.0`), **display-only** — drives the dashboard KG tab's edge label + opacity buckets; not used in any query or filter.
  - **Composite PK**: `(from_entity, to_entity, relation_type)`.


### 10. Observation (Knowledge Graph)

An observation attached to a specific entity.

- **Attributes:**
  - `entity_name`: FK to `entities(name)`.
  - `observation`: Text content.

---

## Business Rules & Invariants

### 1. Task Workflow

- **Gradual Promotion**: A task cannot transition directly from `backlog`, `pending`, or `blocked` to `completed`. It must be moved to `in_progress` first.
- **Auto-Archiving**: When a task status is set to `completed`, the system automatically generates a `task_archive` memory entry containing the task's full history.
- **Token Transparency**: Moving to `completed` requires `est_tokens` to be provided.

### 2. Memory Lifecycle

- **Supersedes Versioning**: When `memory-store` receives a `supersedes` parameter, the old memory is archived and the new one linked.
- **Conflict Detection**: Before storing, semantic search checks for similarity > 0.55. If found, the operation flags a potential conflict.
- **Soul Maintenance**: Unused memories decay over time. Default: 7 days inactivity, decay rate 0.5, min importance 1.

### 3. Attribution Requirement

- All mutations must include `agent` and `role` metadata to maintain chain of responsibility.

### 4. Scope Isolation

- Memories, tasks, standards, handoffs, claims, and knowledge graph entities are strictly isolated by `owner`/`repo` unless marked as `is_global`.
- Vector search automatically honors repo-scoping during retrieval.

### 5. Write Integrity

- All mutation tools run under a cooperative write lock (`WriteLock`) to prevent concurrent write conflicts across processes.

### 6. Knowledge Graph Cascade

- Deleting an entity cascades to all its relations and observations.
- Relations use a composite PK to prevent duplicate edges.
