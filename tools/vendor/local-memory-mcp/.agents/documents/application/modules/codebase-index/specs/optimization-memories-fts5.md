# Design: FTS5 Full-Text Search for Memories

> **Status: ✅ IMPLEMENTED (verified 2026-08-08).** This design shipped via migration **`v10-memories-fts`** (TASK-014) — the schema index is now at **`SCHEMA_VERSION 24`** (`src/mcp/storage/migrations/index.ts`). The original "not yet implemented" header below is preserved as the historical record; inline notes mark where the ship deviates from the design (notably: the migration landed as **v10**, not the proposed v8).

- **Task**: TASK-003 (optimization) · **Decision memory**: MEM-367 · **Implementation**: TASK-014
- **Repo**: vheins/local-memory-mcp · **Scope**: design + shipped implementation note

## 1. Overview

Memory search currently performs `LIKE '%q%'` full scans on `content`/`title`/`tags` in two hot paths:

| Path                       | Location                                          | Issue                                                                                                           |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `searchByRepo`             | `src/mcp/entities/memory/entity.ts:173-191`       | `(content LIKE ? OR title LIKE ? OR tags LIKE ?)` — full table scan per call (used by `agent-context.ts:53-69`) |
| `listMemoriesForDashboard` | `entity.ts:404-496` (search at :480, tag at :464) | `(title LIKE ? OR content LIKE ?)` + `tags LIKE ?` — full scan per dashboard/resource request                   |

The codebase already has the established FTS5 pattern to follow: `codebase_symbols_fts` (external-content table + triggers, `migrations.ts:330-350`) and `coding_standards_fts` (full pattern incl. backfill, `migrations.ts:672-706`). A `memories_fts` table **existed and was dropped** in migration v1 (`dropObsoleteMemoriesFts`, `migrations.ts:760-776`) — so the FTS5 extension is confirmed compiled into the bundled SQLite (better-sqlite3), and the legacy table/trigger names are free for reuse on both fresh and upgraded databases.

This design recreates `memories_fts` as an additive migration, wires the two read paths to it with a permanent LIKE fallback (mirroring `codebase-symbol.ts:69-256`), and feeds a normalized `bm25()` score into the existing SPEC-001 hybrid blend in `src/mcp/tools/memory.read.ts` (weights 0.40/0.30/0.15/0.15, `memory.read.ts:49-54`) the same way `standard-read/search.ts:229-251` feeds its text keyword score.

> **Implemented (verified against `src/`):** `memories_fts` lives at migration **v10** (`src/mcp/storage/migrations/v10-memories-fts.ts`); `buildFtsMatchQuery` is in `src/mcp/utils/fts.ts`; `searchByFts` / `searchByFtsScored` / the dashboard FTS fast path live in `src/mcp/entities/memory/search.ts`; the min-max-normalized bm25 score feeds the 0.30 keyword weight in `src/mcp/tools/memory.read.ts` (FTS-only hits are also merged as extra candidates). The `tags` "filter" for the dashboard remains a LIKE predicate (design §5.3).

## 2. Schema

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, content, tags,
  content='memories',
  content_rowid='rowid'
);
```

### Column mapping decisions

| FTS column | Source (`memories`)                       | Type               | Notes                                                                                                                                       |
| ---------- | ----------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`    | `title TEXT` (nullable)                   | tokenized, indexed | NULL → no tokens (fine)                                                                                                                     |
| `content`  | `content TEXT NOT NULL`                   | tokenized, indexed | Primary search surface                                                                                                                      |
| `tags`     | `tags TEXT` (JSON array string, nullable) | tokenized, indexed | `unicode61` treats `[`, `]`, `"`, `,` as separators → each tag becomes an indexable token (e.g. `["data","pipeline"]` → `data`, `pipeline`) |
| _(rowid)_  | `memories.rowid`                          | join key           | `content_rowid='rowid'`; `memories` has a TEXT PK so the hidden `rowid` is available — same as `codebase_symbols` (`migrations.ts:331`)     |

### Rejected options (with rationale)

- **`repo`/`owner`/`type`/`status` as `UNINDEXED` columns**: **No.** Every filter/display field is already fetched or filtered via the `JOIN memories m ON m.rowid = fts.rowid` (same as `codebase-symbol.ts:180-187` and `standard.ts:220-227`). Existing indexes (`idx_memories_owner_repo_type`, `idx_memories_status`, … `migrations.ts:714-720, 542`) make the join cheap. Unindexed columns would duplicate data, drift when `memories` gains columns, and add no query-plan benefit.
- **`trigram` tokenizer**: **No (default to `unicode61`).** Justification below.

### Tokenizer choice: `unicode61` (default) + per-term prefix `*`

Search patterns observed: single keyword, multi-keyword, partial words, tags, technical identifiers (MEM-365, TASK-003 context). Rationale:

1. **Consistency**: symbols and standards both use the default `unicode61` (`migrations.ts:330-332, 672-676`). One tokenizer behavior across all three FTS tables.
2. **`LIKE %q%` parity**: the dominant recall pattern is _token-initial_ substring (`"vec"` → `"vector"`, `"fts"` → `"fts5"`). `unicode61` + appending `*` to every term (`vec*`) reproduces this through the prefix index — the standard FTS5 idiom.
3. **`trigram` cost**: matches _any_ mid-word substring (true LIKE parity) but (a) cannot do stemmed/whole-token phrase semantics, (b) roughly doubles index size, (c) doesn't change the CJK story fundamentally (it gives CJK substring match, but see §7), and (d) would be the _only_ table in the DB using it — a maintenance split. Defer as a follow-up evaluation if recall parity on mid-word substrings becomes a real requirement; the design is insulated by the permanent LIKE fallback.
4. **CJK**: `unicode61` keeps a contiguous CJK run as one token (no segmentation), but prefix matching still works (`数*` matches a token starting `数`). Acceptable for the v1, documented in §7; `trigram` is the documented escalation path if CJK recall proves insufficient.

## 3. Triggers

Mirror the exact shape of the symbol triggers (`migrations.ts:334-349`) and standard triggers (`migrations.ts:678-693`): `{table}_ai/_ad/_au`, using `new.rowid`/`old.rowid`, delete-then-insert for updates.

```sql
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
  VALUES('delete', old.rowid, old.title, old.content, old.tags);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
  VALUES('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO memories_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;
```

**Trigger-name safety**: the legacy `memories_ai/_ad/_au` + `memories_fts` were dropped unconditionally in migration v1 (`dropObsoleteMemoriesFts`, `migrations.ts:760-776`), which runs before any new migration on every database (fresh and upgraded). Names are provably free. Keep the conventional names for consistency.

**Coverage of write paths** — triggers are DB-level, so they cover every mutation automatically, including:

- `insert`/`update`/`bulkInsertMemories`/`bulkUpdateMemories` (`entity.ts:7-94, 193-293`)
- `archiveExpiredMemories`/`archiveLowScoreMemories` (status `UPDATE`, `memory.archive.ts:19-39`) — reindexes with identical content; archived rows stay in FTS but are excluded at query time via the join (see §4)
- `bulkDeleteMemories` (`memory.archive.ts:4-17`) — delete trigger removes from FTS

**Important**: FTS must _not_ filter `status='active'`/`expires_at` — that stays in the `JOIN` predicate, so archived/expired rows are invisible to search while remaining indexable if reactivated.

## 4. Migration & Backfill

### 4.1 Additive migration — **shipped as v10** (proposed as v8)

> The `MigrationManager` now lives in `src/mcp/storage/migrations/index.ts` with one file per version (`vNN-*.ts`); `SCHEMA_VERSION = 24`. The shipped migration is **`v10-memories-fts`**, not the v8 proposed below (v8 was repurposed for `observations` index, v9 for the embedding `queue_jobs` table).

- `SCHEMA_VERSION` moved 7 → **10** at ship time (`src/mcp/storage/migrations/index.ts:29` — now 24).
- A new entry was appended to the `MIGRATIONS` array. **Never edit** existing entries — the chain is append-only and `MigrationManager` skips applied versions.
- The `up()` guard mirrors v4 (`v04-coding-standards-fts.ts`):

```ts
{
  version: 8, // ⚠️ SHIPPED AS VERSION 10 — see v10-memories-fts.ts
  name: "memories-fts",
  up: (db) => {
    const ftsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
    ).get();
    if (ftsExists) { logger.debug("[Migration] memories_fts already exists, skipping"); return; }
    db.exec(`<CREATE VIRTUAL TABLE ... > <CREATE TRIGGER memories_ai ...> <CREATE TRIGGER memories_ad ...> <CREATE TRIGGER memories_au ...>`);
    // backfill (below)
  }
}
```

### 4.2 Backfill

Preferred — **single-statement backfill inside the migration transaction**, exactly like v4 (`v04-coding-standards-fts.ts`):

```sql
INSERT INTO memories_fts(rowid, title, content, tags)
SELECT rowid, title, content, tags FROM memories;
```

- The migration runner wraps each `up()` in `db.transaction` (`src/mcp/storage/migrations/index.ts`), so table-create + triggers + backfill + `_schema_version` row commit atomically. A crash mid-migration rolls back; on restart the version is absent and it re-runs (the `ftsExists` guard makes it idempotent).
- **Batch-size / lock interaction** (`storage/write-lock.ts`): migrations run in the `SQLiteStore` constructor (`sqlite.ts:91-92`), **outside** the cross-process file lock (`withWrite`, `write-lock.ts:62-69`; lock is per-write-operation, not per-startup). This is a pre-existing property shared by migrations v1–v7 — not new risk. Mitigations, in order:
  - The backfill is **one atomic statement** (better-sqlite3 + WAL + `busy_timeout = 30000`, `sqlite.ts:76-79` serializes a concurrent writer; the other process's write blocks ≤30 s, then commits, then this statement sees it — triggers on the other process's writes keep FTS in sync regardless).
  - Typical scale: memories are thousands of rows → single statement is fine.
  - **Only if** a database exceeds ~50k memories: chunk the backfill in `rowid` ranges of 500 (`WHERE rowid > ? AND rowid <= ?` inside the same transaction) — each chunk is still atomic; the write-lock concern is identical to `bulkUpdateMemories`'s chunked pattern (`entity.ts:280-292`).
- **Rebuild utility** (also the backfill-recovery path if a corrupted index is suspected): `INSERT INTO memories_fts(memories_fts) VALUES('rebuild');` — repopulates from `memories` (external content). Can live in the migration file as a comment or be exposed later by an ops tool; not wired into any tool in this scope.

**Post-migration verification**: `SELECT COUNT(*) FROM memories` vs `SELECT COUNT(*) FROM memories_fts` must be equal (NULL `title`/`tags` rows still produce a rowid entry with empty tokens).

## 5. Query Rewiring

### 5.1 Query-builder helper — `buildFtsMatchQuery(raw: string): string`

✅ **Implemented** in `src/mcp/utils/fts.ts` (with `sanitizeFtsTerm` and the `FTS_MAX_TERMS = 8` / `FTS_CANDIDATE_CAP = 100` constants). Semantics:

1. Trim. Empty → return `""` (caller falls back to non-FTS path).
2. Extract balanced double-quoted phrases: `/"([^"]+)"/g` → keep each as a phrase token verbatim (validated: phrase content must contain only letters/digits/spaces/`_` after sanitize, else drop).
3. For every remaining whitespace-separated term: strip FTS5 metacharacters (char class `[^\p{L}\p{N}_]` → removed), append `*` for prefix matching, drop empty results.
4. Join phrase tokens + prefixed terms with explicit `AND`. Cap at 8 terms (guard against pathological queries).
5. Result empty → return `""` (fallback to LIKE).

Examples: `"data pipeline"` → `"data pipeline"`; `optimize query` → `optimize* AND query*`; `fts5` → `fts5*`; `"data" etl` → `"data" AND etl*`.

### 5.2 `searchByRepo` (`entity.ts:173-191`)

Structure mirrors `codebase-symbol.ts:69-79` (`tryFtsSearch` → `likeSearch` fallback):

```
if (query.trim() === "")  → existing non-FTS SQL, minus the LIKE clause
                            (owner/repo/status/expiry/type, ORDER BY importance DESC, created_at DESC)
else:
  try FTS fast path → if rows returned, use them; on throw or empty → LIKE fallback (existing SQL unchanged)
```

FTS fast path (preserves the current filters exactly — expired-memory test `sqlite.test.ts:225-241` must still pass):

```sql
SELECT m.*
FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ?                 -- buildFtsMatchQuery(query)
  AND (m.owner = ? AND) m.repo = ?         -- ownerClause optional (entity.ts:175)
  AND m.status = 'active'
  AND (m.expires_at IS NULL OR m.expires_at > ?)
  AND m.type = ?                           -- optional
ORDER BY bm25(memories_fts)                -- most relevant first
LIMIT ?;
```

- **Ordering decision**: current code orders by `importance DESC, created_at DESC` regardless of match quality. For a _search_ path (agent-context retrieval), relevance (`bm25`) is the correct primary key, with the option `ORDER BY bm25(memories_fts), m.importance DESC, m.created_at DESC` to blend. If strict behavioral parity is required by reviewers, `ORDER BY m.importance DESC, m.created_at DESC` is the drop-in — noted as a one-line choice at implementation.
- Empty-query path stays a plain indexed scan (`idx_memories_owner_repo`), so zero-search queries never touch FTS.

### 5.3 `listMemoriesForDashboard` (`entity.ts:404-496`)

When `options.search` is present, replace the `(title LIKE ? OR content LIKE ?)` clause (`:480`) with the FTS join; all other filters (`owner/repo/type/isGlobal/importance`) stay as `m.*` predicates on the join. `tag` filter (`:464`) **stays as `m.tags LIKE ?`** — it is an exact-ish substring filter and FTS token matching on the JSON array would change semantics (`tags LIKE '%my-tag%'` can match a multi-word substring that FTS would split).

```sql
-- count (parity: total = full filtered count, not just returned page)
SELECT COUNT(*) FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ? AND <owner/repo/type/is_global/importance/tag predicates>;

-- data
SELECT m.*, CASE WHEN m.hit_count > 0 THEN CAST(m.recall_count AS REAL) / m.hit_count ELSE 0 END AS recall_rate
FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ? AND <same predicates>
ORDER BY m.<sortBy> <sortOrder>           -- allowlist already enforced (:438-448)
LIMIT ? OFFSET ?;
```

### 5.4 MATCH query shapes (reference)

| Intent                      | User input          | `MATCH` expression         |
| --------------------------- | ------------------- | -------------------------- |
| Single keyword              | `fts5`              | `fts5*`                    |
| Multi-keyword AND (default) | `data pipeline`     | `data* AND pipeline*`      |
| Explicit AND                | `data AND pipeline` | `data* AND pipeline*`      |
| OR                          | `data or pipeline`  | `data* OR pipeline*`       |
| Phrase                      | `"data pipeline"`   | `"data pipeline"`          |
| Prefix (partial word)       | `opti`              | `opti*`                    |
| Tags only (if ever needed)  | —                   | `tags:data*`               |
| Tags compose with text      | —                   | `data* AND tags:pipeline*` |

### 5.5 Out of scope (verified — **do not** rewire)

- `memory.vector.ts:44` `tags LIKE ?` — vector-candidate _pre-filter_, not free-text search; leave.
- `task/entity.ts:215,258,305,344` — tasks (own LIKE path, different entity; separate future task).
- `code-generator.ts:34`, `dashboard/controllers/KGController.ts:23` — unrelated LIKE sites.
- `codebase-symbol.ts:217-256` LIKE fallback — keep as-is (this is the _pattern_ being copied).

## 6. Hybrid Scoring Integration

### 6.1 FTS keyword score — normalized `bm25()`

Raw `bm25(memories_fts)` is unitless, **non-positive, larger-is-worse** (most negative = best). Normalize to 0..1 per query over the top-k candidate set (k = 100):

```sql
SELECT fts.rowid, bm25(memories_fts) AS b25
FROM memories_fts fts
JOIN memories m ON m.rowid = fts.rowid
WHERE memories_fts MATCH ?
  AND m.owner = ? AND m.repo = ?        -- repo scope (+ is_global = 1 handling, as in searchBySimilarity)
  AND m.status = 'active'
ORDER BY b25
LIMIT 100;
```

Normalization (in `memory.read.ts` or a helper in `utils/fts.ts`):

```
minB = min(b25 over set); maxB = max(b25 over set)
score = (maxB == minB) ? 1.0 : 1 - (b25 - minB) / (maxB - minB)
```

Best match (most negative) → 1.0; worst in set → ≈ 0. Self-contained per query — no global statistics required, no calibration drift. Missing id → 0 (same as current `vectorScoreMap.get(id) ?? 0`, `memory.read.ts:174`).

### 6.2 Where it plugs into `memory.read.ts` (mirror `standard-read/search.ts`)

`standard-read/search.ts` computes `keywordScore = scoreKeywordRelevance(...)` (a text scan) and multiplies by `HYBRID_WEIGHTS.keyword = 0.30` (`search.ts:231-240`); vector similarity enters via `candidate.similarity` and the ONNX rerank is multiplied by **0** in the main branch (`search.ts:237`) — vectors are only a fallback candidate source when similarity is empty (`search.ts:252-281`).

Mirror that in `memory.read.ts`:

1. **Query source**: use `effectiveQuery` (post-time-tunnel, `memory.read.ts:110`) for the FTS `MATCH` — **not** `expandQuery(...)` output (`:111`). Expansion injects synonyms (`query-expander.ts:5-14`) that would wrongly restrict keyword matches. Keep `searchQuery` (expanded) for the vector/similarity paths and `queryTerms` (`:165`).
2. **Main branch** (`candidates.length > 0`, `:172-190`): replace `keywordScore = vectorScoreMap.get(c.memory.id) ?? 0` (`:174`) with `keywordScore = ftsScoreMap.get(c.memory.id) ?? 0`. Everything else — `recencyScore`, `domainScore`, weight math `:177-181` — unchanged. Optionally fold the ONNX rerank in as a `* 0` term to keep the call site honest, exactly as `search.ts:237`.
3. **Fallback branch** (`:191-213`): when similarity returns zero candidates, source candidates from the FTS top-k (join to `getByIds` like the existing vectorResults branch) with `keywordScore = ftsScoreMap.get(id)`, `similarityScore = 0`, and the same weight redistribution (`remainingWeight` pattern, `search.ts:262-268`).
4. **Error fallback** (`:214-231`): unchanged (keywordScore = 0, weights folded into similarity) — the FTS call is wrapped in the same `try/catch` as the current vector search.
5. Threshold/pagination logic (`:233-247`) untouched. Weights untouched.

Net effect: the `0.30` keyword weight becomes an actual **lexical** signal (bm25 over title+content+tags) instead of an ONNX vector score, which matches the SPEC-001 intent and the standard-read implementation.

## 7. Edge Cases

| Case                                                                           | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Empty query**                                                                | `searchByRepo("")` → skips FTS entirely; plain indexed query ordered by importance (current behavior for `LIKE '%%'` preserved). Dashboard: `search` absent → no FTS branch.                                                                                                                                                                                                                                                                      |
| **All-stopwords / fully-sanitized query** (e.g. `"the ?!?"`, pure punctuation) | `buildFtsMatchQuery` → `""` → LIKE fallback (which returns everything matching `%%`, i.e. current semantics). FTS5 default has **no stopword list** (unlike FTS4), so stopword behavior is only what the sanitizer strips. If a stopword list is ever added, an all-stopword query naturally returns 0 rows → fallback triggers.                                                                                                                  |
| **Special chars: `"` `*` `-` `(` `)` `~` `:` `'`**                             | Stripped per-term by the sanitizer before `*` is appended. `data-pipeline` → `data* AND pipeline*` (hyphen is a `unicode61` separator — same as today's LIKE, which would not match a literal hyphen anyway unless present). Quotes are only honored as explicit balanced phrase groups; unbalanced `"` is stripped and the tokens AND-ed. User-supplied `*` is removed (the `*` is always ours — prevents injection of arbitrary FTS operators). |
| **CJK / latin-mixed content**                                                  | `unicode61`: a CJK run is one token; per-term prefix `数*` still matches. No CJK segmentation (unlike trigram). Acceptable v1; documented escalation: evaluate `trigram` if CJK recall is measured insufficient (index grows ~2×).                                                                                                                                                                                                                |
| **NULL `title` / `tags`**                                                      | Allowed — no tokens produced, rowid entry still present (INSERT trigger passes NULLs through; `content` is NOT NULL).                                                                                                                                                                                                                                                                                                                             |
| **`tags` JSON array**                                                          | Tokenized into individual tag tokens (`unicode61` treats `[",:]` as separators). Used for free-text match; dashboard tag filter intentionally stays on `m.tags LIKE` (§5.3).                                                                                                                                                                                                                                                                      |
| **Archived / expired rows**                                                    | Stay indexed (UPDATE trigger reindexes), excluded by join predicates — no FTS-side filtering, so reactivation requires no reindex.                                                                                                                                                                                                                                                                                                                |
| **FTS error at runtime** (malformed MATCH, table missing)                      | `tryFtsSearch`-style catch → LIKE fallback (`codebase-symbol.ts:155-215` proves this pattern). No hard failure of the tool.                                                                                                                                                                                                                                                                                                                       |

## 8. Rollback Plan

FTS data is **derived** — nothing durable is lost by removal; the `memories` table is the source of truth.

1. **Code**: the LIKE fallback is permanent by design (exactly like `codebase-symbol.ts:77-78`). Reverting = removing the FTS fast-path branches from `searchByRepo`/`listMemoriesForDashboard` and the bm25 keyword score from `memory.read.ts` (revert to `vectorScoreMap`).
2. **Database** (a manual script — no extra migration was needed since the shipped table is v10; there is no v9 rollback entry):

```sql
DROP TRIGGER IF EXISTS memories_ai;
DROP TRIGGER IF EXISTS memories_ad;
DROP TRIGGER IF EXISTS memories_au;
DROP TABLE IF EXISTS memories_fts;
```

3. **Order**: drop triggers first, then the table (avoids FK/trigger-dangling edge cases). No backfill-reverse needed. If a partial revert is wanted (queries keep working but FTS removed), step 2 alone suffices — all query paths fall back to LIKE automatically.
4. **Restore path** (if re-enabled later): re-run v8 (or `INSERT INTO memories_fts(memories_fts) VALUES('rebuild')` on an existing empty table).

## 9. Phased Plan

| Phase                                            | Work                                                                                                                                     | Acceptance criteria                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 — Migration** ✅ shipped (v10)              | Append v10 entry (proposed as v8): create `memories_fts` + 3 triggers + backfill (`SELECT COUNT` guard/log).                             | (a) Fresh DB: migrate to v10 cleanly; `memories_fts` count == `memories` count. (b) Existing v7 DB upgraded in place; migration skipped on second run (idempotent). (c) Round-trip: insert → row in FTS; update title → old tokens gone, new present; delete → row removed. (d) No LIKE rewiring yet — zero behavior change. |
| **P2 — Backfill integrity & rebuild utility** ✅ | Verify parity: for sample queries, FTS candidate sets ⊇ LIKE results on token-initial matches; document `'rebuild'` usage.               | `SELECT COUNT(*)` parity; spot-check token-initial recall vs LIKE; rebuild reproduces identical index (hash of rowid sets).                                                                                                                                                                                                  |
| **P3 — Query rewiring** ✅                       | Add `buildFtsMatchQuery`; rewire `searchByRepo` + `listMemoriesForDashboard` with LIKE fallback.                                         | Existing tests pass: `sqlite.test.ts:225-241` (expired excluded), `agent-context.test.ts:123`, `tasks.bulk.test.ts:488`; dashboard list preserves filters + allowlisted sort; empty-query path untouched; special-char queries fall back gracefully.                                                                         |
| **P4 — Hybrid integration** ✅                   | FTS keyword score (bm25 min-max) replaces the vector score in the 0.30 keyword weight; FTS-only hits merged as extra candidates.         | `memory.read.ts` search returns results with keyword component ≠ 0 for lexical hits; FTS failure → existing error fallback; SPEC-001 weights unchanged; `memory.search.test.ts` / `e2e.e2e.test.ts:35` parity.                                                                                                               |
| **P5 — Hardening & rollback doc** 🔜 NEXT PHASE  | Optionally evaluate `trigram` (measure recall/`EXPLAIN QUERY PLAN` on slow queries), document rollback SQL in the migration file header. | Rollback script verified against a snapshot DB; perf comparison (LIKE vs FTS) recorded in task comment. — **not implemented, deferred**.                                                                                                                                                                                     |

> **Phased status:** P1–P4 shipped and verified in `src/` (migration v10, `utils/fts.ts`, `entities/memory/search.ts`, `tools/memory.read.ts`). P5 (trigram tokenizer evaluation + rollback documentation) is **NEXT PHASE** — not implemented.

**Evidence trail** (historical `migrations.ts` line refs — the file has since been split into `storage/migrations/index.ts` + versioned `vNN-*.ts`): `migrations.ts:330-350` (symbol FTS+triggers, now `v01`), `migrations.ts:672-706` (standard FTS+triggers+backfill, now `v04`), `migrations.ts:760-776` (legacy drop — trigger-name safety, now `v01-helpers`), `migrations.ts:1019-1022` (per-migration transaction, now `index.ts`), `codebase-symbol.ts:69-256` (FTS-first/LIKE-fallback pattern + `sanitizeFtsTerm`), `entity.ts:173-191, 404-496` (rewiring targets, now `entities/memory/search.ts`), `memory.read.ts:49-54, 105-247` (hybrid), `standard-read/search.ts:229-305` (keyword-score mirror), `sqlite.ts:75-92` (pragmas + migration bootstrap), `write-lock.ts` (lock semantics).

## 10. Related artifacts

- Decision memory: `MEM-367` (FTS5 memories search design)
- Implementation task: `TASK-014` (Implement FTS5 memories search per TASK-003 design)
