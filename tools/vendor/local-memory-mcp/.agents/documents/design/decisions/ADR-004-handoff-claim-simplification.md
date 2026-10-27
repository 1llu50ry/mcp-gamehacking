# ADR-004 — Handoff & Claim Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

> **IMPLEMENTED (verified 2026-08-08):** shipped as `handoff-write` (create + status update), `handoff-read` (list/detail/search), and `claim-manage` (claim → auto-promote to in_progress; release; list by agent/all). `decision_refs` is a real `task-write` schema field (persisted in metadata). The 6 legacy tools (`handoff-create`, `handoff-update`, `handoff-list`, `task-claim`, `claim-list`, `claim-release`) no longer exist in the 20 canonical tool set.

## Context

The Handoff & Claim domain currently has **6 tools** for agent coordination:

- `handoff-create` (931 chars), `handoff-update` (280 chars), `handoff-list` (561 chars)
- `task-claim` (706 chars), `claim-list` (559 chars), `claim-release` (576 chars)
- **Total: ~3,613 chars**

Yet this domain serves 2 different concepts:

- **Handoff**: transfer of work between agents
- **Claim**: task ownership by an agent

Both need to be disaggregated into clear sub-domains with a consistent write/read pattern.

Problems found:

- `claim-list` is inconsistent — owner/repo are optional (unlike other tools)
- `task-claim` has the side effect of auto-promoting the task to in_progress — needs to be explicit
- Some schemas still use `oneOf` (handoff-create has task_id vs task_code)

## Decision Drivers

- **Clear sub-domains**: handoff and claim are separated, not combined
- **write/read pattern**: consistent with memory, task, standard
- **Weak agent friendly**: obvious tool names, auto-inferred intent
- **Zero oneOf**: all parameters optional

## Decision Outcome

**Chosen option:** 4 tools — handoff-write, handoff-read, claim-manage, + `decision_refs` in task

### New Tools

| Tool            | Covers                                  | Estimated Schema        |
| --------------- | --------------------------------------- | ----------------------- |
| `handoff-write` | handoff-create + handoff-update         | ~700 chars              |
| `handoff-read`  | handoff-list                            | ~400 chars              |
| `claim-manage`  | task-claim + claim-release + claim-list | ~1,000 chars            |
| **Total**       | **from 6 tools / 3,613 chars**          | **~2,100 chars (-42%)** |

### Auto-infer Rules

#### `handoff-write`

| Input                    | Detect              | Action                                   |
| ------------------------ | ------------------- | ---------------------------------------- |
| `from_agent` + `summary` | Create fields       | **Create handoff**                       |
| `id` + `status`          | Identifier + status | **Update status** (accept/reject/expire) |

#### `handoff-read`

| Input     | Detect              | Action                              |
| --------- | ------------------- | ----------------------------------- |
| (filters) | Status/agent filter | **List handoffs** — paginated, DESC |

#### `claim-manage`

| Input                                          | Detect       | Action                                       |
| ---------------------------------------------- | ------------ | -------------------------------------------- |
| `agent` + `task_id`/`code` (without `release`) | Agent + task | **Claim task** — auto-promote to in_progress |
| `agent` + `task_id`/`code` + `release: true`   | Release flag | **Release claim**                            |
| `agent` only (without task_id)                 | Agent filter | **List claims by agent**                     |
| (nothing)                                      | Fallback     | **List all active claims**                   |

### Cross-Cutting: `decision_refs` in task-write

All tasks can reference decision memories. Simply add the `decision_refs: string[]` field to the task-write schema. In the handler, it automatically lands in `metadata`.

```jsonc
{ "decision_refs": ["MEM-192", "ADR-002"] }
// → metadata: { decision_refs: ["MEM-192", "ADR-002"] }
```

**Why not use a DB column:** Zero migration. Metadata already supports free-form objects. The agent still sees the field in the schema.

## Consequences

**Positive:**

- Tool count drops 6 → 3 (actually 4 with claim-manage, but claim-manage = 3 old tools)
- Schema size drops ~42% (3,613 → ~2,100 chars)
- Clear sub-domains: handoff for transfer, claim for ownership
- `claim-list` fixed: owner/repo required like other tools
- `decision_refs` on tasks improves traceability

**Negative:**

- `claim-manage` combines 3 operations (claim, release, list) — auto-infer needs clear priority
- Auto-promoting the task on claim is a side effect — agents need to be aware it happens

## Related ADRs

- ADR-001: Memory Domain Tools Simplification
- ADR-002: Task Domain Tools Simplification
- ADR-003: Standard Domain Tools Simplification

## Implementation Plan

1. **REFACTOR-HC-001:** Implement `handoff-write` handler — create + update status, auto-infer
2. **REFACTOR-HC-002:** Implement `handoff-read` handler — list with filters
3. **REFACTOR-HC-003:** Implement `claim-manage` handler — claim + release + list, fix owner/repo required
4. **REFACTOR-HC-004:** Register 3 tools + remove old 6 definitions + update router + cleanup
5. **REFACTOR-HC-005:** Update integration tests
6. **TASK-006:** Add `decision_refs` field to task-write schema + handler
