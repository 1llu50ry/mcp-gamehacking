# ADR-007 — Agent Context Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

> **IMPLEMENTED (verified 2026-08-08):** `agent-context` is the sole Agent Context tool; `decision-log` and `session-summarize` were absorbed into `memory-write` as convenience modes (`type:"decision"` with context/rationale/alternatives; `type:"task_archive"` with key_decisions/next_steps — auto-formats content, src/mcp/tools/memory-write/helpers.ts). Neither legacy tool is in the 20 canonical set.

## Context

The Agent Context domain currently has **3 tools**:

- `agent-context` (515 chars) — aggregation of memories + tasks + decisions
- `decision-log` (743 chars) — convenience wrapper for memory-write type=decision
- `session-summarize` (676 chars) — convenience wrapper for memory-write type=task_archive
- **Total: ~1,934 chars / 3 tools**

`decision-log` and `session-summarize` are actually convenience wrappers that merely format the data and then call `handleMemoryStore` (now `memory-write`). Both can be eliminated by adding structured fields to memory-write.

## Decision Drivers

- **Consistent with other domain patterns**: write/read/delete pattern
- **Minimal tool count**: just 1 tool
- **Memory-write as the single write path**: all writes go through memory-write

## Decision Outcome

**Chosen option:** 1 tool — `agent-context` only. `decision-log` and `session-summarize` are absorbed into memory-write.

### Changes

| Old Tool            | Fate       | New Way                                                                |
| ------------------- | ---------- | ---------------------------------------------------------------------- |
| `agent-context`     | ✅ Kept    | Standalone read aggregation                                            |
| `decision-log`      | ❌ Removed | `memory-write({ type: "decision", context, rationale, alternatives })` |
| `session-summarize` | ❌ Removed | `memory-write({ type: "task_archive", key_decisions, next_steps })`    |

### Additional Fields in memory-write

To accommodate the structured formatting previously handled by decision-log and session-summarize:

```jsonc
// In the memory-write schema — new optional fields
{
	// ── Decision fields (for type: "decision") ──
	"context": "string", // "Why this decision was made"
	"rationale": "string", // "Reason for choosing this option"
	"alternatives": "string[]", // "Other options considered"

	// ── Session fields (for type: "task_archive") ──
	"key_decisions": "string[]", // "Important decisions in this session"
	"next_steps": "string[]" // "Next steps"
}
```

**How it works in the handler:**

- If `type === "decision"` and `context`/`rationale` are present → auto-format into content with the structure:
  ```
  ## Context
  {context}
  ## Rationale
  {rationale}
  ## Alternatives
  - {alternatives}
  ```
- If `type === "task_archive"` and `key_decisions`/`next_steps` are present → auto-format into content with the structure:
  ```
  ## Key Decisions
  - {key_decisions}
  ## Next Steps
  - {next_steps}
  ```
- If no structured fields are present → content as usual

### `agent-context` — Token-budgeted context compiler

`agent-context` remains the single read surface, but now compiles bounded context from memories, decisions, active tasks, pending handoffs, coding standards, fresh evidence-backed observations, and indexed code pointers. It is deterministic for the same stored state and inputs and does not invoke model sampling.

```jsonc
{
	"objective": "string", // Preferred NL objective; query remains backward-compatible
	"task_code": "string", // Pin an in-scope task as critical context
	"current_file_path": "src/example.ts", // Enables indexed code pointers
	"budget": { "tokens": 2000, "max_items": 20, "code_depth": 1 },
	"sources": ["memories", "decisions", "tasks", "handoffs", "standards", "observations", "code"],
	"include_stale": false,
	"type_filter": "enum",
	"limit": 5, // Legacy memories/decisions projection cap
	"repo": "string",
	"owner": "string (auto)",
	"json": true
}
```

The structured response preserves the legacy `memories`, `decisions`, and `tasks` arrays and adds:

- `context[]`: selected compact items with source, id, text, provenance, and estimated token cost.
- `allocation`: included/excluded counts and per-source accounting.
- `exclusions[]`: candidates omitted by token or item budget.
- `estimated_tokens` and the normalized `budget`.

Token counts use a deterministic character-based estimate rather than pretending to be an exact tokenizer measurement. Every source adapter is bounded before ranking; evidence and source files are represented as pointers, not raw source dumps.

## Consequences

**Positive:**

- Tool count drops: 3 → 1
- Schema size drops: 1,934 → ~515 chars (-73%)
- Single write path: memory-write (no separate shortcuts)
- Agents only need to know 1 tool for context

**Negative:**

- The memory-write schema grows by 5 fields (but all optional)
- Agents must remember type="decision" for decision-log, type="task_archive" for session summary

## Related ADRs

- ADR-001 (Memory) — memory-write is the primary write path
- ADR-002 through ADR-006

## Implementation Plan

1. **REFACTOR-AC-001:** Add decision-log fields (context, rationale, alternatives) to memory-write handler + auto-format logic
2. **REFACTOR-AC-002:** Add session-summarize fields (key_decisions, next_steps) to memory-write handler + auto-format logic
3. **REFACTOR-AC-003:** Remove decision-log and session-summarize from definitions + cleanup
4. **REFACTOR-AC-004:** Update integration tests
