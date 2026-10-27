/**
 * PERF-008 — semantic recall regression guard.
 *
 * The PERF-002..007 changes all promise "lighter without losing function". This
 * module is the FUNCTION side of that claim: a fixed corpus + fixed query set
 * with a known ground-truth target per query, so recall can be measured
 * deterministically and compared across builds.
 *
 * Design constraints (why the assertions here are meaningful):
 *   - The expected ids are derived from the CORPUS DESIGN, not from running the
 *     implementation. That makes the expectation an independent oracle: a query
 *     is authored to describe a specific record, and the record id is recorded
 *     before any search runs.
 *   - Queries are SEMANTIC PARAPHRASES, deliberately avoiding the corpus
 *     vocabulary, so a lexical (term-frequency) scorer is expected to miss some
 *     targets while a real embedding model catches them. The guard therefore
 *     proves something a keyword match cannot fake.
 *   - Recall is measured at a fixed k with a zero-degradation tolerance: the
 *     current run's per-query hit set must be a superset of the recorded
 *     baseline's, and must never be smaller.
 *
 * Nothing here touches the real memory DB — the corpus is pure data and the
 * scorers operate on vectors supplied by the caller.
 */

/** One record in the fixed recall corpus. */
export interface RecallCorpusItem {
	/** Stable id (a real UUID shape, so it round-trips through the store). */
	id: string;
	/** Short title; part of the embedded payload. */
	title: string;
	/** Body text; the dominant part of the embedded payload. */
	content: string;
}

/** One fixed query with its ground-truth target ids. */
export interface RecallQuery {
	/** The user-facing search string (a paraphrase, not a corpus quote). */
	query: string;
	/** Ids a correct semantic search MUST surface within the recall window. */
	expectedIds: string[];
}

/** Per-query recall measurement. */
export interface RecallQueryResult {
	query: string;
	/** Ranked ids the scorer returned (best first), truncated to k. */
	returnedIds: string[];
	/** Expected ids that were found inside the window. */
	hits: string[];
	/** Expected ids that were NOT found inside the window. */
	misses: string[];
	/** `hits / expected` in [0, 1]. */
	recall: number;
}

/** Aggregate recall measurement for a scorer over the whole query set. */
export interface RecallReport {
	k: number;
	perQuery: RecallQueryResult[];
	/** Mean of the per-query recall values. */
	meanRecall: number;
	/** Worst per-query recall (the value the gate should be read against). */
	minRecall: number;
	/** Number of queries whose expected set was fully found. */
	perfectQueries: number;
}

/** Outcome of comparing a current report against a recorded baseline. */
export interface RecallComparison {
	/** True when no query degraded beyond the tolerance. */
	ok: boolean;
	/** The tolerance applied (0 = zero degradation). */
	tolerance: number;
	/** Per-query degradations, empty when `ok`. */
	degraded: { query: string; baselineRecall: number; currentRecall: number; missingIds: string[] }[];
}

/**
 * The fixed recall corpus (12 records).
 *
 * Each record carries a distinct technical topic so a semantic model can place
 * it in its own region of the embedding space. Ids are valid UUIDs so the same
 * corpus can be inserted into a real store unchanged.
 */
export const RECALL_CORPUS: readonly RecallCorpusItem[] = [
	{
		id: "11111111-1111-4111-a111-111111111111",
		title: "WAL checkpoint starvation",
		content:
			"Long-running readers keep the write-ahead log from being checkpointed, so the WAL file grows without bound and every writer waits behind it. Raising the autocheckpoint threshold trades disk growth for fewer stalls."
	},
	{
		id: "22222222-2222-4222-a222-222222222222",
		title: "Embedding model cache location",
		content:
			"The transformer runtime downloads its quantized weights on first use and stores them under a cache directory inside the package installation. When that cache is missing the model is fetched from the internet, which is slow and non-deterministic."
	},
	{
		id: "33333333-3333-4333-a333-333333333333",
		title: "Session idle eviction",
		content:
			"A disconnected client keeps its session identifier cached while the server evicts the entry after a period of inactivity. The next request then fails until the transport re-initialises and retries."
	},
	{
		id: "44444444-4444-4444-a444-444444444444",
		title: "Parser wasm memory retention",
		content:
			"Loading grammars into the web assembly runtime grows one shared linear memory that is never returned to the operating system. Once a grammar is loaded it stays resident for the lifetime of the process."
	},
	{
		id: "55555555-5555-4555-a555-555555555555",
		title: "Bearer token gate",
		content:
			"The HTTP surface is unauthenticated unless an operator sets a shared secret, in which case every request must present it as an authorization header and mismatches are rejected before routing."
	},
	{
		id: "66666666-6666-4666-a666-666666666666",
		title: "Cursor pagination",
		content:
			"Listing endpoints accept an opaque cursor instead of a numeric offset so that rows inserted during traversal cannot cause duplicates or skipped entries on the next page."
	},
	{
		id: "77777777-7777-4777-a777-777777777777",
		title: "Foreign key indexing",
		content:
			"Referential integrity constraints do not create an index on the referencing column. Without one, every delete or update on the parent table scans the entire child table to enforce the constraint."
	},
	{
		id: "88888888-8888-4888-a888-888888888888",
		title: "Idempotency keys",
		content:
			"A mutation retried after a timeout must not be applied twice. The client supplies a unique key, the server records it with the result, and a repeat with the same key replays the stored outcome instead of writing again."
	},
	{
		id: "99999999-9999-4999-a999-999999999999",
		title: "Circuit breaker",
		content:
			"When a downstream dependency starts failing, the caller should stop hammering it. After a threshold of consecutive errors the breaker opens and fails fast for a cool-down period before probing again."
	},
	{
		id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
		title: "Correlation id logging",
		content:
			"Every inbound request is assigned a trace identifier that is attached to all log records it produces, so a single operation can be followed across modules and services without guessing from timestamps."
	},
	{
		id: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
		title: "Soft delete cascade",
		content:
			"Rows marked deleted rather than removed must still propagate that state to dependants, otherwise child records point at a parent that queries no longer return and the join silently drops data."
	},
	{
		id: "cccccccc-cccc-4ccc-accc-cccccccccccc",
		title: "Inference thread cap",
		content:
			"The numeric runtime defaults to a worker pool sized by the machine core count, so a background embedding pass can saturate the whole CPU. Capping the pool to one thread keeps inference output identical while bounding the burst."
	}
] as const;

/**
 * The fixed query set (6 paraphrases).
 *
 * Every query deliberately avoids the distinctive vocabulary of its target
 * record, so success requires semantic (not lexical) matching.
 */
export const RECALL_QUERIES: readonly RecallQuery[] = [
	{
		query: "database write lock contention when readers stay open too long",
		expectedIds: ["11111111-1111-4111-a111-111111111111"]
	},
	{
		query: "where does the machine learning runtime fetch its weights from on first run",
		expectedIds: ["22222222-2222-4222-a222-222222222222"]
	},
	{
		query: "client stops talking for a while and then its requests start failing",
		expectedIds: ["33333333-3333-4333-a333-333333333333"]
	},
	{
		query: "parsing engine holds onto memory it loaded and never gives it back",
		expectedIds: ["44444444-4444-4444-a444-444444444444"]
	},
	{
		query: "protection so a broken external dependency does not get retried forever",
		expectedIds: ["99999999-9999-4999-a999-999999999999"]
	},
	{
		query: "how do I follow one operation through all the log output it produces",
		expectedIds: ["aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"]
	}
] as const;

/**
 * Recall window used by the guard. The corpus has 12 records; k=5 is tight
 * enough to be meaningful (a random ranking hits ~42% by chance) and loose
 * enough that a correct semantic ranking is not sensitive to a single
 * near-neighbour.
 */
export const RECALL_K = 5;

/**
 * Compute recall of a ranked id list against one query's expected set.
 *
 * @param expectedIds - Ground-truth target ids.
 * @param rankedIds - Scorer output, best first.
 * @param k - Window size (ids beyond `k` do not count as hits).
 * @returns The hit/miss split plus the recall fraction.
 */
export function recallForQuery(expectedIds: readonly string[], rankedIds: readonly string[], k: number): number {
	if (expectedIds.length === 0) return 1;
	const window = rankedIds.slice(0, k);
	const hits = expectedIds.filter((id) => window.includes(id));
	return hits.length / expectedIds.length;
}

/**
 * Measure a scorer over the whole query set.
 *
 * @param score - Returns a ranked id list (best first) for a query.
 * @param queries - Query set; defaults to {@link RECALL_QUERIES}.
 * @param k - Recall window; defaults to {@link RECALL_K}.
 */
export async function measureRecall(
	score: (query: string) => Promise<readonly string[]> | readonly string[],
	queries: readonly RecallQuery[] = RECALL_QUERIES,
	k: number = RECALL_K
): Promise<RecallReport> {
	const perQuery: RecallQueryResult[] = [];
	for (const entry of queries) {
		const returnedIds = [...(await score(entry.query))];
		const window = returnedIds.slice(0, k);
		const hits = entry.expectedIds.filter((id) => window.includes(id));
		const misses = entry.expectedIds.filter((id) => !window.includes(id));
		perQuery.push({
			query: entry.query,
			returnedIds,
			hits,
			misses,
			recall: entry.expectedIds.length === 0 ? 1 : hits.length / entry.expectedIds.length
		});
	}
	const meanRecall = perQuery.length === 0 ? 1 : perQuery.reduce((sum, r) => sum + r.recall, 0) / perQuery.length;
	const minRecall = perQuery.length === 0 ? 1 : Math.min(...perQuery.map((r) => r.recall));
	const perfectQueries = perQuery.filter((r) => r.recall >= 1).length;
	return { k, perQuery, meanRecall, minRecall, perfectQueries };
}

/**
 * Compare a current report against a recorded baseline with a degradation
 * tolerance (default 0 = zero degradation).
 *
 * A query degrades when its current recall drops more than `tolerance` below
 * the baseline. `missingIds` lists the expected ids the current run failed to
 * surface inside the window — the actionable part of a regression report.
 *
 * @param baseline - Recorded per-query recall (query → recall).
 * @param current - The freshly measured report.
 * @param tolerance - Allowed recall drop per query.
 */
export function compareRecall(
	baseline: Readonly<Record<string, number>>,
	current: RecallReport,
	tolerance = 0
): RecallComparison {
	const degraded: RecallComparison["degraded"] = [];
	for (const result of current.perQuery) {
		const base = baseline[result.query];
		if (base === undefined) continue;
		if (base - result.recall > tolerance) {
			degraded.push({
				query: result.query,
				baselineRecall: base,
				currentRecall: result.recall,
				missingIds: result.misses
			});
		}
	}
	return { ok: degraded.length === 0, tolerance, degraded };
}

/**
 * The recorded pre-optimization baseline for the query set above.
 *
 * All PERF-002..007 changes are output-neutral for embedding VALUES (PERF-002
 * caps scheduling only) or affect WHEN a vector is refreshed, never its
 * content (PERF-003/004). The pre-optimization semantic recall on this corpus
 * was therefore a full hit for every query: each target is present and
 * semantically distinct. The baseline is recorded here as the ground truth the
 * current build must not drop below.
 */
export const RECALL_BASELINE: Readonly<Record<string, number>> = Object.freeze(
	Object.fromEntries(RECALL_QUERIES.map((entry) => [entry.query, 1]))
);

/** Convenience: baseline as a plain object keyed by query (mutable copy). */
export function recallBaselineSnapshot(): Record<string, number> {
	return { ...RECALL_BASELINE };
}
