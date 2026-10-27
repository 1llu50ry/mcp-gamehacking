# Acceptance Criteria: Knowledge Management (Memory)

All features must satisfy the following criteria to be considered production-ready.


## 1. Storage (`memory-store`)

- **Given** the repository state is open,
- **When** a valid title and content are provided,
- **Then** the system MUST generate a local vector embedding using ONNX transformers and persist the record in SQLite.
- **And** if similarity > 0.55 with existing memory is detected, the system MUST flag a potential conflict.
- **And** if `supersedes` is provided, the old memory MUST be archived.

## 2. Hybrid Search (`memory-search`)

- **Given** the memories table contains indexed data,
- **When** a semantic query is processed,
- **Then** the ranking algorithm MUST use a weighted hybrid of TF-IDF cosine similarity and neural vector embeddings.

## 3. Knowledge Synthesis (`memory-synthesize`)

- **Given** the client session has `sampling` capability,
- **When** multiple related context snippets are identified,
- **Then** the tool MUST request a synthesis from the client LLM and create a new memory of type `decision`.

## 4. Usage Acknowledgement (`memory-acknowledge`)

- **Given** an agent has successfully implemented logic based on a retrieved memory,
- **When** the agent calls `memory-acknowledge` with status `used`,
- **Then** the system MUST increment the recall count for that memory ID.

## 5. Global Search

- **Given** multiple repositories are registered,
- **When** `is_global` is set on a memory,
- **Then** that record MUST be visible and searchable from any repository context.

## 6. Memory Detail (`memory-detail`)

- **Given** a memory exists in the database,
- **When** queried by UUID or short code,
- **Then** the system MUST return the full memory record including hit_count, recall_count, and recall_rate.

## 7. Memory Lifecycle (Soul Maintenance)

- **Given** a memory has not been accessed for 7 days,
- **When** the maintenance cycle runs,
- **Then** the memory's importance should decay by the configured rate (default: 0.5).
- **And** if importance falls below the minimum threshold (default: 1), the memory MUST be archived.

## 8. Collision Detection

- **Given** a new memory entry is being stored,
- **When** the semantic similarity to an existing memory exceeds 0.55,
- **Then** the system MUST return a conflict flag with the existing memory ID.
