/**
 * Centralized constants — single source of truth across the codebase.
 * Do not inline these values in call sites.
 *
 * Batch sizes and candidate caps are env-overridable where sensible
 * (e.g. `VECTOR_CANDIDATE_CAP=250`). Scoring weights and similarity
 * thresholds are deliberately NOT env-overridable: silently changing them
 * between environments would alter search/conflict semantics.
 *
 * ────────────────────────────────────────────────────────────────────────
 * NAMING CONVENTIONS (TASK-119) — documented rule for this codebase:
 *
 *   1. Scalar constants            → UPPER_SNAKE (default; e.g. TTL_MS_PER_DAY)
 *   2. Zod schemas / types         → PascalCase (e.g. MemoryScopeSchema)
 *   3. Process singletons          → camelCase — THE documented exception:
 *      module-level live instances (logger, indexingRepos, db, mcpClient,
 *      vectors, embeddingWorker, startTime). These are NOT exported consts
 *      of a value category; they are DI. Do NOT rename them (breaking).
 *
 * ENUM VALUE CASING (TASK-119) — chosen convention for NEW code:
 *   UPPER_SNAKE (e.g. ErrorSeverity). Existing enums are NOT migrated
 *   (behavior/API risk): SymbolKind uses slug values, RankTier uses
 *   numeric values — both remain as-is, documented here as legacy.
 * ────────────────────────────────────────────────────────────────────────
 */

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** Parse a boolean env var: "true"/"1"/"yes" (case-insensitive) ⇒ true. */
function envBool(name: string, fallback: boolean): boolean {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	return /^(true|1|yes)$/i.test(raw.trim());
}

/**
 * Read a string env var, trimmed; an empty/whitespace-only value is treated as
 * "not set" so it can never shadow a lower-priority fallback. Exported so
 * call-time readers (e.g. scope-default resolution in normalize-args.ts) can
 * share the exact same semantics as the module-load constants.
 */
export function envStr(name: string, fallback?: string): string | undefined {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const trimmed = raw.trim();
	return trimmed === "" ? fallback : trimmed;
}

// ── Table names (single source of truth for SQL) ────────────────────────
// Canonical SQLite table names. Use these in ALL SQL strings (entities,
// migrations, services, tools) — never inline the literal. Virtual/aux
// tables (memories_fts, task_vectors, …) and migration-internal temp tables
// (memories__migrated, memory_summary_v3, …) are intentionally NOT included.
export const TABLE_MEMORIES = "memories";
export const TABLE_TASKS = "tasks";
export const TABLE_HANDOFFS = "handoffs";
export const TABLE_CLAIMS = "claims";
export const TABLE_ACTION_LOG = "action_log";
export const TABLE_MEMORY_SUMMARY = "memory_summary";
// Cold-tier archive table (TASK-036) — lives in the SEPARATE cold-archive.db,
// not the hot memory.db, so it is listed here only to avoid inline literals.
export const TABLE_COLD_MEMORIES = "cold_memories";

// ── Derived database (TASK-037 / DB-shrink L4) ──────────────────────────
// The codebase index + every `*_vectors` table are DERIVED data (regenerable
// from source) and live in a SEPARATE SQLite database co-located with
// memory.db, attached to the same connection under this schema name. See
// storage/derived-db.ts.
export const DERIVED_DB_FILENAME = "codebase.db";
export const DERIVED_SCHEMA = "derived";

// ── Time (ms) — TTL building blocks (single source) ─────────────────────
// Declared before RECENCY_HALF_LIFE_MS so derived constants can reference
// them. Replace inline `60*60*1000` / `24*60*60*1000` math with these.
export const TTL_MS_PER_HOUR = 60 * 60 * 1000;
export const TTL_MS_PER_DAY = 24 * TTL_MS_PER_HOUR;

// ── Hybrid scoring weights (SPEC-001) ────────────────────────────────────
// 0.40 similarity + 0.30 keyword + 0.15 recency + 0.15 domain.
// Shared by memory-read, task-read, and standard-read search engines.
export const HYBRID_WEIGHTS = {
	similarity: 0.4,
	keyword: 0.3,
	recency: 0.15,
	domain: 0.15
} as const;

// ── Recency decay ────────────────────────────────────────────────────────
// Exponential half-life used by computeRecencyScore (default, 30 days).
export const RECENCY_HALF_LIFE_MS = 30 * TTL_MS_PER_DAY;
// Standard recency half-life (e^(-age/180d) — standards age slower than
// memories/tasks; used by STANDARD_SCORING in utils/scoring.ts).
export const STANDARD_RECENCY_HALF_LIFE_MS = 180 * TTL_MS_PER_DAY;

// ── Confidence buckets (per-entity-kind) ────────────────────────────────
// Final-score thresholds that map a blended hybrid score to a confidence
// label (high/medium/low). Memory and task share the default bucket;
// standard adds keyword-relevance OR conditions (see STANDARD_SCORING in
// utils/scoring.ts).
export const DEFAULT_CONFIDENCE_THRESHOLDS = { high: 0.7, medium: 0.4 } as const;
export const STANDARD_CONFIDENCE_THRESHOLDS = { high: 0.72, medium: 0.42 } as const;
export const STANDARD_KEYWORD_CONFIDENCE_THRESHOLDS = { high: 0.85, medium: 0.45 } as const;

// ── Adaptive search thresholds ───────────────────────────────────────────
// Small result sets (<= 5 candidates) use the lenient threshold so sparse
// corpora still return results; larger sets use the stricter threshold.
export const SEARCH_THRESHOLDS = {
	memory: { smallSet: 0.1, largeSet: 0.4 },
	task: { smallSet: 0.08, largeSet: 0.2 },
	standard: { smallSet: 0.08, largeSet: 0.2 }
} as const;

// ── Vector candidate caps ────────────────────────────────────────────────
export const VECTOR_CANDIDATE_CAP = envInt("VECTOR_CANDIDATE_CAP", 100);
// Floor for the candidate pool fetched by similarity searches so conflict
// checks and small fetches still evaluate O(10) rows.
export const MIN_CANDIDATES = envInt("VECTOR_MIN_CANDIDATES", 10);
// Cold-start fallback: how many recent rows are re-fetched when the primary
// candidate pool is nearly empty.
export const COLD_START_RECENT_LIMIT = 10;
// Default candidate pool for standard similarity searches (searchBySimilarity).
export const STANDARD_CANDIDATE_CAP = 60;
// Candidate pool used by standard-write conflict checks.
export const STANDARD_CONFLICT_CANDIDATES = 80;

// ── Similarity fallbacks / boosts ────────────────────────────────────────
// Score assigned when cosine similarity is 0 (term-less query or no overlap).
export const SIMILARITY_ZERO_FALLBACK = 0.16;
// Bonus added to a memory's similarity score when its repo matches the query
// repo (memory.vector searchBySimilarity).
export const REPO_MATCH_BOOST = 0.1;

// ── Memory search knowledge-debt signals (TASK-423) ──────────────────────
// Unacknowledged memories (recall_count === 0, see isMemoryAcknowledged)
// represent knowledge debt — never recalled/used via acknowledge("used").
// They get a small boost riding the 0.15 domain slot (max +0.0225 on the
// composite) so they surface above equal-relevance acknowledged memories for
// work-themed queries, without overriding genuine relevance.
export const MEMORY_UNACKNOWLEDGED_DOMAIN_BOOST = 0.15;
// task_archive entries are completed-work records (session summaries), not
// active knowledge. On keyword-heavy queries ("task", "completed") their
// bm25 title match would otherwise dominate work-themed results via
// title-keyword collision ("Completed Task: ..."). A small domain penalty
// (max -0.03 on the composite) keeps them from crowding out
// decision/pattern/code_fact at comparable relevance. Display is further
// capped per group by the search renderer.
export const MEMORY_TASK_ARCHIVE_DOMAIN_PENALTY = 0.2;

// ── task_archive retention (TASK-039) ────────────────────────────────────
// Completed-task archives (type='task_archive') are the single largest memory
// class — 65% of all memory rows and ~13MB of content on a real deployment,
// growing ~66/day — and were COMPLETELY unbounded: archiveTaskToMemory wrote
// them with no TTL, so nothing ever expired them. The existing maintenance
// sweep already flips any memory whose expires_at has passed into
// status='archived' (MemoryArchiveEntity.archiveExpiredMemories, invoked with
// force=true by runStartupMaintenance), so giving archives a TTL is all that
// is needed to feed them into that sweep — no new maintenance code. A 180-day
// window keeps the recent session history agents actually consult while
// bounding steady-state growth (65% of memories ⇒ the largest lever). Env-
// overridable so operators can widen/narrow the retention window without a
// code change.
export const TASK_ARCHIVE_TTL_DAYS = envInt("TASK_ARCHIVE_TTL_DAYS", 180);

// Content cap for the AGGREGATED task_archive memory written when one
// archiveCompletedTasks call handles multiple task ids for the same repo
// (TASK-039). Coalescing N per-task archives into a single memory would
// otherwise let the merged content grow linearly with the batch size; the
// builder appends per-task summaries until this many characters are used and
// then notes how many tasks were elided. Individual (single-task) archives
// are NOT capped here — they retain the full task body as before.
export const TASK_ARCHIVE_AGGREGATE_MAX_CHARS = envInt("TASK_ARCHIVE_AGGREGATE_MAX_CHARS", 5_000);

// ── Conflict thresholds ──────────────────────────────────────────────────
// memory-write rejects creates whose content overlaps an existing memory
// above this cosine threshold.
export const MEMORY_CONFLICT_THRESHOLD = 0.85;
// Default threshold used by MemoryVectorEntity.checkConflicts when the caller
// does not pass one explicitly.
export const MEMORY_CHECK_CONFLICTS_THRESHOLD = 0.55;
// standard-write conflict cutoff — stricter than memory.
export const STANDARD_CONFLICT_THRESHOLD = 0.82;

// ── Batch sizes ──────────────────────────────────────────────────────────
export const DEFAULT_BATCH_SIZE = envInt("DEFAULT_BATCH_SIZE", 100);
// Chunk size for bulk UPDATE ... WHERE id IN (...) statements.
export const BULK_UPDATE_CHUNK_SIZE = 500;

// ── Time (ms) ────────────────────────────────────────────────────────────
// TTL building blocks (TTL_MS_PER_HOUR / TTL_MS_PER_DAY) are declared at the
// top of this file so derived constants can reference them.

// Minimum interval between WAL checkpoints triggered by dashboard reads
// (TASK-017). Checkpoint cost scales with WAL size, so per-request
// checkpoints were throttled to this window. WAL readers see committed data
// without a checkpoint, so this is purely a WAL-shrink frequency cap.
export const WAL_CHECKPOINT_INTERVAL_MS = envInt("WAL_CHECKPOINT_INTERVAL_MS", 10_000);

// TTL for cached per-repo index-staleness results (TASK-018). Staleness
// checking costs N filesystem stats per repo; within this window repeated
// index_status / staleness calls reuse the previous result.
export const INDEX_STALENESS_TTL_MS = envInt("INDEX_STALENESS_TTL_MS", 30_000);

// ── Embedding/KG outbox queue (TASK-013) ─────────────────────────────────
// Batch inference size K — jobs are claimed and embedded in batches of this
// many rows (design per MEM-368).
export const EMBEDDING_QUEUE_BATCH_SIZE = envInt("EMBEDDING_QUEUE_BATCH_SIZE", 32);

// ONNX inference thread cap (PERF-002). `@xenova/transformers` drives ORT with
// its defaults, so each embed wakes a full ORT thread pool sized to every core
// (a ~2-3 core CPU burst per inference on a busy daemon). Pinning the pool to a
// small fixed count bounds that burst WITHOUT changing embedding output — the
// thread count only affects scheduling, never the values. Default 1 (single
// thread, no worker pool) so the daemon stays quiet out of the box; operators
// can raise it via `EMBEDDING_ONNX_THREADS` for faster bulk embedding on idle
// hosts. Applied to BOTH the wasm backend (`wasm.numThreads`) and the native
// backend (`intraOpNumThreads`, plus `OMP_NUM_THREADS` set before the dynamic
// import in storage/vectors.ts). Clamped to >= 1: 0 means "auto/all cores" in
// ORT, which is exactly the burst this caps.
export const EMBEDDING_ONNX_THREADS = Math.max(1, envInt("EMBEDDING_ONNX_THREADS", 1));
// Eager vs lazy ONNX warm-up (PERF-005). The `full` runtime profile eagerly
// warms the semantic capability at startup, which loads the ONNX runtime + the
// embedding model into the resident set (~140-180 MB measured) even on a
// daemon that only serves lexical memory/task traffic. When enabled (default
// off), the embedding worker still starts its maintenance/poll loop and the
// semantic capability stays registered, but the model is loaded on FIRST USE —
// the first semantic read/write (via the capability-aware vector store) or the
// first claimed batch. Output-neutral: the same model, loaded later, so every
// embedding/indexing behavior is preserved while an idle daemon stays lean.
export const EMBEDDING_LAZY_WARMUP = envBool("EMBEDDING_LAZY_WARMUP", false);

// Wall-clock ceiling (ms) for the `full`-profile eager semantic (ONNX) warm-up
// at startup (FIX-034). The historical hard-coded 30s cap was exceeded on large
// DBs (the reported deployment ran a ~897 MB `codebase.db` and a ~2.7 GB
// `memory.db`) and surfaced as `Semantic warm-up timed out after 30s`, which
// aborted first tool calls. The warm-up is now BOTH env-configurable AND
// non-fatal + deferred (see services/startup-warmup.ts): a timeout only logs a
// degraded notice, the server keeps serving, and semantic features stay lazily
// available (they load on first use). Env-overridable so operators can widen it
// for slow disks; `0` disables the cap entirely (wait for the load to settle).
export const SEMANTIC_WARMUP_TIMEOUT_MS = envInt("SEMANTIC_WARMUP_TIMEOUT_MS", 30_000);

// Idle poll interval for the in-process lease worker.
export const EMBEDDING_QUEUE_POLL_INTERVAL_MS = envInt("EMBEDDING_QUEUE_POLL_INTERVAL_MS", 500);
// Idle backoff ceiling: when the queue is empty the poll interval grows
// exponentially (with jitter) up to this cap, so two workers never busy-spin
// or thundering-herd the same poll times (TASK-064 / MEM-475).
export const EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS = envInt("EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS", 10_000);
// Lease length for claimed jobs — a crash mid-batch is recovered after this
// window via lease expiry + reconcile (crash-safe per MEM-368).
export const EMBEDDING_QUEUE_LEASE_MS = envInt("EMBEDDING_QUEUE_LEASE_MS", 60_000);
// A job is poisoned (no further retries) after this many failed attempts.
export const EMBEDDING_QUEUE_POISON_THRESHOLD = 5;
// Exponential retry backoff base / ceiling (base * 2^(attempt-1)).
export const EMBEDDING_QUEUE_BACKOFF_BASE_MS = 1_000;
export const EMBEDDING_QUEUE_BACKOFF_MAX_MS = 60_000;
// Startup backfill cap: rows with missing/stale vectors enqueued per process
// start (bounds first-boot CPU; new writes are unaffected — they enqueue
// synchronously and drain within seconds).
export const EMBEDDING_QUEUE_BACKFILL_CAP = envInt("EMBEDDING_QUEUE_BACKFILL_CAP", 2_000);
// Backfill backpressure gate (TASK-068 S1 / TASK-069): startup backfill is
// skipped entirely when pending + claimed jobs already exceed this many —
// with a deep backlog a restart must NOT double-refill the queue. The queue
// drains the backlog it already has; backfill only runs when it is shallow.
export const EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE = envInt("EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE", 500);
// Size-driven drain cadence (TASK-068 S1 / TASK-069): after this many
// CONSECUTIVE non-empty batches the worker backs off to `pollIntervalMs`
// instead of the fast max(50, poll/2) — the queue is deep, so it keeps
// draining at a bounded rate instead of polling between batches at the
// half-interval. When the queue empties, the existing exponential idle
// backoff applies.
export const EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK = envInt("EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK", 5);
// Purge TTLs: completed jobs are swept after 6h (TASK-071 — done rows are
// pure history; 24h retention let queue_jobs scans grow needlessly), poisoned
// after 7d (kept longer for diagnostics).
export const EMBEDDING_QUEUE_DONE_TTL_MS = 6 * TTL_MS_PER_HOUR;
export const EMBEDDING_QUEUE_POISON_TTL_MS = 7 * TTL_MS_PER_DAY;
// Frequency of the purge sweep.
export const EMBEDDING_QUEUE_PURGE_INTERVAL_MS = 15 * 60 * 1000;

// ── Codebase file watcher (TASK-322 / US-08) ─────────────────────────────
// Polling sweep over autoIndexIfStale — deliberately NO fs.watch/chokidar
// (zero usage in src today; polling avoids per-process watcher lifecycle,
// cross-platform leaks, and double-index races). Hosted by the MCP server
// process ONLY (dashboard excluded — avoids cross-process double index).
// Sweep cadence: how often the watcher checks registered repos. Every tick
// costs one cheap MAX(last_indexed_at) query (never-indexed guard) + math per
// repo; the TTL below gates whether a full (incremental) index run is
// triggered.
export const FILE_WATCH_INTERVAL_MS = envInt("FILE_WATCH_INTERVAL_MS", 30_000);
// Floor for the sweep cadence: a zero/misconfigured interval would create a
// busy loop (review NIT, TASK-354). Applied in the FileWatcher constructor to
// both env- and option-provided intervals, so it is not itself env-tunable.
export const FILE_WATCH_INTERVAL_MIN_MS = 1_000;
// Per-repo re-entry cap (debounce): minimum period between trigger dispatches
// for the same repo — detection latency is ≤ this TTL (tunable). Deliberately
// > FILE_WATCH_INTERVAL_MS (default 5 min vs 30 s) so the cap meaningfully
// throttles. Keyed on the watcher's IN-MEMORY lastTriggeredAt, NOT DB
// last_indexed_at: a zero-parse run (untouched repo — the incremental planner
// marks every file "skip") never advances last_indexed_at, so a DB-keyed cap
// would re-trigger a full discovery walk every tick forever (TASK-354).
// Passed through to autoIndexIfStale as options.ttlMs so its internal
// DB-freshness check — the correctness backstop — agrees with the sweep's
// (deliberately SHORT vs the 24h CODEBASE_AUTO_INDEX_TTL default). Gate flag
// ENABLE_FILE_WATCHER (default enabled; "false" disables) lives in
// file-watcher.ts, mirroring the CODEBASE_AUTO_INDEX convention.
export const FILE_WATCH_TTL_MS = envInt("FILE_WATCH_TTL_MS", 300_000);

// ── KG graph (dashboard) ─────────────────────────────────────────────────
// Server-side edge cap for the KG graph endpoints (TASK-068 S2 / TASK-070):
// listGraphEdges returns the top-N highest-value edges (ranked by endpoint
// degree) instead of serializing the whole relations table (~22k edges ≈ 2MB
// JSON per request). listRelationsForGraph filters to the capped node subset
// and is bounded by the same limit, so payloads scale with the node cap.
export const KG_MAX_GRAPH_EDGES = envInt("KG_MAX_GRAPH_EDGES", 4_000);

// ── KG-context enrichment bounds (OPT-PERF-04) ───────────────────────────
// Maximum entity names fed into kgQuery's IN() scans on entities/relations
// from ANY context fetcher (memory/task/standard read paths). The fetchers
// resolve entity names first (observation text match or the v15 FTS token
// index over entities.name), then kgQuery slices the deduped set to this cap
// before issuing the entity + relation IN() lookups, so KG-context enrichment
// cost is bounded even when the resolved name set is large. Env-overridable
// so operators can widen the enrichment window without code changes.
export const KG_MAX_CONTEXT_ENTITIES = envInt("KG_MAX_CONTEXT_ENTITIES", 50);
// Maximum distinct tokens from the search text used to build the
// entity_names_fts MATCH query (v15). Bounds the OR-term count per read —
// entity names are short identifiers, so the first N tokens are a
// representative sample; the FTS query itself is LIMIT-capped downstream.
export const KG_CONTEXT_TEXT_TOKENS = envInt("KG_CONTEXT_TEXT_TOKENS", 40);

// Maximum relation rows returned by ONE KG-context enrichment lookup
// (`getRelationsFor`). The entity-name set is already capped at
// KG_MAX_CONTEXT_ENTITIES, but the EDGE fan-out of those names is not: a
// 50-name window over a hub-heavy graph resolved 37,815 edges ≈ 737k JSON
// chars ≈ 184k tokens in a single `memory-read` on a real 490k-edge repo —
// larger than most model context windows, for a payload the caller only
// ever samples. Edges are ranked by `confidence DESC` (migration v24) so
// the retained window is the most trustworthy slice: parser-deterministic
// codebase edges (0.9) and explicit/manual edges (1.0) outrank NLP
// co-occurrence guesses (0.55). Env-overridable; `0` disables the cap.
export const KG_MAX_CONTEXT_RELATIONS = envInt("KG_MAX_CONTEXT_RELATIONS", 500);

// ── KG co-occurrence extraction bound (audit F0) ──────────────────────────
// Maximum number of NLP-extracted entities per document that participate in
// the `co_mentioned` co-occurrence clique built by `saveExtractions`.
//
// The pair count of a clique is N(N-1)/2, so the edge cost is QUADRATIC in
// the entity count of a single document while the information value is not:
// on a real corpus 1.6% of documents (those above 30 entities) produced
// 91.5% of all co-occurrence edges, and one 292-entity file alone produced
// 42,486 of them. Capping the clique at the first N entities (extraction
// order: people → places → organizations → nouns, i.e. the most specific
// entity types first) keeps every document's edges bounded at N(N-1)/2 while
// leaving the entity + observation rows untouched — the cap applies ONLY to
// the co-occurrence edge fan-out, never to what the graph knows about.
//
// Measured on a 19,117-document corpus: 97.1% of documents are below the
// default cap and their edge sets are byte-identical; total co-occurrence
// pairs drop 724,843 → 79,067 (9.2x). Env-overridable; `0` disables
// co-occurrence edge generation entirely (entities/observations still saved).
export const KG_MAX_COOCCURRENCE_ENTITIES = envInt("KG_MAX_COOCCURRENCE_ENTITIES", 16);

// Maximum entities per side of the task↔parent `depends_on` cross-product
// built by `saveTaskRelations` (audit F13). The writer links EVERY entity of
// the child task to EVERY entity of its parent, so the edge cost is
// |child| × |parent| per task — the same quadratic shape as the co-occurrence
// clique, one step removed. Measured contribution on a real corpus: 260,421
// `depends_on` edges (20.2% of the whole graph) from 346 parented tasks, i.e.
// ~750 edges per parent link, one repo alone producing 136,960 edges from
// 2,106 × 622 endpoints. Capping both sides bounds each link at N² edges while
// keeping the most specific entity types (extraction order puts people /
// places / organizations before generic noun phrases).
export const KG_MAX_TASK_RELATION_ENTITIES = envInt("KG_MAX_TASK_RELATION_ENTITIES", 12);

// ── Action log retention (OPT-PERF-05) ───────────────────────────────────
// Row-count cap for action_log: the periodic soul-maintenance prune keeps at
// most this many NEWEST rows, deleting the oldest tail beyond the cap (the
// existing age-based 30-day prune also runs). Bounds the table even when the
// remaining rows are all recent. Env-overridable so operators can raise or
// lower the audit window without code changes.
export const ACTION_LOG_MAX_ROWS = envInt("ACTION_LOG_MAX_ROWS", 10_000);

// Age window (days) for the `observations` retention pass (STD-005 rule 4:
// caps live here and are env-overridable, never inlined at the call site). An
// observation older than this is eligible ONLY when its parent document is
// gone or it has no contract anchor (parent-aware — see
// `KnowledgeGraphRetentionEntity.deleteStaleObservations`); the window never
// age-only deletes a row a read path can still reach.
//
// Keep this EQUAL to `KG_RELATION_RETENTION_DAYS` below: the two halves of the
// graph share one lifecycle story (an orphaned observation is collected at N
// days, and an edge with no observed endpoint at N days), so the relation
// writer's age guard is safe against a fresh edge whose target observation has
// not landed yet.
export const KG_OBSERVATION_RETENTION_DAYS = envInt("KG_OBSERVATION_RETENTION_DAYS", 7);

// ── KG retention (audit F1) ───────────────────────────────────────────────
// `relations` had NO retention pass while `observations` was pruned at 7 days.
// Because entity-name resolution goes exclusively through `observations`, an
// edge whose endpoints lost every observation is permanently unreachable by
// every read path — but still occupied disk and still pinned its endpoint
// entities against the orphan sweep (which keeps any name referenced by a
// relation). On a real database that was 395,215 unreachable edges and the
// `relations` family had grown to 77% of total DB size.
//
// `pruneRelations` reclaims those edges. Age guard (days): an edge is only
// eligible once it is older than this AND both endpoints are unobserved, so a
// freshly written edge is never racing the sweep. 7 days matches the existing
// observation-retention window, keeping one consistent lifecycle story for the
// two halves of the same graph: an observation whose parent document is gone is
// collected after 7 days, and an edge with no observed endpoint after 7 days.
// The guard is what makes the sweep safe for `saveCodebaseRelations`, which can
// write an edge whose TARGET entity only gains its observation when the target's
// own file is indexed (minutes, not days).
export const KG_RELATION_RETENTION_DAYS = envInt("KG_RELATION_RETENTION_DAYS", 7);

// Per-run row cap for `pruneRelations`. Deleting an edge fires the v22
// `kg_degrees` triggers, so bulk deletes cost ~14k rows/s: an unbounded sweep
// of a 392k-row backlog measured 189s and held the write lock in multi-second
// bursts. The prune therefore reclaims at most this many rows per maintenance
// run and converges over successive runs. `0` disables the prune.
//
// BACKLOG-DRAIN RATIONALE (TASK-041). The prune runs at most once per 24h
// (`MAINTENANCE_INTERVAL_MS`). At the previous 50,000 default, a real
// deployment carrying a 4.28M-row prunable backlog against ~13-26k rows/day of
// new growth had a per-day reclaim capacity (50k) only ~2-4x the daily inflow,
// i.e. a ~116-178 day convergence window — the backlog effectively never
// drained. Raising the default to 500,000 gives ~20-40x headroom so the
// accumulated backlog drains in days, not months, while staying well inside a
// single maintenance run's budget.
//
// LOCK-HOLD TRADE-OFF. The run is still chunked (KG_RELATION_PRUNE_CHUNK) so
// each `BEGIN IMMEDIATE` holds the write lock for only ~250ms regardless of
// the per-run cap; raising the cap lengthens the TOTAL run (~4s at 50k → ~40s
// at 500k) but not any individual lock hold, so sibling writers are never
// starved past `busy_timeout`. Env-overridable (`KG_RELATION_PRUNE_MAX_ROWS`)
// so operators can dial it back on a slow disk.
export const KG_RELATION_PRUNE_MAX_ROWS = envInt("KG_RELATION_PRUNE_MAX_ROWS", 500_000);

// Rows deleted per `BEGIN IMMEDIATE` inside the prune. Bounds write-lock hold
// time so a concurrent MCP server / dashboard / indexer writer is never
// starved past busy_timeout (same discipline as EMBEDDING_QUEUE's
// BACKFILL_TXN_CHUNK). Deliberately kept small and independent of the per-run
// cap: raising KG_RELATION_PRUNE_MAX_ROWS lengthens the TOTAL run but never the
// individual lock hold. The prune loop clamps the batch to
// `min(chunkSize, maxRows - deleted)` so it also never over-deletes.
export const KG_RELATION_PRUNE_CHUNK = envInt("KG_RELATION_PRUNE_CHUNK", 2_000);

// Sentinel reported as `PruneRelationsResult.remaining` when a prune run hit
// the per-run cap and the exact remaining backlog was deliberately NOT counted
// (TASK-041). `countPrunableRelations` is a correlated full-table scan
// (~105s on a 7.4M-row table) that dwarfs the bounded delete, so it is only
// worth paying at the tail (when `deleted < maxRows` proves the sweep drained
// every eligible row). A negative value is unambiguous: every real count is
// >= 0. Consumers that only need "is there more work?" should test
// `remaining !== 0` (see maintenance-job's `truncated` log field).
export const KG_RELATION_PRUNE_REMAINING_UNKNOWN = -1;

// Rowid-window size for the SPARSE-predicate deletes in the maintenance sweep
// (`deleteStaleObservations` / `deleteOrphanEntities`). These statements use
// correlated `NOT EXISTS` predicates whose eligible set is a tiny fraction of
// the table (measured: ~204 of 369k observations; a few thousand of 299k
// entities), so a `... LIMIT n` chunk loop would still force one full-table
// correlated scan to find its first `n` matches. Windowing by `rowid` instead
// bounds EVERY synchronous unit to this many rows regardless of match density,
// keeping the maintenance sweep's `withExclusiveWrite` hold yielding to the
// event loop so proper-lockfile's 15s heartbeat can refresh. Deliberately
// independent of the relation-prune chunk: the per-row cost of these
// correlated subqueries differs from the trigger-heavy relation delete.
export const KG_PRUNE_WINDOW_CHUNK = envInt("KG_PRUNE_WINDOW_CHUNK", 2_000);

// ── Codebase ARCHITECTURE bounds (OPT-PERF-08) ───────────────────────────
// Max number of top-level exports (exported symbols with no parent) returned
// by an ARCHITECTURE read. The handler fetches them with a SQL LIMIT instead
// of filtering the full symbol set, so the payload never scales with the
// repo's total symbol count. Single source for the tool LIMIT and the
// buildArchitecture() default — keep them in sync.
export const ARCHITECTURE_TOP_LEVEL_EXPORTS_LIMIT = 50;

// ── Dead-code + hotspots bounds (TASK-319, phase dead-code) ───────────────
// Max entries in the ARCHITECTURE `deadCode.unreferenced` array (dead-code
// candidates — truly-dead first, entry-point-excluded after) and `deadCode.
// hotspots` array (top in-degree symbols by reference count). Both are
// output caps only — the text summary still reports FULL counts (dead vs
// entry-excluded) so a capped list never misleads about scale.
export const DEAD_CODE_UNREFERENCED_MAX = 20;
export const DEAD_CODE_HOTSPOTS_MAX = 10;
// Bounded candidate-universe cap for the dead-code scan: only top-level
// symbols (parent_symbol_id IS NULL — exported OR internal) are considered,
// fetched with a SQL LIMIT. Top-level symbols are a small fraction of the
// repo's members, and the architecture read already hydrates the full file
// list — this keeps the dead-code pass O(top-level symbols) instead of
// O(all symbols), mirroring the OPT-PERF-08 aggregate discipline. When the
// cap is hit, `totals.truncated` is set and surfaced in the coverage note.
export const DEAD_CODE_SCAN_LIMIT = 500;

// ── Codebase-read default result limits ───────────────────────────────────
// SEARCH mode default page size (was the schema default of 50 before the
// per-mode defaults were introduced by TASK-316; behavior preserved). CODE
// mode greps file CONTENTS, so a match line is far cheaper to consume than a
// symbol record — 10 matches is a tight default, offset paginates for more.
export const CODEBASE_SEARCH_DEFAULT_LIMIT = 50;
export const CODE_SEARCH_DEFAULT_LIMIT = 10;

// ── Codebase CODE mode (content grep) bounds (TASK-316) ───────────────────
// Snippet width around a match: ~40 chars on each side of the matched
// substring (~80 chars total), ellipsis-padded at line boundaries.
export const CODE_SEARCH_SNIPPET_CHARS = 80;
// Process-shared content cache (multi-agent): bounded by BOTH max entries and
// max bytes, LRU-evicted. Keyed by repo+file_path, validity keyed to the
// codebase_files row checksum (row changed ⇒ content reloaded on next access).
export const CODE_SEARCH_CACHE_MAX_FILES = envInt("CODE_SEARCH_CACHE_MAX_FILES", 256);
export const CODE_SEARCH_CACHE_MAX_BYTES = envInt("CODE_SEARCH_CACHE_MAX_BYTES", 16 * 1024 * 1024);
// Bounded read concurrency while grepping indexed files (mirrors the
// staleness-check STAT_CONCURRENCY pattern — never N parallel reads).
export const CODE_SEARCH_READ_CONCURRENCY = 16;
// ReDoS guard (TASK-344): maximum length of a caller-supplied regex needle.
// V8 has no RegExp timeout and the compiled regex runs per line against
// indexed files (10-100KB minified lines) on the PROCESS-SHARED server, so an
// over-long pattern multiplies the exponential-backtracking surface. Patterns
// longer than this are rejected with the INVALID_REGEX envelope — substring
// mode (the default) is unaffected and remains the safe path. Env-overridable
// (e.g. `CODE_SEARCH_MAX_REGEX_LENGTH=500`) so operators can widen the window
// without code changes.
export const CODE_SEARCH_MAX_REGEX_LENGTH = envInt("CODE_SEARCH_MAX_REGEX_LENGTH", 200);

// ── Codebase graph + file-content bounds (TASK-324, phase codebase-graph-ui) ──
// Dashboard graph endpoints (GET /api/codebase/graph, /symbol/callers,
// /file/content). Edge cap for the code-graph payload: the graph is assembled
// server-side (degree-ranked nodes, edges between the selected subset), so the
// payload stays bounded regardless of repo size. The 400 default sits inside
// the spec's 200-500 window; env-overridable so tests and operators can shrink
// it without code changes (mirrors CODE_SEARCH_CACHE_MAX_BYTES).
export const CODE_GRAPH_MAX_EDGES = envInt("CODE_GRAPH_MAX_EDGES", 400);
// Node (symbol) limits for the graph: default when `limit` is absent, and the
// hard clamp for a caller-supplied `limit`. Degree ranking selects the top-N
// symbols by reference count; edges whose both endpoints are selected are
// shipped, then trimmed to CODE_GRAPH_MAX_EDGES by combined-degree priority.
export const CODE_GRAPH_DEFAULT_NODE_LIMIT = 120;
export const CODE_GRAPH_MAX_NODES = 240;
// File-content line cap: GET/POST /api/codebase/file/content returns at most
// this many lines; `truncated` flags when the file was longer. Env-overridable
// so the truncation test can use a tiny cap.
export const FILE_CONTENT_MAX_LINES = envInt("FILE_CONTENT_MAX_LINES", 2000);

// ── TS semantic-signature enrichment (issue #89, TASK-015) ─────────────────
// The optional two-phase enrichment pass runs the TypeScript compiler API over
// already-structurally-indexed files to infer return/param/property types. It
// is ALWAYS isolated behind try/catch + a timeout (never fails structural
// indexing) and degrades gracefully when no tsconfig / TS deps are available.
/**
 * Master gate for the semantic enrichment pass. "false" disables it entirely.
 * DEFAULT IS OFF (TASK-018): the feature is documented as opt-in (CHANGELOG
 * 0.43.0, migration v28), and the per-file TS program+typecheck pass costs
 * ~0.3-1s/file — on by default it makes a 1000-file first index run several
 * minutes and blows the index perf budget. Operators opt in explicitly via
 * `CODEBASE_SEMANTIC_ENRICH=true`.
 */
export const CODEBASE_SEMANTIC_ENRICH = envBool("CODEBASE_SEMANTIC_ENRICH", false);
/** Per-file wall-clock ceiling for the enrichment pass (issue #89). */
export const CODEBASE_SEMANTIC_ENRICH_TIMEOUT_MS = envInt("CODEBASE_SEMANTIC_ENRICH_TIMEOUT_MS", 3_000);
/**
 * Opt-in gate for the proof-of-concept PHPStan adapter (issue #90). When "false"
 * (default) the adapter returns a graceful "not configured" degraded result so the
 * pipeline is never affected. A production phpstan wiring would key off this flag.
 */
export const CODEBASE_SEMANTIC_PHPSTAN_ENABLED = envBool("CODEBASE_SEMANTIC_PHPSTAN_ENABLED", false);

// ── Space reclamation / vacuum (TASK-033, TASK-034) ──────────────────────
// Pruning DELETE statements (action_log, observations, relations) free pages
// into SQLite's freelist but never shrink the file: without auto_vacuum, freed
// pages are reused by later writes, so a database whose peak working set has
// passed keeps its high-water-mark file size (measured: 4.93 GiB file, 25.18%
// freelist ≈ 1.24 GiB reclaimable). Reclaiming it needs either a one-time
// `VACUUM` (rewrites the whole DB; needs ~2x free disk + a full write lock) or
// `auto_vacuum = INCREMENTAL` + cheap `PRAGMA incremental_vacuum(N)` calls.
// These constants bound the operator-triggered conversion and the bounded
// per-maintenance-run incremental reclaim. See services/vacuum.ts.

// Opt-in operator gate for a startup space-reclamation pass (TASK-047). When
// "true" the MCP server runs `ensureIncrementalAutoVacuum` once at startup: it
// converts the store to `auto_vacuum = INCREMENTAL` (a full VACUUM rewrite,
// disk-guarded at 2x DB size + 16MiB) and reclaims the freelist, so an
// installed user finally has a SHIPPED path to shrink a bloated database
// (previously only a manual `sqlite3 "<db>" 'VACUUM;'` was possible — there was
// no CLI subcommand, npm script, env var, or endpoint). DEFAULT OFF: a full
// VACUUM needs a full write lock and ~2x free disk, so it is never implicit.
// Idempotent (no-op once auto_vacuum=2) and never throws. See services/vacuum.ts.
export const VACUUM_ON_STARTUP = envBool("VACUUM_ON_STARTUP", false);

// Freelist-ratio trigger for the operator recommendation log. When
// freelist_count / page_count reaches this ratio the maintenance sweep logs a
// one-line recommendation to run the deliberate vacuum path (a full VACUUM is
// never automatic — it is too heavy for startup). Env-overridable.
export const VACUUM_FREELIST_RATIO_THRESHOLD = envInt("VACUUM_FREELIST_RATIO_THRESHOLD", 0.2);

// Upper bound on pages freed by ONE `PRAGMA incremental_vacuum(N)` call in the
// maintenance sweep. incremental_vacuum is cheap (it moves up to N freelist
// pages to the end of the file and truncates) but each page move touches the
// file, so the per-run work is capped to keep the sweep's write-lock hold in
// the ms range. Bounded reclaim converges across maintenance cycles. Env-
// overridable. `0` disables the incremental reclaim.
export const VACUUM_INCREMENTAL_MAX_PAGES = envInt("VACUUM_INCREMENTAL_MAX_PAGES", 20000);

// Free-disk headroom multiplier required before a full `VACUUM` is attempted:
// VACUUM rewrites the entire database into a temporary file, so it needs at
// least ~1x the DB size free (2x is the safe working figure including the
// final copy + WAL). `ensureIncrementalAutoVacuum` skips with reason
// "insufficient_disk" when available < multiplier * dbBytes. Env-overridable.
export const VACUUM_DISK_HEADROOM_MULTIPLIER = envInt("VACUUM_DISK_HEADROOM_MULTIPLIER", 2);

// ── Cold-tier archive (TASK-036 / DB-shrink L3) ───────────────────────────
// Archived memories (status='archived') were retained in the hot database
// forever — archiving only flips `status`, so the rows (and their FTS/tag
// shadow data) kept consuming disk while no read path ever surfaced them.
// The cold tier offloads long-archived rows to a SEPARATE SQLite database
// (`cold-archive.db`, alongside memory.db) WITHOUT vectors, then deletes them
// from the hot store — bounding the hot file while keeping the content
// recoverable on demand. Retention is age-gated (updated_at older than
// COLD_ARCHIVE_RETENTION_DAYS) so recently-archived rows stay queryable in the
// hot store, and each maintenance run offloads at most
// COLD_ARCHIVE_OFFLOAD_MAX_ROWS rows in COLD_ARCHIVE_BATCH_SIZE-row
// transactions so a large backlog converges without starving writers
// (STD-005). The offload is copy → verify → delete and never throws.
export const COLD_ARCHIVE_DB_FILENAME = "cold-archive.db";
// Operator kill switch. Default ON: the offload is lossless (the copy is
// verified before the hot rows are deleted) and is the intended automatic
// shrink path; "false" disables it entirely.
export const COLD_ARCHIVE_ENABLED = envBool("COLD_ARCHIVE_ENABLED", true);
// Age guard (days): only rows archived for at least this long are offloaded.
export const COLD_ARCHIVE_RETENTION_DAYS = envInt("COLD_ARCHIVE_RETENTION_DAYS", 30);
// Per-run row cap (bounded sweep; a large backlog converges across the daily
// maintenance cycles instead of blocking one startup).
export const COLD_ARCHIVE_OFFLOAD_MAX_ROWS = envInt("COLD_ARCHIVE_OFFLOAD_MAX_ROWS", 5_000);
// Rows per BEGIN IMMEDIATE transaction — bounds the write-lock hold time.
export const COLD_ARCHIVE_BATCH_SIZE = envInt("COLD_ARCHIVE_BATCH_SIZE", 500);

// ── SQLite write-contention hardening (Phase 2) ──────────────────────────
// The store is opened with `journal_mode=WAL`, `busy_timeout`, and writes go
// through `BEGIN IMMEDIATE` (base.ts). Under heavy multi-process traffic a
// writer can still observe SQLITE_BUSY / "database is locked" when the busy
// handler itself cannot resolve the contention within the timeout window.
//
// busy_timeout is the FIRST line of defence: SQLite blocks and retries
// internally for this long before surfacing SQLITE_BUSY. The default was
// lowered to 5000 in TASK-064 to fail fast; the Phase-2 default raises it
// again (30s) so transient contention from a sibling writer (indexer,
// maintenance sweep, dashboard) resolves invisibly instead of bubbling up.
// Env-overridable so operators can dial it to their disk/latency profile.
export const MEMORY_DB_BUSY_TIMEOUT_MS = envInt("MEMORY_DB_BUSY_TIMEOUT_MS", 30_000);

// Bounded, jittered retry wrapper around write transactions (base.ts
// `transaction`). This is the SECOND line of defence: if SQLite still
// surfaces a TRANSIENT busy/locked error after busy_timeout, the transaction
// body is retried a bounded number of times with jittered backoff. Only
// transient errors (SQLITE_BUSY / "database is locked") are retried —
// constraint/validation errors propagate immediately so callers never see a
// duplicated non-idempotent side effect. better-sqlite3 is synchronous, so
// the backoff is a short blocking `Atomics.wait` sleep; the loop is bounded
// (attempts × base × jitter) and only runs on an otherwise-fatal error path.
export const SQLITE_WRITE_RETRY_ATTEMPTS = envInt("SQLITE_WRITE_RETRY_ATTEMPTS", 3);
// Base backoff between retry attempts, in milliseconds. Attempt N waits a
// jittered `base * 2^(N-1)` (capped) so two contending writers do not
// re-collide in lockstep (thundering-herd avoidance). Env-overridable.
export const SQLITE_WRITE_RETRY_BASE_MS = envInt("SQLITE_WRITE_RETRY_BASE_MS", 25);
// Ceiling for a single retry backoff, bounding worst-case blocking time.
export const SQLITE_WRITE_RETRY_MAX_MS = 1_000;

// ── Default owner/repo scope (FIX-110-A) ─────────────────────────────────
// Rootless clients (e.g. a remote HTTP MCP client that does NOT advertise MCP
// roots) cannot supply a workspace root, and a daemon whose CWD is `/` derives
// no plausible scope segment — so owner/repo resolution used to fail with
// "configure MCP workspace roots". These env defaults sit AFTER the roots/
// session inference tier and BEFORE the CWD fallback in the resolution chain:
//   explicit args > roots/session inference > LOCAL_MEMORY_DEFAULT_* >
//   GITHUB_REPOSITORY > daemon cwd.
// Read at module load here (snapshot constants) and re-read at call time in
// normalize-args.ts so tests can stub the env without a module reload.
export const LOCAL_MEMORY_DEFAULT_OWNER = envStr("LOCAL_MEMORY_DEFAULT_OWNER");
export const LOCAL_MEMORY_DEFAULT_REPO = envStr("LOCAL_MEMORY_DEFAULT_REPO");
// Lower-priority fallback: GitHub Actions exports `GITHUB_REPOSITORY` as
// "owner/repo". Accepted as a single combined source (split on the first "/").
export const GITHUB_REPOSITORY = envStr("GITHUB_REPOSITORY");

// ── MCP Streamable HTTP transport (opt-in) ────────────────────────────────
// A single long-lived daemon can serve MANY MCP clients over Streamable HTTP
// instead of each client spawning its own stdio server process, removing
// duplicated embedding/maintenance/indexing workers and cross-process SQLite
// write contention. Selected via `MCP_TRANSPORT=http`; stdio stays the
// default. HTTP config (host/path/token are strings and read inline at the
// call site per the repo convention):
export const MCP_HTTP_PORT = envInt("MCP_HTTP_PORT", 3457);
// A bearer token (MCP_HTTP_TOKEN) is REQUIRED when serving HTTP unless this
// escape hatch is explicitly set true for local dev. Default false: the
// server refuses to start an unauthenticated HTTP listener.
export const MCP_HTTP_ALLOW_INSECURE = envBool("MCP_HTTP_ALLOW_INSECURE", false);
// Idle TTL for a retained legacy (2025-era) HTTP session. Each legacy session
// owns a stateful transport + initialized McpServer; they are removed only on
// an explicit client DELETE (transport.onclose) or global close(). The MCP
// client SDK's normal close() does NOT send DELETE (only terminateSession()
// does, which this repo never calls), so without an idle sweep an abandoned
// session would pin its server + transport forever — unbounded map growth on a
// long-lived daemon. A sweep evicts any session unused for this long. Env-
// overridable so operators can tune the window without a code change.
export const MCP_HTTP_SESSION_IDLE_TTL_MS = envInt("MCP_HTTP_SESSION_IDLE_TTL_MS", 30 * 60 * 1000);

// Daemon/remote default for the SAME `MCP_HTTP_SESSION_IDLE_TTL_MS` env var
// (FIX-110-C). A remote client (e.g. Zed 1.21) holds one `Mcp-Session-Id` for
// its whole lifetime; evicting it makes the next call hit an unknown session.
// The daemon therefore keeps sessions alive far longer (2h) so evictions are
// rare — while a standalone/one-shot HTTP server keeps the shorter 30-min
// window. Both read the SAME env var, so an explicit `MCP_HTTP_SESSION_IDLE_TTL_MS`
// overrides BOTH defaults.
export const MCP_DAEMON_SESSION_IDLE_TTL_MS = envInt("MCP_HTTP_SESSION_IDLE_TTL_MS", 2 * TTL_MS_PER_HOUR);

// Stateless session recovery (FIX-110-C). When ON (default), a non-initialize
// request carrying an unknown/absent `mcp-session-id` is served by a fresh
// short-lived stateless transport instead of returning 404/400 — so a client
// that cached an evicted id self-heals WITHOUT stalling (it never has to
// re-initialize). When OFF, the historical 404/-32001 / 400/-32000 bodies are
// returned so the client's transport can recover by re-initializing. Env-
// overridable escape hatch for operators who prefer the strict contract.
export const MCP_HTTP_STATELESS_RECOVERY = envBool("MCP_HTTP_STATELESS_RECOVERY", true);

// Idle timeout for a legacy session's standalone SSE (`GET`) stream (FIX-028).
// The SDK transport serves the GET stream with NO idle/keep-alive/timeout at
// all, so an open stream is held for the client's ENTIRE session lifetime. On a
// long-lived daemon that pinned `pipeline(source, res)` for HOURS (observed:
// `GET /mcp ms:27971702` ≈ 7.8h), polluted the dashboard's request-duration
// metric with the stream's whole lifetime, and let the idle session sweep close
// a stream that was still live. The repo-side wrapper (`withSseIdleTimeout` in
// transport/http.ts) closes the stream once NO server→client data has flowed
// for this long, with a clean log; a live client reconnects (the SDK transport's
// normal behavior). Default 10 min — well under the 30-min session TTL so a
// quiet stream is bounded BEFORE the session sweep would race it. Env-
// overridable; `0` disables the bound (stream lives until the client leaves).
export const MCP_HTTP_SSE_IDLE_TIMEOUT_MS = envInt("MCP_HTTP_SSE_IDLE_TIMEOUT_MS", 10 * 60 * 1000);

// Keep-alive interval for an open SSE stream (FIX-028): a comment frame
// (`: keep-alive`) is written every this often so an idle-but-live stream is not
// dropped by an intermediary (proxy/NAT) between real server→client messages.
// Purely a transport keep-alive — it does NOT reset the idle timeout above, so
// the stream is still bounded. Env-overridable; `0` disables the pings.
export const MCP_HTTP_SSE_KEEPALIVE_INTERVAL_MS = envInt("MCP_HTTP_SSE_KEEPALIVE_INTERVAL_MS", 25 * 1000);

// ── Generic worker_threads pool (FEAT-DAEMON-002B) ────────────────────────
// Size of the generic bounded `node:worker_threads` pool (src/mcp/workers/
// pool.ts). A pool of N keeps N OS threads busy on CPU-bound work (tree-sitter
// parsing, embeddings) without starving the event loop. Default 2 keeps an idle
// daemon quiet; operators can raise it via `WORKER_POOL_SIZE`. The value is
// always capped at `os.availableParallelism()` inside the pool (see
// resolvePoolSize), so an over-large setting degrades to "all cores" rather
// than oversubscribing the host. An explicit per-pool `size` option takes
// precedence over this env var.
export const WORKER_POOL_SIZE = envInt("WORKER_POOL_SIZE", 2);

// ── Local bug telemetry ───────────────────────────────────────────────────
// Automatic capture of runtime errors (uncaught/unhandled, error-level logs,
// tool failures, dashboard 5xx) into the local `bug_reports` table. Local-only
// by default — no network. A remote sink (e.g. Sentry) can be attached at
// runtime via bugCapture.addSink() without changing the capture pipeline.
export const BUG_TELEMETRY_ENABLED = envBool("BUG_TELEMETRY_ENABLED", true);
export const BUG_TELEMETRY_RETENTION_DAYS = envInt("BUG_TELEMETRY_RETENTION_DAYS", 30);
export const BUG_TELEMETRY_MAX_ROWS = envInt("BUG_TELEMETRY_MAX_ROWS", 5000);
