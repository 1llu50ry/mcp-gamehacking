import Database from "better-sqlite3";
import type { Statement } from "better-sqlite3";
import {
	MemoryEntry,
	MemoryRow,
	Task,
	TaskRow,
	CodingStandardEntry,
	CodingStandardRow,
	Handoff,
	HandoffRow,
	Claim,
	ClaimRow,
	CodebaseSymbol,
	CodebaseSymbolRow,
	MEMORY_STATUS_ACTIVE,
	TASK_STATUS_BACKLOG
} from "../types";
import { SQLITE_WRITE_RETRY_ATTEMPTS, SQLITE_WRITE_RETRY_BASE_MS, SQLITE_WRITE_RETRY_MAX_MS } from "../utils/constants";
import { logger } from "../utils/logger";

/**
 * SQLite result codes that represent TRANSIENT lock contention — a sibling
 * writer (another process or connection) holds the write lock and the busy
 * handler could not resolve it within `busy_timeout`. Retrying these is safe
 * because the transaction body was fully rolled back. Constraint / validation
 * errors (SQLITE_CONSTRAINT*, SQLITE_MISUSE, …) are deliberately NOT matched:
 * they are deterministic and must propagate so callers never observe a
 * duplicated non-idempotent side effect.
 */
const TRANSIENT_SQLITE_CODES = new Set([
	"SQLITE_BUSY",
	"SQLITE_BUSY_SNAPSHOT",
	"SQLITE_LOCKED",
	"SQLITE_LOCKED_SHAREDCACHE"
]);

/**
 * Whether `error` is a transient SQLite busy/locked error safe to retry.
 * Matches better-sqlite3's `error.code` first, then falls back to the message
 * text for wrapped/rethrown errors that lost their code.
 */
export function isTransientSqliteError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as { code?: unknown }).code;
	if (typeof code === "string" && TRANSIENT_SQLITE_CODES.has(code)) return true;
	return /database is (locked|busy)|database table is locked/i.test(error.message);
}

/**
 * Compute the jittered backoff before retry `attempt` (1-based: the just-failed
 * try). Exponential base growth capped at SQLITE_WRITE_RETRY_MAX_MS, plus
 * half-range jitter so two contending writers do not re-collide in lockstep.
 */
function computeRetryBackoffMs(attempt: number): number {
	const ceiling = Math.min(SQLITE_WRITE_RETRY_BASE_MS * 2 ** (attempt - 1), SQLITE_WRITE_RETRY_MAX_MS);
	// Random in [ceiling/2, ceiling] — a guaranteed minimum wait, still jittered.
	return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

/**
 * Build the CLEAR terminal error thrown once the bounded retry is exhausted
 * (FIX-032). The original transient error is preserved as `cause` and its
 * `code` is copied onto the wrapper, so:
 *   - the message names the operation, the attempt count, and the actionable
 *     recovery instead of surfacing a bare `database is locked`;
 *   - downstream classifiers that key on `.code` (embedding-queue
 *     `isBusyError`, transport disconnect guards) still see `SQLITE_BUSY`;
 *   - `mcp-error.classifyExpectedError`'s `/database is locked|SQLITE_BUSY/`
 *     match still flags the envelope `retryable: true` because the original
 *     message is embedded in the wrapper text.
 */
function buildWriteRetryExhaustedError(error: unknown, attempts: number): Error {
	const original = error instanceof Error ? error : new Error(String(error));
	const code = (original as { code?: unknown }).code;
	const wrapped = new Error(
		`SQLite write failed after ${attempts} attempt(s) due to persistent lock contention: ${original.message}. ` +
			"Another local-memory-mcp process (or an in-process maintenance/indexing sweep) is holding the write lock. " +
			"Retry the operation; if it persists, raise MEMORY_DB_BUSY_TIMEOUT_MS or stop the competing process.",
		{ cause: original }
	);
	if (typeof code === "string") (wrapped as { code?: string }).code = code;
	return wrapped;
}

/**
 * Block the (synchronous) thread for `ms` milliseconds. better-sqlite3 is
 * synchronous, so a blocking sleep is the only way to back off between retries
 * without yielding the transaction; the wait is bounded and only runs on an
 * otherwise-fatal error path. `Atomics.wait` on a throwaway SharedArrayBuffer
 * is the canonical synchronous sleep in Node.
 */
function sleepSync(ms: number): void {
	if (ms <= 0) return;
	const buffer = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(buffer, 0, 0, ms);
}

/**
 * Run a synchronous write transaction, retrying TRANSIENT SQLite busy/locked
 * errors a bounded number of times with jittered backoff. Non-transient errors
 * propagate immediately. Every retry is logged at `warn`; exhaustion is logged
 * at `error` and surfaces {@link buildWriteRetryExhaustedError} — a clear,
 * actionable terminal error that preserves the original `code`/`cause` rather
 * than a bare `database is locked` (FIX-032).
 */
export function runWithSqliteWriteRetry<T>(run: () => T): T {
	let attempt = 0;
	for (;;) {
		try {
			return run();
		} catch (error) {
			attempt += 1;
			if (!isTransientSqliteError(error)) {
				throw error;
			}
			if (attempt >= SQLITE_WRITE_RETRY_ATTEMPTS) {
				logger.error("[SQLite] write retry exhausted — surfacing terminal lock error", {
					attempts: attempt,
					error: error instanceof Error ? error.message : String(error),
					code: (error as { code?: unknown }).code
				});
				throw buildWriteRetryExhaustedError(error, attempt);
			}
			const backoffMs = computeRetryBackoffMs(attempt);
			logger.warn("[SQLite] transient write lock contention — retrying", {
				attempt,
				maxAttempts: SQLITE_WRITE_RETRY_ATTEMPTS,
				backoffMs,
				error: error instanceof Error ? error.message : String(error)
			});
			sleepSync(backoffMs);
		}
	}
}

export abstract class BaseEntity {
	constructor(protected db: Database.Database) {}

	/**
	 * Bounded prepared-statement cache (OPT-PERF-11). Keyed by SQL string so
	 * every call to {@link run}, {@link all}, or {@link get} reuses the native
	 * better-sqlite3 Statement instead of calling `db.prepare(sql)` per
	 * invocation. FIFO eviction at `STMT_CACHE_MAX` entries bounds memory even
	 * when dynamic `IN (...)` queries produce many distinct SQL strings.
	 *
	 * Safe because `this.db` is stable for the entity's lifetime (SQLiteStore
	 * never replaces the Database instance after construction).
	 */
	private _stmtCache = new Map<string, Statement>();
	private static readonly STMT_CACHE_MAX = 256;

	/**
	 * Return a cached prepared statement for `sql`, preparing and caching it on
	 * first access. Evicts the oldest entry when the cache is at capacity.
	 */
	protected prepare(sql: string): Statement {
		let stmt = this._stmtCache.get(sql);
		if (stmt) return stmt;
		stmt = this.db.prepare(sql);
		if (this._stmtCache.size >= BaseEntity.STMT_CACHE_MAX) {
			const firstKey = this._stmtCache.keys().next().value;
			if (firstKey !== undefined) this._stmtCache.delete(firstKey);
		}
		this._stmtCache.set(sql, stmt);
		return stmt;
	}

	protected transaction<T>(fn: () => T): T {
		// BEGIN IMMEDIATE grabs the SQLite write lock at transaction start, so a
		// read-then-write body can never hit SQLITE_BUSY_SNAPSHOT (immediate,
		// busy_timeout-immune) when another process commits mid-transaction
		// (TASK-064 / MEM-475). Better-sqlite3 v12 API: transaction(fn).immediate().
		//
		// Phase-2 hardening: the immediate transaction is additionally wrapped in
		// a bounded, jittered retry (runWithSqliteWriteRetry) so a transient
		// SQLITE_BUSY / "database is locked" that escapes busy_timeout is retried
		// instead of failing the write. Non-transient errors propagate unchanged;
		// exhaustion surfaces the clear terminal error from the wrapper.
		// Reentrancy is preserved: better-sqlite3 itself turns a nested call into
		// a SAVEPOINT, and the retry wrapper simply re-invokes the same closure.
		const immediate = this.db.transaction(fn).immediate;
		return runWithSqliteWriteRetry(() => immediate());
	}

	/**
	 * Delete every row matching a predicate, in bounded `rowid` windows, yielding
	 * to the event loop between windows.
	 *
	 * **Why not a `LIMIT`-based chunk loop** (the `deleteUnreachableRelations`
	 * shape): when the eligible rows are SPARSE, the first `... LIMIT n` chunk
	 * must scan the WHOLE table to find its `n` matches, so the first chunk is
	 * still one full-table correlated scan. Windowing by `rowid` instead bounds
	 * every synchronous unit to `chunkSize` rows regardless of match density, so
	 * a caller holding the exclusive write lock (proper-lockfile) can refresh its
	 * heartbeat between windows instead of letting the lock go stale and be
	 * stolen. Measured on a real deployment: `observations` (369k rows, ~204
	 * eligible) previously froze the event loop ~41s in a single DELETE.
	 *
	 * `predicateSql` must reference the row alias `_row` (never `o`/`e`/`t`, which
	 * collide with inner subquery aliases), must be a pure WHERE body (no leading
	 * `WHERE`), and must NOT itself filter on `rowid` — the window bounds are
	 * appended. `params` binds to `predicateSql` placeholders in order.
	 *
	 * @param table - Table name (from `constants.ts`, never inlined).
	 * @param predicateSql - WHERE body referencing alias `_row`.
	 * @param params - Parameters for `predicateSql`.
	 * @param chunkSize - Rowids examined per window (and per transaction).
	 * @returns Total rows deleted.
	 */
	protected async deleteWindowed(
		table: string,
		predicateSql: string,
		params: unknown[],
		chunkSize: number
	): Promise<number> {
		const chunk = Math.max(1, chunkSize);
		// `MAX(rowid)` on a rowid table is O(1) (SQLite reads the last page), so
		// the loop bound costs nothing next to the delete it bounds.
		const maxRowid = this.get<{ m: number | null }>(`SELECT MAX(rowid) AS m FROM ${table}`)?.m ?? 0;
		if (maxRowid <= 0) return 0;

		const deleteSql = `DELETE FROM ${table} WHERE rowid IN (
			SELECT _row.rowid FROM ${table} AS _row WHERE ${predicateSql} AND _row.rowid > ? AND _row.rowid <= ?
		)`;

		let deleted = 0;
		for (let lo = 0; lo < maxRowid; lo += chunk) {
			const hi = lo + chunk;
			deleted += this.transaction(() => this.run(deleteSql, [...params, lo, hi]).changes);
			// Yield between windows: lets the MCP server stay responsive and the
			// exclusive proper-lockfile refresh its 15s heartbeat while the
			// maintenance sweep holds `withExclusiveWrite`.
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
		return deleted;
	}

	/**
	 * Run a single write statement.
	 *
	 * A bare statement runs in autocommit mode (its own implicit transaction), so
	 * a transient SQLITE_BUSY here was previously NOT covered by the retry
	 * wrapper — only `transaction()` was. That left every single-statement write
	 * path (e.g. `MemoryEntity.insert`) able to surface a raw `database is
	 * locked` to callers (FIX-032). Such a statement is atomic and fully rolled
	 * back on failure, so it is safe to route through the same bounded retry.
	 *
	 * Inside an explicit transaction (`this.db.inTransaction`) the statement is
	 * part of the enclosing `transaction()` call, which already owns the retry —
	 * retrying a statement mid-transaction would be unsound — so no nested loop
	 * is added there.
	 */
	protected run(sql: string, params: unknown[] = []): { changes: number } {
		const stmt = this.prepare(sql);
		const execute = (): { changes: number } => ({
			changes: stmt.run(...(params as (string | number | null | Buffer)[])).changes
		});
		return this.db.inTransaction ? execute() : runWithSqliteWriteRetry(execute);
	}

	protected exec(sql: string): void {
		this.db.exec(sql);
	}

	protected all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
		const stmt = this.prepare(sql);
		return stmt.all(...(params as (string | number | null | Buffer)[])) as T[];
	}

	protected get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
		const stmt = this.prepare(sql);
		return stmt.get(...(params as (string | number | null | Buffer)[])) as T | undefined;
	}

	protected safeJSONParse<T>(json: string | null | undefined, defaultValue: T): T {
		if (!json) return defaultValue;
		try {
			return JSON.parse(json);
		} catch {
			return defaultValue;
		}
	}

	protected rowToMemoryEntry(row: MemoryRow): MemoryEntry {
		// Parse metadata JSON once — structuredData lives inside the same
		// metadata blob, so a single parse is split into both fields.
		const metadata = this.safeJSONParse<Record<string, unknown>>(row.metadata, {});
		const structuredData = (metadata.structuredData as Record<string, unknown> | undefined) ?? undefined;
		delete metadata.structuredData;

		return {
			id: row.id,
			code: row.code || undefined,
			type: row.type,
			title: row.title || "Untitled",
			content: row.content,
			importance: row.importance,
			agent: row.agent || "unknown",
			role: row.role || "unknown",
			model: row.model || "unknown",
			scope: {
				owner: row.owner,
				repo: row.repo,
				branch: row.branch ?? undefined,
				folder: row.folder ?? undefined,
				language: row.language ?? undefined
			},
			created_at: row.created_at,
			updated_at: row.updated_at,
			completed_at: row.completed_at ?? null,
			hit_count: row.hit_count ?? 0,
			recall_count: row.recall_count ?? 0,
			last_used_at: row.last_used_at ?? null,
			expires_at: row.expires_at ?? null,
			supersedes: row.supersedes ?? null,
			status: row.status || MEMORY_STATUS_ACTIVE,
			is_global: row.is_global === 1,
			tags: this.safeJSONParse<string[]>(row.tags, []),
			metadata,
			structuredData
		};
	}

	protected rowToTask(row: TaskRow): Task {
		return {
			id: row.id,
			owner: row.owner,
			repo: row.repo,
			task_code: row.task_code,
			phase: row.phase || "",
			title: row.title,
			description: row.description || null,
			status: row.status || TASK_STATUS_BACKLOG,
			priority: row.priority || 3,
			agent: row.agent || "unknown",
			role: row.role || "unknown",
			doc_path: row.doc_path ?? null,
			created_at: row.created_at,
			updated_at: row.updated_at,
			in_progress_at: row.in_progress_at ?? null,
			finished_at: row.finished_at ?? null,
			canceled_at: row.canceled_at ?? null,
			est_tokens: row.est_tokens || 0,
			commit_id: row.commit_id ?? null,
			changed_files: this.safeJSONParse<string[]>(row.changed_files, []),
			tags: this.safeJSONParse<string[]>(row.tags, []),
			suggested_skills: this.safeJSONParse<string[]>(row.suggested_skills, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {}),
			parent_id: row.parent_id ?? null,
			depends_on: row.depends_on ?? null,
			parent_code: row.parent_code ?? null,
			depends_on_code: row.depends_on_code ?? null,
			coordination: {
				active_claim_count: row.active_claim_count ?? 0,
				active_claim_agent: row.active_claim_agent ?? null,
				active_claim_role: row.active_claim_role ?? null,
				active_claim_claimed_at: row.active_claim_claimed_at ?? null,
				pending_handoff_count: row.pending_handoff_count ?? 0,
				pending_handoff_id: row.pending_handoff_id ?? null,
				pending_handoff_summary: row.pending_handoff_summary ?? null,
				pending_handoff_to_agent: row.pending_handoff_to_agent ?? null,
				pending_handoff_created_at: row.pending_handoff_created_at ?? null
			},
			comments_count: row.comments_count || 0
		};
	}

	/**
	 * Row mapper for coding_standards rows (shared by StandardEntity).
	 * Single source of truth — do not redefine in subclasses.
	 */
	protected rowToEntry(row: CodingStandardRow): CodingStandardEntry {
		return {
			id: row.id,
			code: row.code ?? undefined,
			title: row.title,
			content: row.content,
			parent_id: row.parent_id ?? null,
			context: row.context,
			version: row.version,
			language: row.language ?? null,
			stack: this.safeJSONParse<string[]>(row.stack, []),
			is_global: row.is_global === 1,
			owner: row.owner,
			repo: row.repo ?? null,
			tags: this.safeJSONParse<string[]>(row.tags, []),
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {}),
			created_at: row.created_at,
			updated_at: row.updated_at,
			hit_count: row.hit_count ?? 0,
			last_used_at: row.last_used_at ?? null,
			agent: row.agent,
			model: row.model
		};
	}

	/**
	 * Row mapper for codebase_symbols rows (shared by CodebaseSymbolEntity).
	 */
	protected rowToSymbol(row: CodebaseSymbolRow): CodebaseSymbol {
		return {
			id: row.id,
			repo: row.repo,
			file_path: row.file_path,
			name: row.name,
			kind: row.kind,
			exported: row.exported === 1,
			default_export: row.default_export === 1,
			start_line: row.start_line,
			start_col: row.start_col,
			end_line: row.end_line,
			end_col: row.end_col,
			signature: row.signature,
			doc_comment: row.doc_comment,
			parent_symbol_id: row.parent_symbol_id,
			semantic_signature: row.semantic_signature ?? null,
			semantic_source: row.semantic_source ?? null,
			semantic_updated_at: row.semantic_updated_at ?? null,
			source_fingerprint: row.source_fingerprint ?? null,
			created_at: row.created_at,
			updated_at: row.updated_at
		};
	}

	/**
	 * Row mapper for handoffs rows (shared by HandoffEntity). Accepts rows
	 * joined with tasks (task_code present) and plain handoff rows.
	 */
	protected rowToHandoff(row: HandoffRow): Handoff {
		return {
			id: row.id,
			owner: row.owner,
			repo: row.repo,
			from_agent: row.from_agent,
			to_agent: row.to_agent ?? null,
			task_id: row.task_id ?? null,
			task_code: "task_code" in row ? ((row as HandoffRow & { task_code?: string | null }).task_code ?? null) : null,
			summary: row.summary,
			context: this.safeJSONParse<Record<string, unknown>>(row.context, {}),
			status: row.status as Handoff["status"],
			created_at: row.created_at,
			updated_at: row.updated_at,
			expires_at: row.expires_at ?? null
		};
	}

	/**
	 * Row mapper for claims rows (shared by HandoffEntity). Accepts rows
	 * joined with tasks (task_code present) and plain claim rows.
	 */
	protected rowToClaim(row: ClaimRow): Claim {
		return {
			id: row.id,
			owner: row.owner,
			repo: row.repo,
			task_id: row.task_id,
			task_code: "task_code" in row ? ((row as ClaimRow & { task_code?: string | null }).task_code ?? null) : null,
			agent: row.agent,
			role: row.role,
			claimed_at: row.claimed_at,
			released_at: row.released_at ?? null,
			metadata: this.safeJSONParse<Record<string, unknown>>(row.metadata, {})
		};
	}
}
