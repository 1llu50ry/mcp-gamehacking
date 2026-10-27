# ADR-001 — Memory Domain Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfin

> **IMPLEMENTED (verified 2026-08-08):** the 3-tool + auto-infer design shipped as the canonical domain — `memory-write` (create/update/acknowledge/bulk via `memories[]`), `memory-read` (search/detail/recap), `memory-delete` (single/bulk). `synthesize` and `repo-summarize` exist as standalone Agent Context tools. The 9 legacy tools (`memory-store`, `memory-search`, `memory-detail`, `memory-recap`, `memory-acknowledge`, `memory-update`, `memory-summarize`, `memory-synthesize`, `memory-delete`) are removed from the 20 canonical tool set (src/mcp/types/tool-definitions).

## Context

The Memory domain currently has **9 MCP tools**, each with its own JSON Schema inputSchema:
`memory-store`, `memory-update`, `memory-search`, `memory-delete`, `memory-detail`, `memory-recap`, `memory-summarize`, `memory-synthesize`, `memory-acknowledge`.

The total schema size reaches **~8,658 chars** sent to the agent (LLM) every time `tools/list` is called. This weighs down the context, especially for lower-intelligence agents that struggle to pick a tool from many options.

Analysis shows:

- `memory-summarize` is not a memory operation — it writes to the `summaries` table (a separate entity)
- `memory-synthesize` is a composite orchestration that calls LLM sampling — not a pure memory operation
- `memory-detail` and `memory-recap` are read variants of `memory-search`
- `memory-acknowledge` is a specialized update
- Several tools have `oneOf`, `enum`, and `required` parameters that make things harder for weak agents

## Decision Drivers

- **Weak agents must be able to use it**: obvious tool names, all parameters optional, tool infers intent automatically
- **Save tokens**: total schema size must drop drastically
- **Zero oneOf/mode**: no `mode` parameter or discriminated union — the agent just provides the relevant fields
- **Bulk support**: write and delete must support bulk operations (create + update + acknowledge in a single `memories[]` array)
- **Partial execution**: bulk error handling is partial — failed items are skipped, errors are returned as a list

## Considered Options

1. **9 separate tools** (status quo) — each has a small schema, but many tools add overhead
2. **5 tools** — partial consolidation (merge detail+search, ack+update, rename summarize)
3. **3 tools + auto-infer** — `memory-write`, `memory-read`, `memory-delete` with intent inference from the provided fields

## Decision Outcome

**Chosen option:** 3 tools + auto-infer (option 3)

**Rationale:**

- Most token-efficient: ~2,850 chars vs 8,658 (saving **67%**)
- Zero `oneOf`/`mode` — the tool infers intent from the combination of provided fields
- Weak agents only need to know 3 tool names: write, read, delete
- The unified `memories[]` array handles bulk create, bulk update, and bulk acknowledge in a single structure
- Partial execution makes bulk operations more resilient

### Mapping Detail

| New Tool        | Covers                                                | How to Infer                                                                                   |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `memory-write`  | `memory-store`, `memory-update`, `memory-acknowledge` | `content` → create; `id`+`acknowledge` → acknowledge; `id`+field → update; `memories[]` → bulk |
| `memory-read`   | `memory-search`, `memory-detail`, `memory-recap`      | `query` → search; `id`/`code` → get detail single; `ids`/`codes` → detail bulk; empty → recap  |
| `memory-delete` | `memory-delete` (existing)                            | `id`/`code` → single; `ids`/`codes` → bulk                                                     |

### Tools Moved

| Tool                                  | New Domain    | Reason                                        |
| ------------------------------------- | ------------- | --------------------------------------------- |
| `memory-synthesize` → `synthesize`    | Agent Context | Composite orchestration, require LLM sampling |
| `memory-summarize` → `repo-summarize` | Agent Context | Operation on the summaries table, not memory  |

## Consequences

**Positive:**

- Tool overhead drops from 9 → 3 (saving 6 names + descriptions from context)
- Schema size drops ~67% (8,658 → ~2,850 chars)
- Weak agents only need to memorize 3 tool names
- No `required` parameters — all optional, the tool infers on its own
- Unified bulk (`memories[]`) reduces cognitive load: 1 structure for create + update + ack

**Negative:**

- The `memory-write` schema is larger than the previous `memory-store` schema (~1,400 vs ~2,406 chars, but that is because it covers 3 tools)
- Auto-infer adds internal handler complexity (logic to distinguish create vs update)
- Breaking change: clients calling `memory-store`, `memory-update`, etc. must migrate to `memory-write`
- The legacy router needs to maintain backward-compat aliases

**Neutral:**

- `synthesize` and `repo-summarize` remain as separate tools in the Agent Context domain — not removed

## Alternatives Considered

### 5 tools (option 2)

Keeps `memory-search` standalone, `memory-store` standalone, and merges the rest.

- **Pros:** More gradual transition, smaller per-tool schemas
- **Cons:** Still 5 tool names weak agents must learn; not as efficient as 3 tools

### Status quo — 9 tools (option 1)

- **Pros:** Familiar, full backward compatibility
- **Cons:** 8,658 chars in context; 9 tool names; weak agents often pick the wrong tool; many `required` parameters

## Implementation Plan

1. **memory-write:** New handler that combines store + update + acknowledge. Supports single via field inference, supports bulk via `memories[]`. Partial execution for bulk errors.
2. **memory-read:** New handler that combines search + detail + recap. Infers from the presence/absence of `query` or `id`.
3. **memory-delete:** Minimal refactor — add support for `code` params and bulk codes.
4. **Register & router:** Update `registerAllTools` and the legacy router. Maintain backward-compat aliases.
5. **Remove old definitions:** Remove the 6 tool definitions that were merged from `MEMORY_TOOL_DEFINITIONS`.
6. **Move synthesize & summarize:** Move them to the Agent Context domain.
7. **Test:** Update integration tests to match the new tools.
