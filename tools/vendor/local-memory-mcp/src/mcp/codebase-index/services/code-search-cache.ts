import fs from "node:fs";
import { CODE_SEARCH_CACHE_MAX_BYTES, CODE_SEARCH_CACHE_MAX_FILES } from "../../utils/constants";

// ═══════════════════════════════════════════════════════════════════════════
// PROCESS-SHARED LRU CONTENT CACHE
// ═══════════════════════════════════════════════════════════════════════════

interface CachedFileContent {
	/** codebase_files.checksum the content was loaded under (validity key). */
	checksum: string | null;
	content: string;
	sizeBytes: number;
}

const cacheKey = (repo: string, filePath: string): string => `${repo}\u0000${filePath}`;

/**
 * Bounded, process-shared LRU cache for indexed file contents (TASK-316).
 *
 * - Shared across ALL agent connections (module singleton) — never per-agent
 *   state, so multi-agent MCP sessions reuse each other's reads.
 * - Keyed by repo+file_path; the codebase_files ROW checksum is the validity
 *   key. A re-index updates the row (new checksum) ⇒ next access reloads from
 *   disk. A file edited on disk WITHOUT a re-index keeps serving the cached
 *   indexed content — the index is deliberately the source of truth, so
 *   content always matches what the symbol index describes.
 * - Bounded by CODE_SEARCH_CACHE_MAX_FILES + CODE_SEARCH_CACHE_MAX_BYTES,
 *   evicting least-recently-used until both caps hold.
 * - Thread-safety: Node is single-threaded, so Map mutations are atomic. The
 *   only reentrancy risk is interleaved async disk reads for the same key
 *   across concurrent sessions — guarded by a single-flight map (one read per
 *   key in flight; duplicates await the same promise).
 */
export class CodeSearchCache {
	private entries = new Map<string, CachedFileContent>();
	private inFlight = new Map<string, Promise<{ content: string; sizeBytes: number }>>();
	private totalBytes = 0;

	/**
	 * Resolve a file's content, loading from disk on miss / checksum change.
	 * A read failure propagates to the caller (the grep loop skips the file).
	 *
	 * Accounting is idempotent per key under concurrent access: after the
	 * single-flight read resolves, the insert path reconciles against the
	 * CURRENT map state (not the pre-await snapshot), so N simultaneous
	 * callers for one key subtract/add totalBytes exactly once.
	 */
	async getContent(repo: string, filePath: string, rowChecksum: string | null, absolutePath: string): Promise<string> {
		const key = cacheKey(repo, filePath);
		const cached = this.entries.get(key);

		// Validity keyed to the codebase_files row checksum (see class docs).
		if (cached && cached.checksum === rowChecksum) {
			// LRU refresh: delete + re-insert moves the entry to the newest end.
			this.entries.delete(key);
			this.entries.set(key, cached);
			return cached.content;
		}

		// Miss or stale — (re)load from disk, single-flight for concurrent
		// sessions. The derived cleanup chain consumes the rejection so a
		// failed read does not leave an unhandled rejection behind.
		let read = this.inFlight.get(key);
		if (!read) {
			read = fs.promises
				.readFile(absolutePath, "utf-8")
				.then((content) => ({ content, sizeBytes: Buffer.byteLength(content, "utf-8") }));
			this.inFlight.set(key, read);
			read.then(
				() => this.inFlight.delete(key),
				() => this.inFlight.delete(key)
			);
		}

		const loaded = await read;

		// Re-read the CURRENT map state: while we awaited the shared read,
		// another concurrent caller may already have inserted a fresh entry
		// for this key (single-flight). Reusing the pre-await `cached`
		// snapshot here would double-account totalBytes (N× inflate on
		// concurrent miss, N× subtract on concurrent stale reload) — the
		// subtract/add below must reconcile against whatever is in the map NOW.
		const current = this.entries.get(key);
		if (current && current.checksum === rowChecksum) {
			// Another caller already inserted a fresh entry (identical
			// checksum) — serve it; no accounting mutation.
			return current.content;
		}

		if (current) {
			this.totalBytes -= current.sizeBytes;
			this.entries.delete(key);
		}
		const entry: CachedFileContent = { checksum: rowChecksum, content: loaded.content, sizeBytes: loaded.sizeBytes };
		this.entries.set(key, entry);
		this.totalBytes += entry.sizeBytes;
		this.evictIfOverBudget();

		return entry.content;
	}

	/** Number of cached files (test/diagnostic helper). */
	get size(): number {
		return this.entries.size;
	}

	/** Total cached bytes (test/diagnostic helper). */
	get bytes(): number {
		return this.totalBytes;
	}

	/** Evict least-recently-used entries until BOTH caps are satisfied. */
	private evictIfOverBudget(): void {
		while (
			(this.entries.size > CODE_SEARCH_CACHE_MAX_FILES || this.totalBytes > CODE_SEARCH_CACHE_MAX_BYTES) &&
			this.entries.size > 0
		) {
			const oldestKey = this.entries.keys().next().value;
			if (oldestKey === undefined) break;
			const evicted = this.entries.get(oldestKey);
			if (!evicted) break;
			this.totalBytes -= evicted.sizeBytes;
			this.entries.delete(oldestKey);
		}
	}

	/** Clear the whole cache, or a single repo's entries (test/ops helper). */
	clear(repo?: string): void {
		if (repo === undefined) {
			this.entries.clear();
			this.totalBytes = 0;
			return;
		}
		const prefix = `${repo}\u0000`;
		for (const key of [...this.entries.keys()]) {
			if (key.startsWith(prefix)) {
				const entry = this.entries.get(key);
				if (entry) this.totalBytes -= entry.sizeBytes;
				this.entries.delete(key);
			}
		}
	}
}

/** Process-shared singleton — the ONE instance the tool handler uses. */
export const codeSearchCache = new CodeSearchCache();

/** Clear the shared cache (tests; also callable from ops/maintenance). */
export function clearCodeSearchCache(repo?: string): void {
	codeSearchCache.clear(repo);
}
