# ADR-003 — Standard Domain Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

> **IMPLEMENTED (verified 2026-08-08):** the 3-tool design shipped as `standard-write`, `standard-read`, `standard-delete`. Conflict detection on create/update, bulk `repo` propagation, and `is_global` default `false` are implemented (src/mcp/tools/standard-write/, standard-read/). The 5 legacy tools (`standard-store`, `standard-update`, `standard-detail`, `standard-search`, `standard-delete`) no longer exist in the 20 canonical tool set.

## Context

Following the pattern of ADR-001 (Memory) and ADR-002 (Task), the Standard domain needs to be simplified.

The Standard domain currently has 5 tools:

- `standard-store` (1,774 chars), `standard-update` (925 chars)
- `standard-delete` (912 chars) — already supports id/ids/code/codes
- `standard-detail` (531 chars), `standard-search` (799 chars)
- **Total: ~4,941 chars / 5 tools**

Problems found:

- **Conflict detection only in store** — update does not check for conflicts (can duplicate content)
- **Bulk mode bug**: `repo` is hardcoded to `null` in bulk insert of `standards[]`
- **`is_global` default reversed**: defaults to `true` even though standards are usually repo-specific
- The schema still uses `oneOf` for single vs bulk, and `id` vs `code`

## Decision Drivers

- **Consistency with Memory & Task**: the `write` + `read` + `delete` pattern is identical
- **Zero oneOf**: all parameters optional, auto-inferred intent
- **Uniform identifiers**: `id`/`code`/`ids`/`codes` (consistent across domains)
- **Fix the bugs found**: bulk repo, conflict detection on update, `is_global` default

## Decision Outcome

**Chosen option:** 3 tools + auto-infer

### Auto-infer Rules

#### `standard-write`

| Input                                    | Detect                 | Action                                                                                             |
| ---------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `standards: [...]`                       | Array present          | **Bulk** — each item infers on its own (create if name+content present, update if id/code present) |
| `name` + `content` (without `id`/`code`) | Create fields complete | **Single create** — conflict check threshold 0.82                                                  |
| `id` / `code`                            | Identifier             | **Single update** — also conflict check                                                            |

**Fix applied:**

- Conflict detection also in update mode (not only create)
- Bulk `repo` bug fixed — `repo` is propagated to each item
- `is_global` defaults to `false` (not `true`)

#### `standard-read`

| Input           | Detect            | Action                                       |
| --------------- | ----------------- | -------------------------------------------- |
| `id` / `code`   | Single identifier | **Detail single** — full CodingStandardEntry |
| `ids` / `codes` | Array identifier  | **Detail bulk** — array of entries           |
| `query`         | Query string      | **Search** — hybrid scoring (4 components)   |
| (nothing)       | Fallback          | **List all** — default limit 20              |

#### `standard-delete`

| Input   | Detect     | Action         |
| ------- | ---------- | -------------- |
| `id`    | UUID       | Single by UUID |
| `code`  | Code       | Single by code |
| `ids`   | Array UUID | Bulk by UUID   |
| `codes` | Array code | Bulk by codes  |

### Schema Size Estimation

| New Tool          | Covers                               | Estimated Schema |
| ----------------- | ------------------------------------ | ---------------- |
| `standard-write`  | store + update + bulk                | ~1,800 chars     |
| `standard-read`   | search + detail single + detail bulk | ~1,000 chars     |
| `standard-delete` | single + bulk by id/code/ids/codes   | ~600 chars       |
| **Total**         |                                      | **~3,400 chars** |

## Consequences

**Positive:**

- Tool count drops 5 → 3
- Schema size drops ~31% (4,941 → ~3,400 chars)
- Pattern identical to Memory & Task — write/read/delete
- Bugs fixed: bulk repo, conflict on update, `is_global` default
- Zero oneOf — all optional

**Negative:**

- The search handler (298 lines, hybrid scoring) must be refactored into part of `read`
- Breaking change — clients must migrate

## Related ADRs

- ADR-001: Memory Domain Tools Simplification
- ADR-002: Task Domain Tools Simplification

## Implementation Plan

1. **REFACTOR-STD-001:** Implement `standard-write` handler — store + update + bulk, fix conflict detection, fix bulk repo bug, fix `is_global` default
2. **REFACTOR-STD-002:** Implement `standard-read` handler — search + detail single + detail bulk via ids/codes
3. **REFACTOR-STD-003:** Refactor `standard-delete` — flatten schema, remove oneOf
4. **REFACTOR-STD-004:** Register 3 tools + remove old 5 definitions + update router + cleanup
5. **REFACTOR-STD-005:** Update integration tests
