# ADR-005 — Codebase Index Simplification

**Date:** 2026-07-27
**Status:** Proposed
**Deciders:** Muhammad Rheza Alfín

> **IMPLEMENTED (verified 2026-08-08):** shipped as `codebase-index` (index via `repoPath`+`repo`; status via `repo` only) and `codebase-read` (name→trace, filePath→file symbols, query→search, none→architecture). Search unifies symbol + NL semantic ranking (5-tier `rankSymbols` + vector blend 0.30/0.70). The 6 legacy read tools (`index_repository`, `index_status`, `search_symbols`, `codebase_search`, `trace_symbol`, `get_file_symbols`, `get_architecture`) no longer exist in the 20 canonical tool set.

## Context

The Codebase Index domain currently has **7 tools**:

- `index_repository` (495 chars), `index_status` (242 chars)
- `get_architecture` (331 chars), `get_file_symbols` (234 chars)
- `search_symbols` (583 chars), `codebase_search` (519 chars)
- `trace_symbol` (385 chars)
- **Total: ~2,789 chars / 7 tools**

This domain is dominated by read operations (6 of 7 tools). Only `index_repository` is a write. `search_symbols` and `codebase_search` overlap — they differ only in the number of filters.

## Decision Drivers

- **Simple for weak agents**: just 3 mutually-exclusive parameters: `name` / `query` / `filePath`
- **Consistent pattern**: `codebase-index` for management, `codebase-read` for exploration
- **Zero oneOf**: auto-infer from which parameter is provided

## Decision Outcome

**Chosen option:** 2 tools — codebase-index, codebase-read

### New Tools

| Tool             | Covers                                                                                | Estimated Schema        |
| ---------------- | ------------------------------------------------------------------------------------- | ----------------------- |
| `codebase-index` | index_repository + index_status                                                       | ~450 chars              |
| `codebase-read`  | search_symbols + codebase_search + trace_symbol + get_file_symbols + get_architecture | ~1,100 chars            |
| **Total**        | **from 7 tools / 2,789 chars**                                                        | **~1,550 chars (-44%)** |

### Auto-infer Rules

#### `codebase-index`

| Input                          | Detect        | Action                               |
| ------------------------------ | ------------- | ------------------------------------ |
| `repoPath` + `repo`            | Path provided | **Index** — trigger tree-sitter scan |
| `repo` only (without repoPath) | Repo only     | **Status** — check freshness + count |

#### `codebase-read`

| Input                          | Mental Model Agent                              | Action                                                |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------------- |
| `name: "UserService"`          | "I know the symbol name"                        | **Trace** — definition + references + export chain    |
| `query: "find login function"` | "I want to search for something"                | **Search** — unified ranking + NL search              |
| `filePath: "src/auth.ts"`      | "I want to see the file contents"               | **File symbols** — all symbols in the file            |
| (nothing)                      | "What does this project's structure look like?" | **Architecture** — tree overview + language breakdown |

### `codebase-read` Schema

```jsonc
{
	// 3 mutually-exclusive params — agent fills in one
	"name": "string", // → trace
	"query": "string", // → search
	"filePath": "string", // → file symbols

	// Optional filters
	"kind": "string", // function | class | variable | ...
	"exportedOnly": "boolean",
	"depth": "number (2)", // for architecture mode
	"limit": "number (50)",

	"repo": "string",
	"owner": "string (auto)",
	"json": "boolean"
}
```

## Consequences

**Positive:**

- Tool count drops 7 → 2
- Schema size drops ~44% (2,789 → ~1,550 chars)
- 3 mutually-exclusive parameters: the agent only fills in 1 of 3
- No mode/oneOf — auto-infer from the provided fields
- `search_symbols` and `codebase_search` are merged — no need to distinguish them

**Negative:**

- Internal search must be unified: if the query contains code-like terms → symbol ranking; if natural language → semantic
- Backward compatibility — legacy clients need to migrate

## Related ADRs

- ADR-001 up to ADR-004

## Implementation Plan

1. **REFACTOR-CI-001:** Implement `codebase-index` handler — index + status, infer from presence/absence of repoPath
2. **REFACTOR-CI-002:** Implement `codebase-read` handler — trace/search/fileSymbols/architecture, infer from name/query/filePath
3. **REFACTOR-CI-003:** Register 2 tools + remove old 7 definitions + update router + cleanup
4. **REFACTOR-CI-004:** Update integration tests
