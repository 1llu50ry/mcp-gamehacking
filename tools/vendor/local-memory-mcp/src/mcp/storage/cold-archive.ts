import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { BaseEntity } from "./base";
import {
	TABLE_COLD_MEMORIES,
	COLD_ARCHIVE_DB_FILENAME,
	BULK_UPDATE_CHUNK_SIZE,
	MEMORY_DB_BUSY_TIMEOUT_MS
} from "../utils/constants";
import { chunksOf } from "../utils/chunk";
import type { MemoryEntry, MemoryRow, MemoryType, MemoryStatus } from "../types";

/**
 * Cold-archive entry — a memory row offloaded to the cold store.
 *
 * Identical to {@link MemoryEntry} plus `offloaded_at`, the timestamp the row
 * was copied into the cold database. Vector rows are deliberately absent: the
 * cold tier stores metadata/content only (TASK-036).
 */
export type ColdArchiveEntry = MemoryEntry & { offloaded_at: string };

/** Row shape of a `cold_memories` row — {@link MemoryRow} plus `offloaded_at`. */
type ColdMemoryRow = MemoryRow & { offloaded_at: string };

/**
 * Column list of the cold store, aligned with the hot `memories` schema minus
 * vector storage. Single source for INSERT + SELECT so a schema change is made
 * once (mirrors MemoryEntity.buildInsert discipline).
 */
const COLD_MEMORY_COLUMNS = [
	"id",
	"code",
	"repo",
	"owner",
	"type",
	"title",
	"content",
	"importance",
	"folder",
	"language",
	"branch",
	"created_at",
	"updated_at",
	"hit_count",
	"recall_count",
	"last_used_at",
	"expires_at",
	"supersedes",
	"status",
	"is_global",
	"tags",
	"metadata",
	"agent",
	"role",
	"model",
	"completed_at",
	"offloaded_at"
] as const;

/** Filter options for {@link ColdArchiveStore.searchColdMemories}. */
export interface ColdArchiveSearchOptions {
	owner?: string;
	repo?: string;
	type?: MemoryType;
	status?: MemoryStatus;
	/** Case-insensitive substring matched against title/content/tags. */
	query?: string;
	limit?: number;
	offset?: number;
}

/** Default page size for cold search when the caller omits `limit`. */
const COLD_SEARCH_DEFAULT_LIMIT = 50;

/**
 * Derive the cold-archive database path that sits alongside the hot memory DB.
 *
 * `:memory:` maps to `:memory:` so tests keep both stores off disk.
 */
export function resolveColdArchivePath(hotDbPath: string): string {
	if (hotDbPath === ":memory:") return ":memory:";
	return path.join(path.dirname(hotDbPath), COLD_ARCHIVE_DB_FILENAME);
}

/** Escape LIKE metacharacters so a search needle is treated as literal text. */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Cold-tier archive store: a SEPARATE SQLite database holding offloaded
 * archived memories WITHOUT vectors (TASK-036 / DB-shrink L3).
 *
 * The hot `memories` table stays the source of truth for live data; this store
 * is an append-mostly archive whose rows are reached on demand via
 * {@link searchColdMemories} / {@link getColdMemoryById}. Schema mirrors the
 * hot `memories` columns (minus vector storage) plus `offloaded_at`. WAL mode
 * matches the hot store so readers never block the offload writer.
 *
 * Extends {@link BaseEntity} to reuse its prepared-statement cache, transaction
 * wrapper, and `rowToMemoryEntry` mapper (single source of truth for the row →
 * entry projection).
 */
export class ColdArchiveStore extends BaseEntity {
	private readonly coldPath: string;

	/**
	 * Open (creating if needed) the cold-archive database and ensure its schema.
	 *
	 * @param coldPath - Path to the cold DB (`:memory:` for tests).
	 */
	constructor(coldPath: string) {
		if (coldPath !== ":memory:") {
			const dir = path.dirname(coldPath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		}

		const db = new Database(coldPath);
		super(db);
		this.coldPath = coldPath;

		// WAL + NORMAL mirror the hot store (see SQLiteStore constructor); an
		// in-memory DB silently keeps its memory journal, which is fine.
		// busy_timeout uses the shared MEMORY_DB_BUSY_TIMEOUT_MS so a cold-tier
		// offload batch contends with a sibling writer on the same terms as the
		// hot store instead of failing after a fixed 5s (FIX-032).
		db.pragma("journal_mode = WAL");
		db.pragma("synchronous = NORMAL");
		db.pragma(`busy_timeout = ${MEMORY_DB_BUSY_TIMEOUT_MS}`);

		this.initSchema();
	}

	/**
	 * Create the cold table + read-path indexes. Idempotent (`IF NOT EXISTS`)
	 * so every process that opens the cold DB can call it safely.
	 */
	private initSchema(): void {
		this.exec(`
			CREATE TABLE IF NOT EXISTS ${TABLE_COLD_MEMORIES} (
				id TEXT PRIMARY KEY,
				code TEXT,
				repo TEXT NOT NULL,
				owner TEXT NOT NULL DEFAULT '',
				type TEXT NOT NULL,
				title TEXT,
				content TEXT NOT NULL,
				importance INTEGER NOT NULL,
				folder TEXT,
				language TEXT,
				branch TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				hit_count INTEGER NOT NULL DEFAULT 0,
				recall_count INTEGER NOT NULL DEFAULT 0,
				last_used_at TEXT,
				expires_at TEXT,
				supersedes TEXT,
				status TEXT NOT NULL DEFAULT 'archived',
				is_global INTEGER NOT NULL DEFAULT 0,
				tags TEXT,
				metadata TEXT,
				agent TEXT NOT NULL DEFAULT 'unknown',
				role TEXT NOT NULL DEFAULT 'unknown',
				model TEXT NOT NULL DEFAULT 'unknown',
				completed_at TEXT,
				offloaded_at TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_cold_memories_owner_repo ON ${TABLE_COLD_MEMORIES}(owner, repo);
			CREATE INDEX IF NOT EXISTS idx_cold_memories_status ON ${TABLE_COLD_MEMORIES}(status);
			CREATE INDEX IF NOT EXISTS idx_cold_memories_type ON ${TABLE_COLD_MEMORIES}(type);
			CREATE INDEX IF NOT EXISTS idx_cold_memories_updated_at ON ${TABLE_COLD_MEMORIES}(updated_at);
		`);
	}

	/** Absolute path (or `:memory:`) of the cold database file. */
	getColdPath(): string {
		return this.coldPath;
	}

	/**
	 * Insert/replace a batch of memory rows in ONE transaction.
	 *
	 * `INSERT OR REPLACE` keyed on the `id` PK makes a retried offload
	 * idempotent: a copy that succeeded before a crash is overwritten, never
	 * duplicated. Rows are supplied already selected from the hot store.
	 *
	 * @param rows - Hot-store rows to archive.
	 * @param offloadedAt - ISO timestamp recorded on every row.
	 * @returns Number of rows written.
	 */
	insertMemories(rows: MemoryRow[], offloadedAt: string): number {
		if (rows.length === 0) return 0;

		const columns = COLD_MEMORY_COLUMNS.join(", ");
		const placeholders = COLD_MEMORY_COLUMNS.map(() => "?").join(", ");
		const sql = `INSERT OR REPLACE INTO ${TABLE_COLD_MEMORIES} (${columns}) VALUES (${placeholders})`;

		return this.transaction(() => {
			let count = 0;
			for (const row of rows) {
				this.run(sql, [
					row.id,
					row.code ?? null,
					row.repo,
					row.owner,
					row.type,
					row.title ?? null,
					row.content,
					row.importance,
					row.folder ?? null,
					row.language ?? null,
					row.branch ?? null,
					row.created_at,
					row.updated_at,
					row.hit_count ?? 0,
					row.recall_count ?? 0,
					row.last_used_at ?? null,
					row.expires_at ?? null,
					row.supersedes ?? null,
					row.status,
					row.is_global ?? 0,
					row.tags ?? null,
					row.metadata ?? null,
					row.agent ?? "unknown",
					row.role ?? "unknown",
					row.model ?? "unknown",
					row.completed_at ?? null,
					offloadedAt
				]);
				count++;
			}
			return count;
		});
	}

	/**
	 * Count how many of `ids` are present in the cold store. Chunked to stay
	 * under SQLite's bound-variable limit. Used as the pre-delete verification.
	 */
	countByIds(ids: string[]): number {
		if (ids.length === 0) return 0;

		let total = 0;
		for (const chunk of chunksOf(ids, BULK_UPDATE_CHUNK_SIZE)) {
			const row = this.get<{ c: number }>(
				`SELECT COUNT(*) AS c FROM ${TABLE_COLD_MEMORIES} WHERE id IN (${chunk.map(() => "?").join(",")})`,
				chunk
			);
			total += row?.c ?? 0;
		}
		return total;
	}

	/**
	 * Fetch a single archived memory by id, or `null` when absent.
	 */
	getColdMemoryById(id: string): ColdArchiveEntry | null {
		const row = this.get<ColdMemoryRow>(`SELECT * FROM ${TABLE_COLD_MEMORIES} WHERE id = ?`, [id]);
		return row ? this.toEntry(row) : null;
	}

	/**
	 * Search archived memories with optional owner/repo/type/status filters and
	 * a literal substring `query` over title/content/tags. Newest `updated_at`
	 * first, paginated by `limit`/`offset`.
	 *
	 * Deliberately LIKE-based (not FTS): the cold tier is an on-demand archive,
	 * so a bounded index-backed scan keeps the store simple and trigger-free.
	 */
	searchColdMemories(options: ColdArchiveSearchOptions = {}): ColdArchiveEntry[] {
		const { owner, repo, type, status, query } = options;
		const limit = Math.max(1, Math.floor(options.limit ?? COLD_SEARCH_DEFAULT_LIMIT));
		const offset = Math.max(0, Math.floor(options.offset ?? 0));

		const where: string[] = [];
		const params: (string | number)[] = [];

		if (owner) {
			where.push("owner = ?");
			params.push(owner);
		}
		if (repo) {
			where.push("repo = ?");
			params.push(repo);
		}
		if (type) {
			where.push("type = ?");
			params.push(type);
		}
		if (status) {
			where.push("status = ?");
			params.push(status);
		}
		if (query && query.trim()) {
			const needle = `%${escapeLike(query.trim())}%`;
			where.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')");
			params.push(needle, needle, needle);
		}

		const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
		const rows = this.all<ColdMemoryRow>(
			`SELECT * FROM ${TABLE_COLD_MEMORIES} ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		);
		return rows.map((row) => this.toEntry(row));
	}

	/** Total rows held in the cold store. */
	countColdMemories(): number {
		return this.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${TABLE_COLD_MEMORIES}`)?.c ?? 0;
	}

	/** Checkpoint and close the cold database connection (best effort). */
	close(): void {
		if (this.db && this.db.open) {
			try {
				this.db.pragma("wal_checkpoint(PASSIVE)");
			} catch {
				// best effort — closing must not throw
			}
			this.db.close();
		}
	}

	/** Project a cold row to a {@link ColdArchiveEntry}. */
	private toEntry(row: ColdMemoryRow): ColdArchiveEntry {
		return { ...this.rowToMemoryEntry(row), offloaded_at: row.offloaded_at };
	}
}
