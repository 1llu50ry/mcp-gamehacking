# SPEC-001 — Unified NL Query

**Date:** 2026-07-27
**Status:** Proposed

> **IMPLEMENTED (verified 2026-08-08):** the 40/30/15/15 formula is the canonical scoring engine — `HYBRID_WEIGHTS = { similarity: 0.4, keyword: 0.3, recency: 0.15, domain: 0.15 }` (src/mcp/utils/constants.ts) and `scoreHybrid` in src/mcp/utils/hybrid-search.ts. Vector embeddings ship for memory (v06/memory_vectors), standards (standard_vectors), tasks (migration v07 task-vectors), codebase symbols (v06 codebase_symbols_vectors; symbols FTS v18). `task-write` vector embedding (TASK-007) and `task-read` hybrid search (TASK-008) are implemented. `codebase-read` vector tier (CI-005 → 0.30 vector / 0.70 tier blend) and `agent-context` query→vector (AC-005) are implemented.
>
> **NEXT PHASE — MEM-009 / STD-006 (backlog, priority 3):** the two "standardisasi formula" items remain open in the task list below — hybrid formulas are unified in code (`scoreHybrid`) for memory/task/standard, so these two entries are effectively superseded by the shared engine; confirm official close in a future release.

## Goal

All read tools that manage **knowledge** (memory, task, standard, codebase, agent-context) use a uniform hybrid scoring formula. Write tools automatically generate vector embeddings for new data.

## Hybrid Formula (UNIFORM)

```
score = (vector_similarity × 0.40)
      + (keyword_score      × 0.30)
      + (recency_boost      × 0.15)
      + (domain_boost       × 0.15)
```

### Components

| Component             | Weight | How It Is Calculated                                                  |
| --------------------- | ------ | --------------------------------------------------------------------- |
| **vector_similarity** | 0.40   | Cosine similarity of the vector embedding (all-MiniLM-L6-v2, 384-dim) |
| **keyword_score**     | 0.30   | FTS5 match score / LIKE relevance / code ranking tier                 |
| **recency_boost**     | 0.15   | `min(1, days_since_update / 30)` — the newer, the higher              |
| **domain_boost**      | 0.15   | Tags match, language match, workspace affinity (file path, branch)    |

### Adaptive Threshold

> **CORRECTED (verified 2026-08-08):** shipped thresholds differ per domain (src/mcp/utils/constants.ts `SEARCH_THRESHOLDS`) — memory `{ smallSet: 0.10, largeSet: 0.40 }`, task `{ smallSet: 0.08, largeSet: 0.20 }`, standard `{ smallSet: 0.08, largeSet: 0.20 }`. The 0.08/0.20 values in the table below match task/standard only, not memory. The "least 1 result" guarantee is implemented (guarantee-at-least-1 in hybrid-search.ts).

| Condition      | Threshold      |
| -------------- | -------------- |
| Results ≤ 5    | 0.08 (lenient) |
| Results > 5    | 0.20 (strict)  |
| Minimum return | 1 top result   |

### Uniform Parameters

```jsonc
{
	"query": "string", // NL query (semantic + keyword)
	"limit": "number (default 5)",
	"offset": "number (default 0)",
	"include_archived": "boolean",

	"repo": "string",
	"owner": "string (auto)",
	"json": "boolean"
}
```

## Vector Embedding — Per Domain

| Write Tool       | Embed Content                         | Trigger         | Status          |
| ---------------- | ------------------------------------- | --------------- | --------------- |
| `memory-write`   | content (full)                        | Create & update | ✅ Yes          |
| `standard-write` | name + content + context + stack      | Create & update | ✅ Yes          |
| `task-write`     | title + description                   | Create & update | ❌ Not yet      |
| `codebase-index` | symbol name + signature + doc_comment | Index/re-index  | ✅ Yes          |
| `agent-context`  | —                                     | —               | N/A (read-only) |

## Changes Per Domain

### 1. task-write → generate vector embedding

**In the `task.write.ts` handler:**

```typescript
// After a successful insert/update
if (content || title) {
	await vectors
		.upsert(taskId, `${title}\n${description}`, "task")
		.catch((e) => logger.warn("Vector upsert failed for task", e));
}
```

### 2. task-read → hybrid search upgrade

**In the `task.read.ts` handler:**

```
Current:        FTS5 → LIKE → pagination
Upgrade:        Vector search → hybrid score → FTS5 fallback → same output
```

Pattern identical to the one already in `memory-read`:

1. `searchBySimilarity(query, filters)` → vector candidates
2. If results < threshold → FTS5 fallback
3. Hybrid scoring 4 components
4. Adaptive threshold

### 3. codebase-read → vector tier

**In the `codebase.read.ts` handler:**

```
Current:        FTS5 → 5-tier ranking (exact/camelCase/prefix/substring/FTS5)
Upgrade:        Vector → [existing 5-tier] → hybrid score
```

The vector becomes an additional tier in `rankSymbols()`:

- Vector score = cosine similarity (0-1)
- Final score = (vector × 0.30) + (existing_tier_score × 0.70)

### 4. agent-context → query + vector

**In the `agent-context.ts` handler:**

- Rename parameter `objective` → `query`
- If `query` is present → vector search (replacing the keyword `searchByRepo`)
- If `query` is absent → `getRecentMemories` (same as before)
- Same hybrid scoring

### 5. Standardize the formula in memory-read & standard-read

Both domains already have hybrid scoring, but the formulas need to be unified:

| Component         | Existing memory-read | Existing standard-read | Unified  |
| ----------------- | -------------------: | ---------------------: | :------: |
| vector_similarity |                 0.40 |                   0.40 | **0.40** |
| keyword_score     |                    — |                   0.30 | **0.30** |
| recency_boost     |                    — |                      — | **0.15** |
| usage_boost       |                    — |                   0.05 |    —     |
| domain_boost      |                    — |         0.25 (keyword) | **0.15** |
| importance        |                 0.20 |                      — |    —     |

## Unified Output

```jsonc
{
	"schema": "{domain}-search",
	"query": "string",
	"count": 5,
	"total": 12,
	"offset": 0,
	"limit": 5,
	"results": {
		"columns": ["id", "code", "title", "type", "score", "confidence"],
		"rows": [["...", "...", "...", "...", 0.85, "high"]]
	},
	// Additional: KG context
	"kg": {
		"entities": [{ "name": "...", "type": "...", "source_domain": "..." }],
		"relations": [{ "from": "...", "to": "...", "type": "..." }]
	}
}
```

**Confidence tiers**: high (≥0.70), medium (≥0.40), low (<0.40)

## Task List

### Task Domain (REFACTOR-TASK)

- ~~**TASK-007:** Generate vector embedding in task-write (title + description → vectors.upsert)~~ ✅
- ~~**TASK-008:** Upgrade task-read to hybrid search (vector + FTS5 + unified formula)~~ ✅

### Codebase Index Domain (REFACTOR-CI)

- ~~**CI-005:** Add vector tier to codebase-read ranking (5-tier existing + vector)~~ ✅

### Agent Context Domain (REFACTOR-AC)

- ~~**AC-005:** Rename objective→query, upgrade to hybrid vector search~~ ✅

### Memory & Standard (REFACTOR-MEM, REFACTOR-STD)

- **MEM-009:** Standardize the hybrid formula in memory-read to the unified formula (backlog — priority 3)
- **STD-006:** Standardize the hybrid formula in standard-read to the unified formula (backlog — priority 3)

### Testing

- **INTEGRATION-001:** Test hybrid search in all domains — formula consistency ✅ (5 tests added)
