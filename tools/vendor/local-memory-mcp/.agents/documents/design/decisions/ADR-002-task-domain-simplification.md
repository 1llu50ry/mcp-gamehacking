# ADR-002 — Task Domain Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

> **IMPLEMENTED (verified 2026-08-08):** the 3-tool design shipped as `task-write` (single/bulk/interactive/update), `task-read` (list/search/detail single+bulk), `task-delete`. Status state machine, claims/handoffs cleanup, and archive-to-memory are enforced in `src/mcp/tools/task-write/`. The 7 legacy tools (`task-create`, `task-create-interactive`, `task-update`, `task-delete`, `task-detail`, `task-list`, `task-search`) no longer exist in the 20 canonical tool set; `task_code` is the canonical identifier.

## Context

Following the same pattern as ADR-001 (Memory Domain), the Task domain needs to be simplified from **7 tools** to **3 tools** with auto-inferred intent and zero `oneOf`/`mode` parameters.

The Task domain currently has 7 tools:

- `task-create` (2,963 chars), `task-create-interactive` (774 chars), `task-update` (2,082 chars)
- `task-delete` (896 chars)
- `task-detail` (735 chars), `task-list` (766 chars), `task-search` (739 chars)
- **Total: ~9,945 chars**

Problems:

- `task-list` and `task-search` overlap — both query tasks
- `task-create-interactive` is a create variant with elicitation — not an independent tool
- `task-update` has a complex state machine, but it can be accommodated within 1 write tool via auto-infer

## Decision Drivers

- **Consistency with the Memory Domain**: the `write` + `read` + `delete` pattern must be identical
- **Uniform identifiers**: all domains use `id`/`code` (no `task_code`, `memory_id`, etc.)
- **Weak agent friendly**: 3 tool names, all fields optional, infer from the field combination
- **Save tokens**: the total schema must drop significantly
- **No backward compat**: legacy tools are fully removed, no aliases

## Considered Options

1. **7 separate tools** — status quo, ~9,945 chars
2. **4 tools** — separate task-write (create) and task-update (update) because of the complex state machine
3. **3 tools** — task-write (create+update+interactive), task-read (list+search+detail), task-delete — identical to the memory pattern

## Decision Outcome

**Chosen option:** 3 tools (option 3) — identical to ADR-001

### Auto-infer Rules

#### `task-write`

| Input                             | Detect                 | Action                                                                                                   |
| --------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `tasks: [...]`                    | Array present          | **Bulk** — each item inferred on its own (create if phase+title+desc present, update if id/code present) |
| `interactive: true`               | Flag present           | **Elicitation** — form asks the user via sampling                                                        |
| `phase` + `title` + `description` | Create fields complete | **Single create**                                                                                        |
| `code` + `phase`+`title`+`desc`   | Code + create fields   | **Create with custom code**                                                                              |
| `id` (without phase/title/desc)   | UUID                   | **Update by UUID**                                                                                       |
| `code` (without phase/title/desc) | Code                   | **Update by code**                                                                                       |

#### `task-read`

| Input           | Detect            | Action                                                          |
| --------------- | ----------------- | --------------------------------------------------------------- |
| `id` / `code`   | Single identifier | **Detail single** — full task + comments + children             |
| `ids` / `codes` | Array identifier  | **Detail bulk** — array of full tasks                           |
| `query`         | Query string      | **Search** — search by title/description/code                   |
| (rest)          | Fallback          | **List** — filter by status/phase, default: backlog+in_progress |

#### `task-delete`

| Input   | Detect     | Action             |
| ------- | ---------- | ------------------ |
| `id`    | UUID       | **Single by UUID** |
| `code`  | Code       | **Single by code** |
| `ids`   | Array UUID | **Bulk by UUID**   |
| `codes` | Array code | **Bulk by codes**  |

### Schema Size Estimation

| New Tool      | Covers                               | Estimated Schema |
| ------------- | ------------------------------------ | ---------------- |
| `task-write`  | create + update + interactive        | ~3,000 chars     |
| `task-read`   | list + search + detail + detail bulk | ~1,100 chars     |
| `task-delete` | single + bulk by id/code             | ~600 chars       |
| **Total**     |                                      | **~4,700 chars** |

## Consequences

**Positive:**

- Tool count drops 7 → 3 (saving 4 names + descriptions from context)
- Schema size drops ~53% (9,945 → ~4,700 chars)
- Pattern identical to the Memory Domain — write/read/delete
- Consistent identifiers: all domains use `id`/`code`/`ids`/`codes`
- Weak agents only need to know 3 tools + 3 domains = 9 total tools

**Negative:**

- `task-update`'s complex state machine (status transitions, claims, handoffs, archive) must be accommodated in `task-write`
- Total breaking change — legacy clients must migrate
- No backward compat (a deliberate decision)

## Alternatives Considered

### 4 tools (option 2)

Separates `task-update` because of the status state machine.

- **Pros:** Update logic is more isolated, smaller per-tool schemas
- **Cons:** Inconsistent with the memory pattern; weak agents must distinguish when to use write vs update

### Status quo — 7 tools (option 1)

- **Pros:** Familiar
- **Cons:** ~9,945 chars; 7 tool names; inconsistent identifiers (`task_code` vs `code`)

## Related ADRs

- ADR-001: Memory Domain Tools Simplification (parent pattern)

## Implementation Plan

1. **REFACTOR-TASK-001:** Implement `task-write` handler — create single + bulk + interactive + update single + bulk, auto-infer intent, status state machine, claims/handoffs cleanup, archive to memory
2. **REFACTOR-TASK-002:** Implement `task-read` handler — list + search + detail single + bulk, auto-infer mode
3. **REFACTOR-TASK-003:** Refactor `task-delete` handler — add code/codes, rename task_code→code
4. **REFACTOR-TASK-004:** Register 3 task tools + remove all old definitions — update router, definitions, schemas, exports
5. **REFACTOR-TASK-005:** Update integration tests
