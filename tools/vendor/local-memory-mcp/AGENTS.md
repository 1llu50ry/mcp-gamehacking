# AGENTS.md — @vheins/local-memory-mcp

MCP server (stdio) giving AI agents long-term local memory (SQLite + semantic
vectors) plus a Svelte dashboard and a tree-sitter codebase index. TypeScript,
Node 22 (CI pin; no `engines`/`.nvmrc` enforces it — Node 24 also works).

The repo **dogfoods its own memory**: its long-term memory lives in the server's
SQLite DB (`~/.config/local-memory-mcp/memory.db` on Linux; `./storage/memory.db`
is gitignored and starts empty). See `CONTRIBUTING.md`, `GEMINI.md`, and
`.agents/documents/testing.md` for the authoritative rules this file summarizes.

## Build artifacts are generated — never hand-edit them

`npm run build` does more than `tsc`:

1. `vite build` → `dist/dashboard/public/`
2. `tsup` bundles `src/mcp/server.ts` + `src/dashboard/server.ts` to ESM
3. `bash scripts/copy-grammar-wasm.sh` → copies/compiles **`dist/grammars/*.wasm`**
   (tree-sitter grammars; dart/kotlin/swift need network to compile, vue needs `npm pack`)
4. `node scripts/gen-bins.mjs` → **regenerates `bin/mcp-memory-server.js` and
   `bin/mcp-memory-dashboard.js`** (these are build outputs, not source)
5. `gen-bins` + chmod for the 4 entry points

So: don't edit `bin/*.js` or expect `dist/` to exist after a clean checkout —
run `npm run build` (or at least `bash scripts/copy-grammar-wasm.sh`) first.

### Dashboard bin self-rebuild trap

`bin/mcp-memory-dashboard.js` (and `bin/mcp-memory-server.js dashboard`) call
`ensureDashboardBuild()`, which rebuilds `dist/dashboard/public` if any UI source
is newer than the built assets. In a fresh checkout this is a no-op; in an
**installed** package (no `src/`) it's skipped. If the UI bundle is stale but
can't build, the bin **throws on launch** — rebuild first with
`npm run dashboard:build`.

### Daemon wedge — stale session / stale build (PERF-009)

The MCP daemon is a **detached process that does NOT restart with the client**.
It is a single long-lived combined dashboard + MCP HTTP server (default port
`3456`), launched once via `local-memory-mcp daemon` (or `npx … --daemon-worker`).
Two failure modes share one symptom: **every MCP tool call fails** with
`{"code":-32000,"message":"Bad Request: Server not initialized"}`.

**Cause 1 — the daemon is not the build you think it is.** If the daemon was
started from an installed/cached package (e.g. an `npx` cache copy) while the
working tree has moved on, every fix on `main` is invisible: the process serves
old code. Confirm from the daemon log, which logs a build identity at startup:

```bash
grep "build identity\|DAEMON_READY" ~/.config/local-memory-mcp/daemon.log | tail -2
# → [Daemon] build identity {"build":"0.48.0+d8dd97a [stamp built …]","entry":"/…/bin/mcp-memory-server.js"}
```

`entry` is the decisive field — it tells you whether the process runs the repo
build (`/…/Projects/local-memory-mcp/bin/mcp-memory-server.js`) or an
`npx`/global cache path. `GET /api/health` carries the same identity as `build`.

**Cause 2 — stale session id (pre-PERF-006 builds).** The client caches an
`Mcp-Session-Id`; the daemon's idle sweep (`MCP_HTTP_SESSION_IDLE_TTL_MS`,
default 30 min) evicts it. On a build WITHOUT the PERF-006 guard, a non-initialize
POST with an unknown id gets `400/-32000 "Server not initialized"` — a dead end
with no client recovery. On a build WITH the guard (main, `d0aa941`+) the same
request gets `404/-32001 "Session not found"`, which the client's transport
auto-recovers from by re-initializing and retrying the call. The daemon log
names the offending id and the recovery (PERF-009).

**Recovery** (in order):

```bash
# 1. Build the working tree (artifacts are generated — never hand-edit dist/ or bin/).
npm run build        # writes dist/ + bin/ + dist/daemon-build.json (build stamp)

# 2. Restart the daemon on the repo build (stops the stale process, starts fresh).
local-memory-mcp daemon stop
local-memory-mcp daemon start      # resolves to the repo build via the dev symlink

# 3. Verify the running build matches the tree.
local-memory-mcp daemon status
grep "build identity" ~/.config/local-memory-mcp/daemon.log | tail -1
```

If the client still holds an evicted id after a guarded restart it self-heals on
the first `404`; if it does not, restart the client once. Do not delete
`memory.db` — the wedge is a process/build problem, never a data problem.

**Cause 3 — rootless client + no project CWD (FIX-110-A/B).** A remote HTTP
client that does NOT advertise MCP roots (e.g. Zed 1.21) plus a daemon whose
CWD is `/` cannot infer owner/repo, so every scoped tool call fails with a
"configure MCP workspace roots" style message. Fix it by EITHER seeding the
daemon's working directory at install time:

```bash
local-memory-mcp daemon install --working-dir /path/to/your/project
# → launchd WorkingDirectory / systemd WorkingDirectory= are written so the
#   daemon's CWD is your project (not "/") on every (re)start.
```

OR by setting an explicit scope default in the daemon environment (takes effect
after a daemon restart):

```bash
# Highest-priority env tier (FIX-110-A); GITHUB_REPOSITORY="owner/repo" is the
# lower-priority fallback. Precedence: explicit args > MCP roots/session
# inference > LOCAL_MEMORY_DEFAULT_* > GITHUB_REPOSITORY > daemon cwd.
export LOCAL_MEMORY_DEFAULT_OWNER=vheins
export LOCAL_MEMORY_DEFAULT_REPO=local-memory-mcp
```

**Cause 4 — stale/evicted session id stalls the client >60s (FIX-110-C).** A
remote client caches one `Mcp-Session-Id` for its whole lifetime; when the
daemon's idle sweep evicts it, the next non-initialize call carries an unknown
id. Historically that returned `404/-32001 "Session not found"` and a client
that never re-initializes (Zed) stalled. Two mitigations ship together:

- The daemon keeps sessions alive far longer by default (2h vs the standalone
  30 min) — same `MCP_HTTP_SESSION_IDLE_TTL_MS` env var overrides BOTH.
- Stateless session recovery (`MCP_HTTP_STATELESS_RECOVERY`, default ON): a
  non-initialize request with an unknown/absent `mcp-session-id` is served by a
  fresh short-lived stateless transport instead of returning `404/400`, so the
  client self-heals with NO re-initialize and NO stall. Set
  `MCP_HTTP_STATELESS_RECOVERY=false` to restore the strict `404/-32001` /
  `400/-32000` contract (a client whose transport re-initializes on `404` still
  recovers). Reconnect guidance: if a client still wedges, restart the client
  once; do NOT delete `memory.db`.

## Install

```bash
npm install --legacy-peer-deps
```

Peer-dep conflicts exist and native modules (`better-sqlite3`, `tree-sitter`) need
their postinstall scripts. CI uses `--legacy-peer-deps`. The `allowScripts`
allowlist in `package.json` is **load-bearing** — do not strip it or native builds
won't run.

## Verification order (local pre-push gate = CI gate)

```bash
npm run type-check   # tsc --noEmit && tsc -p tsconfig.test.json && svelte-check
npm run lint         # eslint . --ext .ts,.svelte
bash scripts/copy-grammar-wasm.sh   # builds dist/grammars WASM (needed by tests)
npm run test
```

`npm run test -- --coverage` currently **exits 1 by design** (suite is below the
configured floor; coverage is non-blocking until `REFACTOR-TST-013`). Don't treat
that exit as a real failure — the coverage artifacts are still written.

## Tests (Vitest 4)

- Pool is `forks` (required for `better-sqlite3` ESM). Default env `node`.
- Single file/dir: `npx vitest run src/mcp/tests/memory.write.test.ts` (or a dir).
- Partitioned projects: `npm run test:unit | :integration | :e2e | :perf`
  (`--project <name>`). Partition is positive-only `include`+`exclude` — **never put
  `!` negations in a project `include`** (silently breaks v8 coverage, FIX-381).
- DOM tests must declare `// @vitest-environment jsdom` as the **first line**;
  pure-TS tests must NOT. `@testing-library/svelte` is wired via
  `server.deps.inline` in `vitest.config.ts` — no per-test setup needed.
- In-memory DB via `createTestStore()` (from `src/mcp/storage/sqlite.ts`); tests
  **never** touch the real `storage/` dir. Fixtures shared across tests live in
  `src/mcp/tests/fixtures/`; never write into the repo tree (use `fs.mkdtemp`).
- After splitting a large test file, run `tsc -p tsconfig.test.json` (not just
  `vitest`) — green tests ≠ type-correct.
- Known flaky test: `src/mcp/tests/codebase-index/indexing-service.test.ts`
  `autoIndexIfStale` timing (pre-existing, not a real failure).

### Test layout & naming (authoritative: `.agents/documents/testing.md`)

- **Server / non-UI** → centralized `src/**/tests/` mirroring the module path
  (`src/mcp/tools/memory.write.ts` → `src/mcp/tests/memory.write.test.ts`).
- **Dashboard UI** → colocated `src/dashboard/ui/src/**/__tests__/` beside subject.
- Markers (filename = scope, no `snake_case`): `*.test.ts` · `*.integration.test.ts`
  · `*.e2e.test.ts` · `*.perf.test.ts`. No other suffix is valid.
- Every change ships its tests in the **same commit** (review-blocking otherwise).

## Structure / boundaries

- npm **workspaces** with one nested workspace: `src/dashboard/ui` (Svelte 5 + Vite;
  own `node_modules`, builds to `dist/dashboard/public/`).
- `src/mcp/` — MCP server. Entry: `src/mcp/server.ts` → `dist/mcp/server.js`.
- `src/dashboard/` — Express API. Entry: `src/dashboard/server.ts` → port `3456`.
- `bin/` — generated CLI bins; `mcp-memory-server dashboard` launches the dashboard.
- `storage/` — runtime SQLite DB (gitignored except `.gitkeep`).

## MCP server & tool surface

- Transport is **stdio**; `src/mcp/server.ts` constructs the `McpServer` and
  registers tools/resources/prompts. Runtime profile `MCP_RUNTIME_PROFILE` controls
  optional engines: `full` (default, backward-compatible eager startup), `balanced`
  (semantic/index engines on first demand), or `minimal` (SQLite + lexical core only).
  Legacy `CODEBASE_AUTO_INDEX` / `ENABLE_FILE_WATCHER` flags still override the full
  profile's proactive indexing/watcher behavior.
- **Tool contract is CANONICAL in `src/mcp/prompts/server/instructions.md`**
  (injected as the MCP server's instructions): registered tool names, auto-infer
  semantics, the who/when matrix, and micro-flows. Do NOT re-document the contract
  here — reference that file.
- Router gotcha: only 2 real aliases exist in `src/mcp/router.ts` (`TOOL_ALIASES`)
  — `claim-release` → `claim-manage` and `task-update` → `task-write`, plus
  **dot→hyphen normalization** (e.g. `memory.store` → `memory-store`). Legacy
  names (`index_repository`, `trace_symbol`, `codebase_search`, `index_status`,
  `task-claim`, …) are historical notes only — NOT resolvable aliases.
  (`mcp-server.ts` says "19 canonical tools" — the canonical set is 20; `synthesize`
  is sampling-gated, so only 19 register when the client lacks sampling.)
- `codebase-read` mode inference (`name`/`filePath`/`content`/`query`/empty) lives
  in `src/mcp/tools/codebase.read.ts` (`inferMode`) — see the tool contract for
  exact semantics. `depth` is ONLY a parameter inside architecture mode. Index
  status is a `codebase-index` mode (no `repoPath` → status), not `codebase-read`.
- **Inline `key:value` tags in `query`** (standard-read / memory-read / codebase-read):
  these are auto-extracted into structured filters, so both structured params AND
  inline tags work. Examples now VALID: `query:"language:php framework:filament"`,
  `query:"auth tag:a,b lang:php"`, `query:"foo kind:function"`. Unknown keys
  (e.g. `label:ddd`) stay as plain free-text. Tags are stripped from the residual
  query so FTS won't mis-tokenize `language:php` (see `src/mcp/utils/query-tags.ts`).
- **`CODEBASE_REPOS_DIR` is DASHBOARD-ONLY** (read by `src/dashboard/services/
codebase.service.ts`). The MCP server ignores it and indexes only its CWD.

## Persistence, search & env

- **SQLite by default** (project rule); optional multi-DB is a scoped future option — see ADR-009. DB path resolves: `MEMORY_DB_PATH` → platform config
  dir → legacy → `./storage/memory.db` → config dir (created, WAL mode). Migrations
  run **automatically** in the `SQLiteStore` constructor — there is **no `migrate`
  script** (ignore any stale `npm run migrate` mention in comments). The codebase
  index lives **inside the same DB** (tables `codebase_*`), not a separate file.
- **Dashboard repo-only view is intentional** — `GET /api/memories?repo=X` / `GET /api/tasks?repo=X` and stats/coordination controllers aggregate by short `repo` only (`owner = ""` reads like `MemoryService.list` / `TaskService.getTasksByRepo("", repo)` in `src/dashboard/services/`), intentionally merging rows from owners that share the same short repo name (operational single-host SQLite view). Dashboard rows SHOULD render an owner badge (informational). Per-owner isolation must use the MCP tool surface with explicit `(owner, repo)`. Codebase index owner isolation is **out-of-scope** (repo-keyed by design). Full policy: `.agents/documents/design/decisions/ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md` and `src/mcp/prompts/server/instructions.md` § Data Scoping.
- No `.env.example` exists. Key vars: `MEMORY_DB_PATH`, `PORT` (dashboard, default
  3456), `DASHBOARD_HOST` (default 127.0.0.1), `DASHBOARD_TOKEN` (auth gate — **none
  = open**), `CODEBASE_AUTO_INDEX` (`"false"` disables startup index),
  `CODEBASE_AUTO_INDEX_TTL` (default 24h), `ENABLE_FILE_WATCHER` (`"false"` disables
  the re-index sweep), `MCP_MODEL`, `CODEBASE_REPOS_DIR` (dashboard only),
  `EMBEDDING_QUEUE_BATCH_SIZE`, `FILE_WATCH_INTERVAL_MS`, `MCP_RUNTIME_PROFILE`.
  **No `GH_TOKEN`** is used by this repo. **Embeddings are OFFLOADED to an async
  queue** (migration v9); worker startup follows the selected runtime profile.
- **Semantic model** `Xenova/all-MiniLM-L6-v2` is downloaded at runtime via
  `@xenova/transformers` on first search/upsert — **needs network on first use**
  unless cached. ONNX inference is capped to `EMBEDDING_ONNX_THREADS` threads
  (default `1`) so a busy daemon does not wake a full all-core ORT pool per
  embed; the cap is output-neutral (thread count never changes the vectors).
- **Upgrading the embedding model**: the model name + version live ONLY in
  `src/mcp/storage/embedding-model.ts`. On any output-changing model change
  (new checkpoint, retrained weights at the same name, tokenizer/pooling, or
  dimension change), bump `EMBEDDING_MODEL_VERSION` (and `EMBEDDING_MODEL_NAME`
  when the name changes). The next startup's backfill re-embeds every affected
  vector exactly once — capped by `EMBEDDING_QUEUE_BACKFILL_CAP` (2000/startup),
  so a full refresh drains across restarts; subsequent restarts enqueue 0.
- **Embeddings are OFFLOADED to an async queue** (migration v9): after a
  `memory-write`/`standard-write`/`task-write`, the vector is **not instant** — there
  is a brief searchability window (typically <1s) before the semantic score converges.
  `full` starts the queue worker eagerly; `balanced` starts it on first semantic
  read/write; `minimal` leaves semantic enrichment unavailable while lexical tools work.
- **Memory search uses FTS5** (migration v10) with the `unicode61` tokenizer and `*`
  prefix matching — mid-word substring matches are **not** guaranteed (trigram deferred).

### Database space reclamation (`VACUUM_ON_STARTUP`)

Pruning/data cleanups free SQLite pages into the freelist; with `auto_vacuum=NONE`,
the file retains those pages for reuse rather than returning disk space. Use the
opt-in startup conversion only during a planned maintenance window. Stop other
MCP/dashboard processes using that database and preserve the normal `MEMORY_DB_PATH`
override, if configured.

```bash
# One POSIX-shell invocation with the global install
VACUUM_ON_STARTUP=true local-memory-mcp
# Alternative without a global install
VACUUM_ON_STARTUP=true npx @vheins/local-memory-mcp
```

These commands continue into the stdio server; they do not exit after maintenance.
Wait for `[Server] VACUUM_ON_STARTUP ran`, inspect `changed`/`skipped`/`reason`, then
stop the standalone process with Ctrl+C. For Claude Desktop/Cursor JSON setup,
see [the README maintenance guide](README.md#database-maintenance-reclaim-disk-space).
Remove/unset the flag after the planned run (or set it to `"false"`) to keep normal
startups fast and avoid conversion retries/write-lock contention.

Implementation contract (`src/mcp/services/vacuum.ts`, wired in `src/mcp/server.ts`):

- Default off; when enabled, runs before accepting requests in **all** runtime
  profiles. This is an MCP startup option, not a standalone dashboard option.
- Converts to `auto_vacuum=INCREMENTAL` with a **one-time full `VACUUM`**. Requires
  a full write lock; no dedicated timeout bounds this synchronous startup pass.
- Disk guard defaults to **2 × (`page_count` × `page_size`) + 16 MiB** of available
  space on the DB filesystem. The multiplier is `VACUUM_DISK_HEADROOM_MULTIPLIER`
  (default 2); the 16 MiB margin is fixed. Insufficient space returns
  `skipped: true`, `reason: "insufficient_disk"`. A failed `statfs` probe degrades
  **open** (proceeds); verify actual headroom rather than relying on the guard alone.
- **Idempotent:** `auto_vacuum=2` returns `changed: false`, `skipped: false`,
  `reason: "already_incremental"` without another full vacuum. This flag does not
  reclaim future freelist growth once converted; bounded `incrementalVacuum`
  runs after pruning in the `full` profile's startup maintenance sweep.
- **Never-throw conversion:** failures are logged and returned with `skipped: true`,
  `reason: "error"`; `:memory:` returns `reason: "in_memory"`. Disabled
  `runStartupVacuum` returns `null`. This contract does not cover unrelated startup
  failures or all other vacuum helpers.
- Verify behavior with `npx vitest run src/mcp/tests/vacuum.test.ts`; never run the
  documented maintenance commands against the real memory DB as a documentation test.

## Environment Variables

No `.env.example` exists. All variables are read from `process.env` (or via the
`envInt`/`envStr` helpers in `src/mcp/utils/constants.ts`). Defaults shown below
are taken from `constants.ts` / `server.ts` / `dashboard/server.ts`. **`ENABLE_QUEUE_WORKER`
does not exist** — embeddings offload via an async queue with no env var gate (the
worker starts inline at startup).

### MCP core

| Variable                         | Default                          | Purpose                                                                                                                                                                                                         |
| :------------------------------- | :------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEMORY_DB_PATH`                 | — (platform config dir fallback) | Explicit SQLite DB path override.                                                                                                                                                                               |
| `MCP_SERVER`                     | set to `"true"` by `server.ts`   | Marks the running process as the MCP server (affects logging/sinks).                                                                                                                                            |
| `LOG_LEVEL`                      | `info`                           | Log level (`trace`/`debug`/`info`/`warn`/`error`), lowercased.                                                                                                                                                  |
| `MCP_CLIENT_NAME`                | — (session fallback)             | Default agent name when a tool call omits `agent`.                                                                                                                                                              |
| `MCP_MODEL`                      | — (session fallback)             | Default model when a tool call omits `model`.                                                                                                                                                                   |
| `MCP_RUNTIME_PROFILE`            | `full`                           | `minimal`, `balanced`, or backward-compatible `full`.                                                                                                                                                           |
| `ENABLE_AUTO_ARCHIVE`            | `"false"` (disabled)             | Set to `"true"` to enable automatic memory archiving on startup.                                                                                                                                                |
| `VACUUM_ON_STARTUP`              | `"false"` (disabled)             | Set to `"true"` to run the guarded space-reclamation pass once at startup (converts to `auto_vacuum=INCREMENTAL` + `VACUUM`; needs ~2x free disk).                                                              |
| `SEMANTIC_WARMUP_TIMEOUT_MS`     | `30000` (30s)                    | Wall-clock cap for the eager semantic (ONNX) warm-up. Non-fatal + deferred (FIX-034): a timeout logs a degraded notice and the server keeps serving (semantic loads lazily on first use). `0` disables the cap. |
| `ENABLE_REUSE_TELEMETRY`         | `"true"`                         | Set to `"false"` to disable aggregate-only context-reuse telemetry.                                                                                                                                             |
| `REUSE_TELEMETRY_RETENTION_DAYS` | `30`                             | Hourly aggregate retention in days (bounded to 1–365).                                                                                                                                                          |
| `REUSE_TELEMETRY_MAX_ROWS`       | `20000`                          | Global cap for aggregate telemetry rows.                                                                                                                                                                        |
| `LOCAL_MEMORY_DISPLAY_TZ`        | — (raw ISO-8601 UTC)             | IANA zone (e.g. `Asia/Jakarta`) used to render timestamps in human-readable tool output (`task-read`, `memory-read`, `standard-read`) as `YYYY-MM-DD HH:mm:ss ±HH:MM`. Unset, empty, or invalid ⇒ output stays byte-identical to the stored ISO-8601 UTC string. Storage, ordering, filtering, and comparisons remain UTC. |

### Dashboard

| Variable                 | Default             | Purpose                                                                    |
| :----------------------- | :------------------ | :------------------------------------------------------------------------- |
| `PORT`                   | `3456`              | Dashboard HTTP port.                                                       |
| `DASHBOARD_HOST`         | `127.0.0.1`         | Dashboard bind host (use `127.0.0.1` to stay loopback-only).               |
| `DASHBOARD_TOKEN`        | — (**none = open**) | Bearer auth gate; unset = unauthenticated.                                 |
| `DASHBOARD_JSON_LIMIT`   | `50mb`              | Express JSON body size limit.                                              |
| `DASHBOARD_ENABLE_MCP`   | `"false"`           | Set to `"true"` to start the embedded MCP client in the dashboard process. |
| `DASHBOARD_OWNER`        | `""`                | Default owner for dashboard task writes when none is supplied.             |
| `DASHBOARD_STATS_TTL_MS` | `30000` (30s)       | TTL for the repo-stats cache.                                              |
| `DASHBOARD_KG_TTL_MS`    | `30000` (30s)       | TTL for the KG graph payload cache.                                        |
| `ARENA_OVERVIEW_TTL_MS`  | `5000` (5s)         | TTL for the Agent Arena overview cache.                                    |

### Embedding / KG outbox queue

| Variable                                   | Default | Purpose                                                |
| :----------------------------------------- | :------ | :----------------------------------------------------- |
| `EMBEDDING_QUEUE_BATCH_SIZE`               | `32`    | Rows embedded per worker batch.                        |
| `EMBEDDING_ONNX_THREADS`                   | `1`     | ONNX inference thread cap (both wasm + native).        |
| `EMBEDDING_QUEUE_POLL_INTERVAL_MS`         | `500`   | Idle poll interval for the lease worker.               |
| `EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS`     | `10000` | Idle backoff ceiling (exponential up to this).         |
| `EMBEDDING_QUEUE_LEASE_MS`                 | `60000` | Lease length for claimed embedding jobs.               |
| `EMBEDDING_QUEUE_BACKFILL_CAP`             | `2000`  | Max rows backfilled per process start.                 |
| `EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE`       | `500`   | Skip backfill when pending+claimed exceeds this.       |
| `EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK` | `5`     | Consecutive non-empty batches before draining backoff. |

### Codebase index & file watcher

| Variable                           | Default                  | Purpose                                                  |
| :--------------------------------- | :----------------------- | :------------------------------------------------------- |
| `CODEBASE_AUTO_INDEX`              | `"true"` (`"false"` off) | Startup auto-index of the server's CWD.                  |
| `CODEBASE_AUTO_INDEX_TTL`          | `86400000` (24h)         | Stale-index refresh interval.                            |
| `CODEBASE_REPOS_DIR`               | `..` (parent dir)        | **Dashboard-only** base dir for dashboard-indexed repos. |
| `CODEBASE_INDEX_PARSE_TIMEOUT_MS`  | `10000` (10s)            | Max wall-clock time per single file parse.               |
| `CODEBASE_INDEX_WORKERS`           | `4` (`0` = auto)         | Concurrent tree-sitter WASM parser slots.                |
| `CODEBASE_INDEX_PARSE_CONCURRENCY` | `4`                      | Legacy alias for `CODEBASE_INDEX_WORKERS`.               |
| `ENABLE_FILE_WATCHER`              | `"true"` (`"false"` off) | Polling re-index sweep over registered repos.            |
| `FILE_WATCH_INTERVAL_MS`           | `30000` (30s)            | Sweep cadence for the file watcher.                      |
| `FILE_WATCH_TTL_MS`                | `300000` (5 min)         | Per-repo re-entry cap (debounce) for the watcher.        |
| `INDEX_STALENESS_TTL_MS`           | `30000` (30s)            | Cache TTL for `index_status` staleness results.          |

### Search, cache & retention bounds

| Variable                     | Default | Purpose                                           |
| :--------------------------- | :------ | :------------------------------------------------ |
| `VECTOR_CANDIDATE_CAP`       | `100`   | Max similarity candidates fetched per search.     |
| `VECTOR_MIN_CANDIDATES`      | `10`    | Floor for the candidate pool (small/sparse sets). |
| `ACTION_LOG_MAX_ROWS`        | `10000` | Row-count cap for the audit `action_log` table.   |
| `WAL_CHECKPOINT_INTERVAL_MS` | `10000` | Min interval between WAL checkpoints.             |
| `DEFAULT_BATCH_SIZE`         | `100`   | Rows per DB transaction (file/symbol writes).     |

### Codebase-read / graph bounds

| Variable                       | Default           | Purpose                                             |
| :----------------------------- | :---------------- | :-------------------------------------------------- |
| `CODE_GRAPH_MAX_EDGES`         | `400`             | Dashboard code-graph edge cap.                      |
| `CODE_SEARCH_CACHE_MAX_BYTES`  | `16777216` (16MB) | Process-shared content-grep cache (bytes).          |
| `CODE_SEARCH_CACHE_MAX_FILES`  | `256`             | Process-shared content-grep cache (file count).     |
| `CODE_SEARCH_MAX_REGEX_LENGTH` | `200`             | Max length of a `content` grep regex (ReDoS guard). |
| `FILE_CONTENT_MAX_LINES`       | `2000`            | Max lines returned by the file-content endpoint.    |
| `KG_MAX_GRAPH_EDGES`           | `4000`            | Server-side KG graph edge cap.                      |
| `KG_MAX_CONTEXT_ENTITIES`      | `50`              | Max entities fed into KG-context enrichment.        |
| `KG_CONTEXT_TEXT_TOKENS`       | `40`              | Max search-text tokens for KG entity FTS.           |

## Formatting

- Prettier: **tabs**, **double quotes**, `printWidth: 120`, `trailingComma: none`,
  semicolons on; Svelte via `prettier-plugin-svelte`.
- ESLint: `@typescript-eslint/no-explicit-any` is **error**, relaxed to off inside
  `*.test.ts`/`*.spec.ts`; unused vars/args allowed if `_`-prefixed. `dist/`, `bin/`,
  `storage/`, `.cache/`, `coverage/` are ignored.

## Dashboard dev gotcha

`npm run dashboard` serves the **built** bundle — run `npm run build` (or
`npm run dashboard:build`) first. For live UI work: `npm run dashboard:dev`
(:5173, proxies `/api` → :3456) alongside `npm run dashboard`.

## Commits, branches, PRs

- Conventional Commits `type(scope): description`, with the active task as
  `[TASK-xxx]` in subject/body (see `GEMINI.md`, `CONTRIBUTING.md`). `keyword #N`
  footer when closing a GitHub issue.
- Branch `feat/feature-name` or `fix/bug-description`; PR → `main`.
- Strict quality rules: **Local-First** (no cloud/external APIs without discussion),
  **SQLite by default** for persistence; optional multi-DB is a scoped future option — see ADR-009;
  **never lower the semantic-search similarity thresholds** (anti-hallucination guard).

## Where to look

- `CONTRIBUTING.md` — workflow, commit & quality rules.
- `.agents/documents/testing.md` — single authoritative testing standard (above is a summary).
- Published consumer docs: the **GitHub Wiki** — Home (`https://github.com/vheins/local-memory-mcp/wiki/Home`). MCP tool/API usage from the consuming agent's perspective lives at `en/Tools-Reference` (`https://github.com/vheins/local-memory-mcp/wiki/en/Tools-Reference`) and `en/MCP-Concepts` (`https://github.com/vheins/local-memory-mcp/wiki/en/MCP-Concepts`).
- `GEMINI.md` — commit-message rules.
- Repo coding standards stored in MCP: `STD-001` (Arena layout manager-driven),
  `STD-002` (Dashboard UI a11y/focus/polling baseline).

## Documentation Map

The repository carries documentation for **two distinct audiences** plus
**cross-project global standards**. Knowing which bucket a doc lives in tells you
who it is written for.

- **GitHub Wiki = MCP consumer documentation** — for **end users / AI agents that
  consume this MCP server**. The repo's user docs live **OUTSIDE this repo** at the
  GitHub Wiki (`https://github.com/vheins/local-memory-mcp/wiki/Home`); in-repo
  `docs/` no longer holds consumer docs (the wiki covers `en/` and `id/` language
  versions, per-feature overviews, and screenshots).
- **`.agents/` = developer, contributor & AI-agent documentation** — internal
  engineering docs for people and agents building on this repo:
  `.agents/documents/testing.md` (the authoritative testing standard),
  `.agents/documents/design/` (architecture, UI incl. `ui/audits/`, database, decisions — incl. `ADR-001..008` + `SPEC-001`),
  `.agents/documents/requirements/` (BRD/PRD/FSD/TDD, acceptance criteria, `optimization/` en+id),
  `.agents/documents/application/` (API catalog incl. `api/codebase-index/`, modules incl. `modules/codebase-index/runbook.md`, testing incl. `testing/benchmarks/`),
  `.agents/documents/tasks/` (backlog, roadmap, sprints),
  `.agents/documents/_tasks/` (internal task tracking, gitignored),
  Consumer docs → GitHub Wiki; internal docs → `.agents/documents`. Top-level under `.agents/documents/` is strictly 4 dirs (`application/`, `design/`, `requirements/`, `tasks/`) plus `_tasks` (MCP fallback) and `brief.md`/`testing.md`; `_archive/` was removed by Opsi A merge.
- **`~/.agents/` = cross-project global standards** — rules and skills shared
  across repositories (the senior-authority baseline that applies everywhere).
