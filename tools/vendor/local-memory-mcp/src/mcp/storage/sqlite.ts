import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { MigrationManager } from "./migrations";
import { MemoryEntity } from "../entities/memory";
import { MemoryVectorEntity } from "../entities/memory.vector";
import { MemoryArchiveEntity } from "../entities/memory.archive";
import { TaskEntity } from "../entities/task";
import { TaskCommentEntity } from "../entities/task-comment";
import { TaskStatsEntity } from "../entities/task-stats";
import { ActionEntity } from "../entities/action";
import { SystemEntity } from "../entities/system";
import { SummaryEntity } from "../entities/summary";
import { StandardEntity } from "../entities/standard";
import { HandoffEntity } from "../entities/handoff";
import { CodebaseFileEntity } from "../entities/codebase-file";
import { CodebaseSymbolEntity } from "../entities/codebase-symbol";
import { CodebaseReferenceEntity } from "../entities/codebase-reference";
import { KnowledgeGraphEntity } from "../entities/knowledge-graph";
import { ExplorationObservationEntity } from "../entities/exploration-observation";
import { ReuseTelemetryEntity } from "../entities/reuse-telemetry";
import { BugReportEntity } from "../entities/bug-report";
import { WriteLock } from "./write-lock";
import { ColdArchiveStore, resolveColdArchivePath } from "./cold-archive";
import type { ColdArchiveEntry, ColdArchiveSearchOptions } from "./cold-archive";
import { ensureDerivedReady, resolveDerivedDbPath } from "./derived-db";
import { logger } from "../utils/logger";
import { MEMORY_DB_BUSY_TIMEOUT_MS, WAL_CHECKPOINT_INTERVAL_MS } from "../utils/constants";

function resolveDbPath(): string {
	if (process.env.MEMORY_DB_PATH) return process.env.MEMORY_DB_PATH;

	const standardConfigDir =
		process.platform === "win32"
			? path.join(os.homedir(), ".local-memory-mcp")
			: process.platform === "darwin"
				? path.join(os.homedir(), "Library", "Application Support", "local-memory-mcp")
				: path.join(os.homedir(), ".config", "local-memory-mcp");

	const standardPath = path.join(standardConfigDir, "memory.db");
	if (fs.existsSync(standardPath)) return standardPath;

	const legacyPath = path.join(os.homedir(), ".config", "local-memory-mcp", "memory.db");
	if (fs.existsSync(legacyPath)) return legacyPath;

	const localCwdFile = path.join(process.cwd(), "storage", "memory.db");
	if (fs.existsSync(localCwdFile)) return localCwdFile;

	return standardPath;
}

const DB_PATH = resolveDbPath();

export class SQLiteStore {
	public db: Database.Database;
	public memories: MemoryEntity;
	public memoryVectors: MemoryVectorEntity;
	public memoryArchives: MemoryArchiveEntity;
	public tasks: TaskEntity;
	public taskComments: TaskCommentEntity;
	public taskStats: TaskStatsEntity;
	public actions: ActionEntity;
	public system: SystemEntity;
	public summaries: SummaryEntity;
	public standards: StandardEntity;
	public handoffs: HandoffEntity;
	public codebaseFiles: CodebaseFileEntity;
	public codebaseSymbols: CodebaseSymbolEntity;
	public codebaseReferences: CodebaseReferenceEntity;
	public knowledgeGraph: KnowledgeGraphEntity;
	public explorationObservations: ExplorationObservationEntity;
	public reuseTelemetry: ReuseTelemetryEntity;
	public bugReports: BugReportEntity;
	public lock: WriteLock;
	private dbPathInstance: string;
	/**
	 * Absolute path (or `:memory:`) of the derived database attached as schema
	 * `derived` (TASK-037). `null` only when the attach/schema step failed and
	 * the store is running in a degraded state.
	 */
	private derivedPathInstance: string | null = null;
	/**
	 * Lazily-opened cold-tier archive (TASK-036). Opened on first access only,
	 * so profiles that never offload or read the cold tier pay no second-DB
	 * cost. See {@link coldArchive}.
	 */
	private coldArchiveStore?: ColdArchiveStore;
	/** Last wall-clock time a WAL checkpoint ran (throttles refresh()). */
	private lastCheckpointAt = 0;

	constructor(dbPath?: string) {
		const finalPath = dbPath ?? DB_PATH;
		this.dbPathInstance = finalPath;

		if (finalPath !== ":memory:") {
			const dbDir = path.dirname(finalPath);
			if (!fs.existsSync(dbDir)) {
				fs.mkdirSync(dbDir, { recursive: true });
			}
		}

		this.db = new Database(finalPath);
		this.db.pragma("journal_mode = WAL");
		// synchronous=NORMAL is SQLite's documented recommendation under WAL:
		// FULL performs 2 fsyncs per commit for crash-durability of the very
		// last transaction, which WAL already provides for all prior commits
		// (NORMAL risks losing only the most recent commit on OS/power loss,
		// never corruption). FULL was a rollback-journal concern; keeping it
		// under WAL doubles write fsyncs for no integrity gain. See
		// https://sqlite.org/wal.html#synchronous.
		this.db.pragma("synchronous = NORMAL");
		// busy_timeout (Phase-2 hardening): SQLite blocks and retries internally
		// for this long before surfacing SQLITE_BUSY, so a transient hold by a
		// sibling writer (indexer, maintenance sweep, dashboard) resolves
		// invisibly instead of bubbling up. The default was lowered to 5000 in
		// TASK-064 to fail fast; Phase 2 raises it to 30s (MEMORY_DB_BUSY_TIMEOUT_MS)
		// now that the HTTP daemon can concentrate many clients on ONE writer —
		// correctness still comes from BEGIN IMMEDIATE transactions (base.ts) +
		// the bounded retry wrapper, so this is a latency/robustness knob, not a
		// lock-discipline substitute.
		this.db.pragma(`busy_timeout = ${MEMORY_DB_BUSY_TIMEOUT_MS}`);
		this.db.pragma("foreign_keys = ON");
		// wal_autocheckpoint = 1000 (was 100): checkpoint every ~4MB instead of
		// every ~400KB — frequent sync checkpoints on the writing connection
		// under multi-writer traffic caused checkpoint thrash (TASK-064).
		this.db.pragma("wal_autocheckpoint = 1000");

		// NOTE (TASK-033): `PRAGMA auto_vacuum` is deliberately NOT set here.
		// On an existing database the pragma alone is a silent no-op — it only
		// takes effect after a full VACUUM — so setting it in the constructor
		// would mislead readers into thinking space reclamation was enabled
		// when it was not. The one-time conversion (auto_vacuum=INCREMENTAL +
		// VACUUM, disk-guarded) and the bounded incremental reclaim live in
		// services/vacuum.ts and are invoked explicitly, never implicitly here.

		// Lightweight WAL checkpoint on startup (passive — does not block readers)
		if (finalPath !== ":memory:") {
			try {
				this.db.pragma("wal_checkpoint(PASSIVE)");
			} catch (err) {
				logger.warn("[SQLiteStore] WAL checkpoint failed on startup", { error: String(err) });
			}
		}

		const migrator = new MigrationManager(this.db);
		migrator.migrate();

		// Move derived data (the codebase index family + every *_vectors table)
		// into the separate `codebase.db` attached as schema `derived`
		// (TASK-037 / DB-shrink L4). Runs BEFORE entity construction so every
		// entity prepares its `derived.`-qualified SQL against the final schema.
		ensureDerivedReady(this.db, finalPath);
		this.derivedPathInstance = resolveDerivedDbPath(finalPath);

		// Re-assert + verify busy_timeout AFTER the derived attach (FIX-032).
		// busy_timeout is CONNECTION-scoped: a schema-qualified
		// `derived.busy_timeout` in attachDerivedDb rewrites the shared
		// connection's value, and any later connection-level pragma could too.
		// Read it back and restore the configured value so the write-contention
		// hardening is guaranteed to be in effect for every subsequent write.
		this.applyBusyTimeout();

		this.memories = new MemoryEntity(this.db);
		this.memoryVectors = new MemoryVectorEntity(this.db);
		this.memoryArchives = new MemoryArchiveEntity(this.db);
		this.tasks = new TaskEntity(this.db);
		this.taskComments = new TaskCommentEntity(this.db);
		this.taskStats = new TaskStatsEntity(this.db);
		this.actions = new ActionEntity(this.db);
		this.system = new SystemEntity(this.db);
		this.summaries = new SummaryEntity(this.db);
		this.standards = new StandardEntity(this.db);
		this.handoffs = new HandoffEntity(this.db);
		this.codebaseFiles = new CodebaseFileEntity(this.db);
		this.codebaseSymbols = new CodebaseSymbolEntity(this.db);
		this.codebaseReferences = new CodebaseReferenceEntity(this.db);
		this.knowledgeGraph = new KnowledgeGraphEntity(this.db);
		this.explorationObservations = new ExplorationObservationEntity(this.db);
		this.reuseTelemetry = new ReuseTelemetryEntity(this.db);
		this.bugReports = new BugReportEntity(this.db);
		this.lock = new WriteLock(finalPath);
	}

	/**
	 * Apply the configured connection-scoped `busy_timeout` (FIX-032) and log
	 * the value that is actually in effect.
	 *
	 * Called once during construction and again AFTER the derived-database
	 * attach, because `busy_timeout` is CONNECTION-scoped: a schema-qualified
	 * `derived.busy_timeout` (or any later connection-level pragma) silently
	 * rewrites it. Reading it back makes a future regression observable instead
	 * of latent.
	 */
	private applyBusyTimeout(): void {
		this.db.pragma(`busy_timeout = ${MEMORY_DB_BUSY_TIMEOUT_MS}`);
		const effective = this.getBusyTimeoutMs();
		if (effective !== MEMORY_DB_BUSY_TIMEOUT_MS) {
			logger.warn("[SQLiteStore] busy_timeout did not stick — write contention hardening degraded", {
				configured: MEMORY_DB_BUSY_TIMEOUT_MS,
				effective
			});
		}
	}

	/**
	 * The `busy_timeout` (ms) currently in effect on the connection. Used by
	 * tests to assert the hardening is applied (and not downgraded by a later
	 * pragma).
	 */
	getBusyTimeoutMs(): number {
		const rows = this.db.pragma("busy_timeout") as Array<{ timeout: number }>;
		return rows[0]?.timeout ?? 0;
	}

	/**
	 * Execute a (single-transaction) write operation, relying on SQLite's
	 * BEGIN IMMEDIATE + busy_timeout for mutual exclusion.
	 *
	 * FAST PATH (OPT-PERF-09): no proper-lockfile acquire/release and no
	 * intra-process promise chain — each mutation is an atomic synchronous
	 * BEGIN IMMEDIATE transaction, so SQLite's own single-writer protocol
	 * already excludes concurrent writers.
	 *
	 * @example
	 * await db.withWrite(() => db.tasks.insertTask(task));
	 */
	async withWrite<T>(fn: () => Promise<T> | T): Promise<T> {
		return this.lock.withLock(fn);
	}

	/**
	 * Execute a COMPOUND write sequence under the proper-lockfile — reserved
	 * for genuinely cross-process compound mutations (a body of several
	 * BEGIN IMMEDIATE transactions that must not interleave with another
	 * process's same-class sequence), e.g. the maintenance sweep, codebase
	 * indexing writer, and task→memory archival.
	 *
	 * @example
	 * await db.withExclusiveWrite(() => { db.tasks.deleteTask(id); db.actions.prune(); });
	 */
	async withExclusiveWrite<T>(fn: () => Promise<T> | T): Promise<T> {
		return this.lock.withExclusiveLock(fn);
	}

	/**
	 * Checkpoint WAL so dashboard (and other readers) see latest data.
	 * Called by dashboard controllers before reads.
	 *
	 * Throttled: WAL readers see committed data without any checkpoint, so a
	 * per-request checkpoint would only pay WAL-shrink cost on every request.
	 * Checkpoints are therefore limited to one per WAL_CHECKPOINT_INTERVAL_MS
	 * (10s default) — the first call in each window still checkpoints, so a
	 * long-idle server never regresses visibility.
	 */
	async refresh(): Promise<void> {
		const now = Date.now();
		if (now - this.lastCheckpointAt < WAL_CHECKPOINT_INTERVAL_MS) return;
		this.lastCheckpointAt = now;
		try {
			this.db.pragma("wal_checkpoint(PASSIVE)");
		} catch (err) {
			logger.warn("[SQLiteStore] refresh checkpoint failed", { error: String(err) });
		}
	}

	async ready(): Promise<void> {
		// No-op: better-sqlite3 is synchronous
	}

	static async create(dbPath?: string): Promise<SQLiteStore> {
		return new SQLiteStore(dbPath);
	}

	getDbPath(): string {
		return this.dbPathInstance;
	}

	/**
	 * Absolute path (or `:memory:`) of the derived database attached as schema
	 * `derived`, or `null` when the store could not attach it (TASK-037).
	 */
	getDerivedDbPath(): string | null {
		return this.derivedPathInstance;
	}

	/**
	 * Re-ensure the derived database is attached and its schema + FTS triggers
	 * exist (TASK-037 self-heal). Idempotent; never throws — a failure is logged
	 * so a periodic maintenance sweep can recover from an interrupted move.
	 */
	ensureDerivedDb(): void {
		try {
			ensureDerivedReady(this.db, this.dbPathInstance);
		} catch (err) {
			logger.warn("[SQLiteStore] Derived DB self-heal failed", { error: String(err) });
		}
	}

	/**
	 * Lazily-open cold-tier archive store (TASK-036).
	 *
	 * The cold DB path is derived from the hot DB path (`cold-archive.db`
	 * alongside `memory.db`; `:memory:` stays in memory for tests), so both
	 * stores stay co-located. Constructed once and cached for the store's
	 * lifetime.
	 */
	get coldArchive(): ColdArchiveStore {
		this.coldArchiveStore ??= new ColdArchiveStore(resolveColdArchivePath(this.dbPathInstance));
		return this.coldArchiveStore;
	}

	/**
	 * Search cold-tier archived memories on demand (TASK-036 read path).
	 * Delegates to {@link ColdArchiveStore.searchColdMemories}.
	 */
	searchColdMemories(options?: ColdArchiveSearchOptions): ColdArchiveEntry[] {
		return this.coldArchive.searchColdMemories(options);
	}

	/**
	 * Fetch a single cold-tier archived memory by id (TASK-036 read path).
	 * Delegates to {@link ColdArchiveStore.getColdMemoryById}.
	 */
	getColdMemoryById(id: string): ColdArchiveEntry | null {
		return this.coldArchive.getColdMemoryById(id);
	}

	close(): void {
		this.coldArchiveStore?.close();
		this.coldArchiveStore = undefined;
		if (this.db && this.db.open) {
			try {
				this.db.pragma("wal_checkpoint(PASSIVE)");
			} catch {
				// best effort
			}
			this.db.close();
		}
	}
}

export async function createTestStore(): Promise<SQLiteStore> {
	return new SQLiteStore(":memory:");
}
