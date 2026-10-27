# Codebase Index — Operations Guide

> **Architecture decision context:** See [ADR-002: Codebase Index Architecture](../../../design/decisions/adr-002-codebase-index.md) for design rationale.
> **Feature overview:** [Codebase Index Architecture](./specs/design-architecture.md)
> **API Reference:** [Codebase Index API](../../api/codebase-index/api-codebase.md)

> **Note:** Runbook relocated from `application/modules/codebase-index/runbook.md` → `application/modules/codebase-index/runbook.md` (Opsi A).

---

## Overview

The Codebase Index subsystem discovers source files, parses them with tree-sitter WASM, and stores extracted symbols in SQLite. It supports **15 languages** — 14 via tree-sitter grammars (TypeScript/TSX, JavaScript/JSX, Vue, Go, Python, PHP, Rust, Java, Dart, Kotlin, Ruby, Swift, C, and C++) plus a dedicated Markdown visitor (no WASM) — and a generic text fallback for every other extension (JSON, YAML, CSS, shell scripts, etc.).

All codebase data lives in the same `memory.db` database as other application data. See [Backup & Recovery](#6-backup--recovery) for details.

---

## 1. Performance Characteristics

### Benchmarks

| Workload                                | Observed | Target | Notes                                                                                                                                         |
| :-------------------------------------- | :------- | :----- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **First-time index (1K files)**         | ~1.4s    | <10s   | Historical v0.20 synthetic benchmark with a mock parser (isolated pipeline) — no longer claimed.                                              |
| **First-time index (10K files)**        | ~30-60s  | <60s   | End-to-end: discover → compare → parse → store → clean.                                                                                       |
| **Incremental re-index**                | ~1-5s    | <10s   | Only changed files are parsed; an unchanged repo parses 0 files (mtime pre-filter skips without read; checksum confirms ambiguous/new files). |
| **Query response (read tools)**         | <100ms   | <200ms | For projects up to 20K files.                                                                                                                 |
| **`codebase-read` SEARCH**              | <100ms   | <200ms | FTS5-backed with LIKE fallback.                                                                                                               |
| **`codebase-read` ARCHITECTURE**        | <200ms   | <500ms | Symbol aggregation via GROUP BY.                                                                                                              |
| **Incremental re-index (steady state)** | 0 parses | —      | Unchanged files skipped by the mtime pre-filter — no file buffers loaded.                                                                     |

### Pipeline Throughput

| Phase    | Typical Time (10K files) | Scaling Factor                                                                              |
| :------- | :----------------------- | :------------------------------------------------------------------------------------------ |
| DISCOVER | ~2-5s                    | O(n) filesystem walk                                                                        |
| COMPARE  | ~0.5-2s                  | O(n) mtime comparisons (no reads); checksum confirmation only for mtime-ambiguous/new files |
| PARSE    | ~varies                  | Parse only changed/new files; batch = parser concurrency (4 default)                        |
| STORE    | ~5-10s                   | Per-batch flush via `writeParseBatch` (DEFAULT_BATCH_SIZE = 100 rows/transaction)           |
| CLEAN    | ~0.5-1s                  | O(n) stale record deletion                                                                  |

### Key Constants

| Constant                        | Value                                            | File                           | Role                                                            |
| :------------------------------ | :----------------------------------------------- | :----------------------------- | :-------------------------------------------------------------- |
| `DEFAULT_PARSE_TIMEOUT_MS`      | 10,000 (10s)                                     | `parser/worker-pool.ts`        | Max time per file parse                                         |
| `DEFAULT_CONCURRENCY`           | 4                                                | `parser/worker-pool.ts`        | Concurrent WASM parser slots                                    |
| `CONCURRENT_PARSE_BATCH`        | 4 (default; `Math.max(1, resolveConcurrency())`) | `services/parse-pipeline.ts`   | Files per parse batch (bounded by parser concurrency)           |
| `DEFAULT_BATCH_SIZE`            | 100 (env `DEFAULT_BATCH_SIZE`)                   | `utils/constants.ts`           | Rows per DB transaction                                         |
| `MAX_FILE_SIZE_BYTES`           | 10,485,760 (10MB)                                | `services/parse-pipeline.ts`   | Files larger than this are rejected before parse                |
| `MTIME_AMBIGUITY_MARGIN_MS`     | 2,000                                            | `services/indexing-planner.ts` | mtime pre-filter margin (planner)                               |
| `STALENESS_AMBIGUITY_WINDOW_MS` | 2,000                                            | `services/indexing-cache.ts`   | Staleness ambiguity window (checksum confirmation)              |
| `STAT_CONCURRENCY`              | 32                                               | `services/indexing-cache.ts`   | Async stat chunk size in staleness checks                       |
| `CODEBASE_AUTO_INDEX_TTL`       | 86,400,000 (24h, inline)                         | `services/indexing-service.ts` | Stale-index refresh interval (auto-index)                       |
| `retryDbWrite`                  | 3 retries, 1s/2s/4s backoff                      | `services/indexing-cache.ts`   | Lock-error DB write retry (non-lock errors: single 100ms retry) |
| `staleRatio` threshold          | 0.05 (5%)                                        | `services/indexing-cache.ts`   | Repo marked stale only if ≥5% of files changed                  |

### Memory Budget

Memory usage is bounded by the parse batch — it scales with concurrency and the per-file size cap, **not** with repository size:

| Component                    | Bound                                                                                                 |
| :--------------------------- | :---------------------------------------------------------------------------------------------------- |
| In-flight file buffers       | ≤ `CONCURRENT_PARSE_BATCH` (4 default) × ≤ `MAX_FILE_SIZE_BYTES` (10MB) — ~40MB worst case per batch  |
| DB inserts (files + symbols) | Flushed after every parse batch via `writeParseBatch` — the whole repo is never accumulated in memory |
| WASM parser heap             | One `Parser` per concurrent slot; grammar-dependent, independent of repository size                   |

---

## 2. Configuration

### Environment Variables

| Variable                           | Type     | Default                            | Description                                                                                                                                                          |
| :--------------------------------- | :------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODEBASE_AUTO_INDEX`              | `string` | `"true"` (any non-`"false"` value) | Master kill-switch for automatic background indexing on server startup. Set to `"false"` to disable.                                                                 |
| `CODEBASE_AUTO_INDEX_TTL`          | `number` | `86400000` (24h)                   | Time-to-live in milliseconds for fresh-index detection. If the last index was more than this many ms ago, the index is considered stale and a re-index is triggered. |
| `CODEBASE_INDEX_PARSE_CONCURRENCY` | `number` | `4`                                | Number of concurrent tree-sitter WASM parser slots. Increase for faster indexing on high-CPU machines; decrease to reduce memory pressure.                           |
| `CODEBASE_INDEX_PARSE_TIMEOUT_MS`  | `number` | `10000` (10s)                      | Maximum wall-clock time in milliseconds per single file parse. Files exceeding this are marked as failed and the pipeline continues.                                 |
| `DEFAULT_BATCH_SIZE`               | `number` | `100`                              | Rows per DB transaction batch (file/symbol writes). Raise for fewer transaction commits; lower to reduce write-batch memory.                                         |
| `INDEX_STALENESS_TTL_MS`           | `number` | `30000` (30s)                      | Cache TTL for user-facing `index_status` staleness results (reduces repeated filesystem stats). Set `0` to disable caching.                                          |

**Override priority** (applies to all vars): explicit `options` parameter > legacy environment variable > runtime profile default > hardcoded default. `MCP_RUNTIME_PROFILE` supports:

- `minimal`: SQLite and lexical memory/task/handoff/standard operations only; no parser, watcher, maintenance loop, or ONNX startup.
- `balanced`: semantic and indexing engines initialize through a single-flight loader on first demand; no proactive watcher/maintenance.
- `full` (default): preserves the historical zero-config behavior. `CODEBASE_AUTO_INDEX=false` and `ENABLE_FILE_WATCHER=false` still disable their respective proactive paths.

`codebase-index({repo, warmup:true})` explicitly initializes the parser engine. Status mode includes `runtime` with profile, per-capability state/error/duration, and current RSS/heap estimates.

Measured against independent copies of a production-sized SQLite database through the bundled stdio server (`n=3`, median, Apple Silicon):

| Profile    | Initialize response | RSS at initialize | RSS after 4s |
| :--------- | ------------------: | ----------------: | -----------: |
| `minimal`  |              503 ms |            196 MB |       184 MB |
| `balanced` |              472 ms |            200 MB |       190 MB |
| `full`     |            1,095 ms |            405 MB |       225 MB |

The benchmark records process startup only; tool schemas and persistence are identical across profiles. Hardware/model cache affect absolute values, so compare profiles within the same run rather than treating these numbers as universal targets.

### CLI Flag: `--index`

The `--index` flag triggers a one-time indexing operation without starting the MCP server:

```bash
local-memory-mcp --index --repo owner/repo --path /absolute/path/to/repo
```

See the [Codebase Index Architecture](./specs/design-architecture.md) for complete design documentation.

### Performance Optimization Options

The two environment variables below are set through your MCP client's server configuration (not the [env var table](#environment-variables) above — both mechanisms feed the same `indexing-service.ts` logic). The examples use the array-form `command` syntax supported by modern MCP clients (opencode, Claude Desktop, etc.).

#### Option 1: Increase TTL (Reduce Re-index Frequency)

By default, the codebase index is refreshed every 24 hours. For large projects, you can reduce CPU usage by increasing the TTL to 7 days:

```json
"local-memory-mcp": {
  "command": ["npx", "-y", "@vheins/local-memory-mcp@latest"],
  "enabled": true,
  "type": "local",
  "timeout": 120000,
  "environment": {
    "CODEBASE_AUTO_INDEX_TTL": "604800000"
  }
}
```

Value `604800000` = 7 days in milliseconds (7 × 24 × 60 × 60 × 1000).

#### Option 2: Disable Auto-Index on Startup

To eliminate CPU spikes entirely, disable automatic indexing at server startup. You can still trigger indexing manually via `codebase-index(repoPath)` when needed:

```json
"local-memory-mcp": {
  "command": ["npx", "-y", "@vheins/local-memory-mcp@latest"],
  "enabled": true,
  "type": "local",
  "timeout": 120000,
  "environment": {
    "CODEBASE_AUTO_INDEX": "false"
  }
}
```

**Note:** After editing the config, restart the MCP client (opencode/Claude Desktop) for the environment variables to take effect.

---

## 3. Database Schema

All codebase tables are in the same `memory.db` database as other application data. They are created by the migration system on first run.

### `codebase_files`

Stores one row per discovered file.

| Column            | Type      | Description                                            |
| :---------------- | :-------- | :----------------------------------------------------- |
| `id`              | `TEXT`    | UUID primary key.                                      |
| `repo`            | `TEXT`    | Repository identifier (`owner/repo`).                  |
| `file_path`       | `TEXT`    | Relative path from repository root.                    |
| `language`        | `TEXT`    | Detected language (nullable).                          |
| `checksum`        | `TEXT`    | SHA-256 hex digest of file content (nullable).         |
| `lines`           | `INTEGER` | Total line count.                                      |
| `size_bytes`      | `INTEGER` | File size in bytes.                                    |
| `last_indexed_at` | `TEXT`    | ISO 8601 timestamp of last index operation (nullable). |
| `created_at`      | `TEXT`    | Row creation timestamp.                                |
| `updated_at`      | `TEXT`    | Row last-updated timestamp.                            |

**Indexes:**

- `idx_codebase_files_repo_path` — UNIQUE on `(repo, file_path)`
- `idx_codebase_files_repo_indexed` — on `(repo, last_indexed_at)`

### `codebase_symbols`

Stores one row per extracted symbol (function, class, interface, etc.).

| Column             | Type      | Description                                                                           |
| :----------------- | :-------- | :------------------------------------------------------------------------------------ |
| `id`               | `TEXT`    | UUID primary key.                                                                     |
| `repo`             | `TEXT`    | Repository identifier.                                                                |
| `file_path`        | `TEXT`    | File where the symbol is declared.                                                    |
| `name`             | `TEXT`    | Symbol name.                                                                          |
| `kind`             | `TEXT`    | Symbol kind (`function`, `class`, `interface`, `type`, `enum`, `method`, `variable`). |
| `exported`         | `INTEGER` | 1 if exported (ESM), 0 otherwise.                                                     |
| `default_export`   | `INTEGER` | 1 if default export, 0 otherwise.                                                     |
| `start_line`       | `INTEGER` | Start line (1-indexed, nullable).                                                     |
| `start_col`        | `INTEGER` | Start column (0-indexed, nullable).                                                   |
| `end_line`         | `INTEGER` | End line (1-indexed, nullable).                                                       |
| `end_col`          | `INTEGER` | End column (0-indexed, nullable).                                                     |
| `signature`        | `TEXT`    | Type/function signature string (nullable).                                            |
| `doc_comment`      | `TEXT`    | JSDoc comment text (nullable).                                                        |
| `parent_symbol_id` | `TEXT`    | Parent symbol UUID (e.g., method → class). FK to `codebase_symbols(id)`.              |
| `created_at`       | `TEXT`    | Row creation timestamp.                                                               |
| `updated_at`       | `TEXT`    | Row last-updated timestamp.                                                           |

**Indexes:**

- `idx_cs_repo_name` — on `(repo, name)`
- `idx_cs_repo_file` — on `(repo, file_path)`
- `idx_cs_repo_kind` — on `(repo, kind)`
- `idx_cs_name` — on `(name)`
- `idx_cs_parent` — on `(parent_symbol_id)`

### `codebase_references` (migrations v21 + v23)

Stores one row per reference edge discovered during parsing (used by `codebase-read` TRACE / dead-code / hotspots). Migration **v21** created the call-site table; migration **v23** (Phase 1.1, `codebase-references-edge-targets`) generalized it into an edge table — the `kind` taxonomy gained `extends` / `implements` and two nullable target columns were added:

| Column             | Type      | Description                                                                                                 |
| :----------------- | :-------- | :---------------------------------------------------------------------------------------------------------- |
| `id`               | `TEXT`    | UUID primary key.                                                                                           |
| `repo`             | `TEXT`    | Repository identifier.                                                                                      |
| `symbol_name`      | `TEXT`    | Symbol being referenced (the callee / base class / interface).                                              |
| `caller_file`      | `TEXT`    | File holding the call / heritage site.                                                                      |
| `caller_line`      | `INTEGER` | Line of the call site (or derived-type declaration line).                                                   |
| `caller_name`      | `TEXT`    | Enclosing symbol name at the call site (`null` for heritage edges).                                         |
| `kind`             | `TEXT`    | Edge kind: `call` \| `instantiation` \| `import` \| `extends` \| `implements`.                              |
| `target_file`      | `TEXT`    | File path of the referenced symbol when resolvable (v23, nullable).                                         |
| `target_symbol_id` | `TEXT`    | `codebase_symbols(id)` of the referenced symbol when resolvable (v23, nullable, plain-TEXT pointer, no FK). |
| `created_at`       | `TEXT`    | Row creation timestamp.                                                                                     |

**Indexes:**

- `idx_refs_repo_symbol` — on `(repo, symbol_name)`
- `idx_refs_repo_file` — on `(repo, caller_file)`

> **Extension note (verified against `src/mcp/storage/migrations/v23-codebase-references-edge-targets.ts`):** the v23 migration adds exactly the two nullable columns above and keeps the single `kind` enum-driven taxonomy extended with `extends`/`implements`. Rows are keyed by `caller_file` (the file HOLDING the call/heritage site); delete/transfer helpers operate on `caller_file`. Schema version is now **24** (`SCHEMA_VERSION`, `src/mcp/storage/migrations/index.ts:29`) — v23 was the Phase 1.1 codebase-edge extension; v24 (`relations-confidence`) is KG-only and does not touch codebase tables.

### FTS5 Virtual Table: `codebase_symbols_fts`

Full-text search index on `name`, `doc_comment`, and `signature` (the `signature` column was added when migration **v18** rebuilt the table):

```sql
CREATE VIRTUAL TABLE codebase_symbols_fts USING fts5(
    name,
    doc_comment,
    signature,
    content='codebase_symbols',
    content_rowid='rowid'
);
```

Three database triggers keep `codebase_symbols_fts` automatically synchronized with the `codebase_symbols` table:

- **AFTER INSERT** (`codebase_symbols_ai`): Inserts the new row's `name` and `doc_comment` into the FTS index.
- **AFTER DELETE** (`codebase_symbols_ad`): Removes the deleted row from the FTS index.
- **AFTER UPDATE** (`codebase_symbols_au`): Removes the old values, then inserts the new values — effectively a delete+insert.

This trigger-based approach ensures the FTS index is never stale, without requiring application-level synchronization.

---

## 4. WASM Parser Lifecycle

### Initialization

The tree-sitter WASM runtime and language grammars are loaded lazily — on the first `parseFile` call for each language, not at import time:

1. **WASM runtime** — `web-tree-sitter.wasm` loaded via `Parser.init()`
2. **Language grammars** — loaded per language on first use (e.g., `tree-sitter-typescript.wasm` + `tree-sitter-tsx.wasm`, `tree-sitter-go.wasm`, `tree-sitter-python.wasm`, …)

A `this.initPromise` guard prevents duplicate initialization attempts from concurrent calls, and concurrent `Language.load` calls for the same grammar are deduplicated via an in-flight grammar map.

**WASM file resolution** (bundled `dist/grammars/` is searched first, then `node_modules/`):

- `dist/grammars/web-tree-sitter/web-tree-sitter.wasm` or `node_modules/web-tree-sitter/web-tree-sitter.wasm`
- `dist/grammars/tree-sitter-typescript/tree-sitter-typescript.wasm` or `node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm`
- `dist/grammars/tree-sitter-typescript/tree-sitter-tsx.wasm` or `node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm`

### Per-File Parse

Each file parse creates a fresh `Parser` instance because tree-sitter parsers hold mutable state and are not reentrant:

```
new Parser() → parser.setLanguage(language) → parse(source) → parser.delete()
```

Each parse has a configurable timeout (default 10s, via `CODEBASE_INDEX_PARSE_TIMEOUT_MS`). Timeouts are handled gracefully — the file is marked as failed and the pipeline continues.

### Error Classification

| Error Type                 | Class              | Impact                                                                                                                                        |
| :------------------------- | :----------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| WASM init failure          | `FatalError`       | Pipeline aborts; infrastructure-level failure.                                                                                                |
| Per-file parse timeout     | `RecoverableError` | File skipped; pipeline continues.                                                                                                             |
| Per-file permission denied | `RecoverableError` | File skipped; pipeline continues.                                                                                                             |
| File > 10MB                | `RecoverableError` | Rejected before parse (`MAX_FILE_SIZE_BYTES`); pipeline continues.                                                                            |
| DB write failure           | `RecoverableError` | Retried with backoff (`retryDbWrite`: lock errors 3× 1s/2s/4s, others 1× 100ms); counted in `errorSummary.dbWriteErrors`; pipeline continues. |

---

## 5. Troubleshooting

### WASM Initialization Failure

**Symptom:** Server logs show `FatalError: operation=Parser.init` or `FatalError: operation=Language.load` during startup or first index call.

**Causes:**

1. Missing `node_modules` — tree-sitter WASM files are shipped with the package but may be missing if the install was corrupted.
2. Incompatible Node.js version — `web-tree-sitter` requires Node.js ≥ 18. Check with `node --version`.
3. Filesystem permissions — WASM files must be readable by the Node.js process.

**Resolution:**

```bash
# Reinstall dependencies to restore WASM files
npm install @vheins/local-memory-mcp

# Verify WASM files exist
ls node_modules/web-tree-sitter/web-tree-sitter.wasm
ls node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm
ls node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm
```

If the issue persists, check `stderr` for detailed error messages from tree-sitter. The error object includes the WASM path that failed.

### Large Repositories (>50K files)

**Symptoms:** High memory usage (>500MB RSS), slow indexing, or timeout errors.

**Tuning options:**

1. **Reduce concurrency** — Set `CODEBASE_INDEX_PARSE_CONCURRENCY=2` to lower WASM heap overhead.
2. **Use `includeGlobs`** — Index only relevant subdirectories:
   ```json
   { "includeGlobs": ["src/**/*.ts", "src/**/*.tsx"] }
   ```
3. **Increase batch size** — Set `DEFAULT_BATCH_SIZE` to 200 for fewer transaction commits (trade-off: higher memory during write).
4. **Extend parse timeout** — For large generated files (within the 10MB cap), increase `CODEBASE_INDEX_PARSE_TIMEOUT_MS=30000`.

> **File size cap:** files larger than 10MB (`MAX_FILE_SIZE_BYTES`) are rejected outright in the read phase — increasing the parse timeout does **not** allow them through.

**Memory constraints:**

- WASM parser heap: one `Parser` per concurrent slot (grammar-dependent; independent of repository size)
- File content buffers: at most `CONCURRENT_PARSE_BATCH` (4 default) × `MAX_FILE_SIZE_BYTES` (10MB) in flight, flushed after every batch
- Memory is bounded by the parse batch, not the repository size (see [Memory Budget](#memory-budget) above)
- If memory is constrained (e.g., CI, low-resource VPS), set concurrency to 2 or 1.

### Database Growth

**Symptom:** `memory.db` grows significantly after indexing.

**Expected growth:**

| Repository Size | Additional DB Size |
| :-------------- | :----------------- |
| 1,000 files     | ~1-5 MB            |
| 10,000 files    | ~10-50 MB          |
| 50,000 files    | ~50-250 MB         |

The FTS5 virtual table adds approximately 1-2x the raw symbol data size.

**Management:**

- Growth is proportional to symbol count, not file count. Files with many symbols (e.g., large declaration files) contribute more.
- The `codebase_files` table is compact (~200 bytes per row).
- Growth is additive with each re-index (symbols are deleted and re-inserted per file, not appended).
- To reclaim space after heavy churn: run `VACUUM;` on `memory.db`.

### Disk Space

**Minimum requirements:**

- Database storage: 500 MB free for typical workloads
- WASM files: web-tree-sitter runtime + a grammar WASM per supported language (loaded from `dist/grammars/` or `node_modules/`)
- Temporary index batch buffers: bounded to the parse batch (≤4 × 10MB in-flight)

For production deployments, ensure at least 1 GB free to accommodate growth and WAL files.

### Concurrent Indexing Conflicts

**Symptom:** `IndexInProgressError` when calling `codebase-index` (INDEX mode).

**Cause:** A per-repo in-memory `Set` prevents concurrent indexing of the same repository. This is intentional — running two index operations on the same repo would produce inconsistent results.

**Resolution:** Wait for the in-progress index to complete (check via `codebase-index` STATUS mode) before retrying.

### Stale Index

**Symptom:** `codebase-read` (SEARCH or FILE mode) returns outdated results.

**Assessment:**

- Check `codebase-index` STATUS mode for the repository — `lastIndexedAt` shows when the index was last refreshed.
- Run `codebase-index` (INDEX mode) to trigger an incremental update (only changed files are re-parsed).
- To force a full re-index: call `codebase-index` with `force: true`.

### Auto-Index Not Triggering

**Symptom:** New repositories are not automatically indexed on server startup.

**Verification:**

1. Check `CODEBASE_AUTO_INDEX` — if set to `"false"`, auto-index is disabled.
2. Check `CODEBASE_AUTO_INDEX_TTL` — if set too high, the existing index may appear fresh.
3. Check server logs for `[CodebaseIndex]` messages showing auto-index decisions, recalculated staleness counts, and which repos were scheduled.

### Query Performance Degradation

**Symptom:** `codebase-read` SEARCH queries become slow (>1s) on large indexes.

**Causes and fixes:**

| Cause                               | Fix                                                                                                         |
| :---------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| Missing FTS5 index on large dataset | Ensure FTS5 triggers are active (verify `SELECT count(*) FROM codebase_symbols_fts;` matches symbol count). |
| High `limit` with FTS5 fallback     | FTS5 queries with `limit=200` are slower. Reduce to `limit=50` for typical searches.                        |
| No SQLite indexes                   | Run `ANALYZE;` to update SQLite query planner statistics.                                                   |

---

## 6. Backup & Recovery

### Database Location

All codebase tables (`codebase_files`, `codebase_symbols`, `codebase_references`, `codebase_symbols_fts`) are stored in the same `memory.db` database as memories, tasks, standards, and other application data. The database location follows this resolution order (`src/mcp/storage/sqlite.ts:29-49`):

1. `MEMORY_DB_PATH` environment variable (explicit override)
2. Platform config dir **if the file already exists** — `~/.config/local-memory-mcp/memory.db` (Linux), `~/Library/Application Support/local-memory-mcp/memory.db` (macOS), `%USERPROFILE%\.local-memory-mcp\memory.db` (Windows)
3. Legacy `~/.config/local-memory-mcp/memory.db` **if it already exists**
4. `./storage/memory.db` (current working directory) **if it already exists**
5. Platform config dir (created if absent) — the final fallback when none of the above exists

### Automatic Backup — NOT IMPLEMENTED

> **Correction (verified 2026-08-08):** there is **no automatic backup** in the implementation — no code copies `memory.db` to `memory.db.backup`, and there is no nightly backup job (`grep -ri backup src/` matches tests only). The only built-in durability mechanism is **SQLite WAL journaling with automatic checkpointing**. Treat the manual procedures below as the supported backup path; consider scheduling them (e.g., a cron job) for real deployments.

### Corruption Recovery

The database uses WAL journaling with automatic checkpointing (no automatic backup — see above). If corruption is suspected, run the recovery procedure manually:

1. Stop the server.
2. Run `sqlite3 memory.db "PRAGMA integrity_check;"` to verify corruption.
3. If corruption is found, restore from `memory.db.backup`:
   ```bash
   cp memory.db.backup memory.db
   ```

### Manual Backup

To manually back up codebase index data:

```bash
# Backup the entire database (includes all entities)
cp ~/.config/local-memory-mcp/memory.db ~/backups/memory-$(date +%Y%m%d).db

# Or use SQLite's backup API for a live backup
sqlite3 ~/.config/local-memory-mcp/memory.db ".backup ~/backups/memory-$(date +%Y%m%d).db"
```

### Restore

```bash
# Stop the server
# Replace with backup
cp ~/backups/memory-20260722.db ~/.config/local-memory-mcp/memory.db
# Restart the server
# Run codebase-index (INDEX mode) to ensure index integrity
```

> **Note:** Restoring `memory.db` restores all entities (memories, tasks, standards, handoffs, and codebase data). There is no separate backup granularity for codebase tables — they share the same SQLite database.

---

## 7. Monitoring

### Logging

The codebase index subsystem logs structured messages with a `[CodebaseIndex]` prefix:

| Event               | Level   | Fields                                                                           |
| :------------------ | :------ | :------------------------------------------------------------------------------- |
| Index started       | `info`  | `repo`, `mode` (full/incremental)                                                |
| File parsed         | `debug` | `filePath`, `durationMs`, `symbols`                                              |
| File skipped        | `debug` | `filePath`, `reason` (checksum match)                                            |
| File failed         | `warn`  | `filePath`, `error`, `durationMs`                                                |
| Index completed     | `info`  | `repo`, `totalFiles`, `parsedFiles`, `failedFiles`, `totalSymbols`, `durationMs` |
| Auto-index decision | `info`  | `repo`, `reason`, `staleCount`                                                   |
| WASM init failure   | `error` | `operation`, `wasmPath`, `error`                                                 |
| DB write retry      | `warn`  | `error`, `attempt`                                                               |

### Hooks

- `onProgress` callback emits stage progress (discovering → parsing → storing → cleaning).
- `IndexResult.durationMs` captures wall-clock time per index operation.
- `IndexResult.errorSummary` classifies failures (timeout, permission, DB write).

---

## 8. Scaling Guidelines

### Repository Size → Configuration

| Repository Size | Recommended `CODEBASE_INDEX_PARSE_CONCURRENCY` | Recommended Memory |
| :-------------- | :--------------------------------------------- | :----------------- |
| < 10K files     | 4 (default)                                    | 256 MB             |
| 10K-50K files   | 2-4                                            | 512 MB             |
| 50K-100K files  | 2                                              | 1 GB               |
| > 100K files    | 1                                              | 2 GB               |

For very large repositories, use `includeGlobs` to index only the most relevant directories rather than the entire tree.

### Concurrent Repositories

The server can index multiple repositories concurrently (separate repos do not contend for the concurrency guard). Each repository indexes with its own parser pool and DB transactions. WASM parser memory is per-pool, so indexing 3 repos concurrently with `concurrency=4` each could require ~240 MB for parser heaps alone.

---

## Related Documentation

- [Codebase Index Architecture](./specs/design-architecture.md) — How it works and how to use it
- [API Reference: Codebase Index](../../api/codebase-index/api-codebase.md) — Complete MCP tool documentation
- [ADR-002: Codebase Index Architecture](../../../design/decisions/adr-002-codebase-index.md) — Design rationale and phased delivery plan
