/**
 * Deterministic corpus + query fixtures for the mid-word fallback benchmark
 * (TASK-483). No Date.now() / wall-clock values leak into the corpus — every
 * row is a pure function of the seed + index, so corpus composition is
 * byte-for-byte reproducible across runs / machines (given the same node +
 * better-sqlite3 build).
 *
 * The corpus is engineered so that a BOUNDED set of technical identifiers
 * (single tokens) is embedded across rows. These identifiers are chosen to
 * contain *internal* substrings (e.g. "tor" inside "vectorization", "dex"
 * inside "indexation", "zer" inside "tokenizer") that the production unicode61
 * FTS5 tokenizer (prefix-`*` shape) CANNOT surface, while ordinary prefix /
 * whole-word queries ("vec", "tok", "ind") ARE surfaced by FTS. That gap is
 * exactly what the bounded mid-word fallback is asked to recover.
 */

export function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Single-token technical identifiers. The internal-substring map below is the
// contract the benchmark relies on (used to reason about expected gap).
export const IDENT_POOL = [
	"vectorization",
	"tokenizer",
	"indexation",
	"memoryless",
	"searchable",
	"cacheable",
	"sqlitefile",
	"flexibility",
	"optimization",
	"serialization",
	"normalization",
	"tokenization"
];

export const SENTENCES = [
	"Workspace memory is indexed for fast retrieval across the project.",
	"The embedding vector is normalized before similarity computation.",
	"Content changes trigger a rebuild of the full-text index.",
	"Robust keyword search combines lexical and vector signals.",
	"Deploying the migration requires a schema version bump.",
	"Query latency improves when the index avoids a full table scan.",
	"Potential matches are scored with bm25 relevance ranking.",
	"The dashboard lists recent memories sorted by importance.",
	"Multi-tenant isolation keeps every repository namespace separate.",
	"High-priority memories surface first in the ranked results.",
	"A threshold on the composite score filters irrelevant candidates.",
	"Recall of a technical decision requires exact identifier matching."
];

export const TAG_POOL = [
	"data",
	"pipeline",
	"cache",
	"fts5",
	"vector",
	"embed",
	"sql",
	"ts",
	"backend",
	"performance",
	"semantic",
	"index"
];

export const SEED = 0x483;
export const OWNER = "bench";
export const REPO = "bench-repo";

function pickTags(rand) {
	const n = 1 + Math.floor(rand() * 3);
	const tags = [];
	while (tags.length < n) {
		const t = TAG_POOL[Math.floor(rand() * TAG_POOL.length)];
		if (!tags.includes(t)) tags.push(t);
	}
	return tags;
}

/**
 * Build `rows` deterministic memory rows. Each row embeds two identifiers so
 * the mid-word internal substrings appear in a predictable, reproducible
 * fraction of the corpus (roughly 2/IDENT_POOL.length of rows per identifier).
 */
export function buildCorpus(rows, seed = SEED, owner = OWNER, repo = REPO) {
	const rand = mulberry32(seed);
	const out = [];
	for (let i = 1; i <= rows; i++) {
		const base = SENTENCES[Math.floor(rand() * SENTENCES.length)];
		const id1 = IDENT_POOL[Math.floor(rand() * IDENT_POOL.length)];
		let id2 = IDENT_POOL[Math.floor(rand() * IDENT_POOL.length)];
		if (id2 === id1) id2 = IDENT_POOL[(IDENT_POOL.indexOf(id1) + 1) % IDENT_POOL.length];
		const tags = pickTags(rand);
		const content = `${base} ${id1} ${id2}`;
		out.push({
			id: i,
			title: `Memory ${i} ${id1}`,
			content,
			tags: tags.join(" "),
			owner,
			repo,
			status: "active"
		});
	}
	return out;
}

/**
 * Deterministic, *large-content* corpus used by the bounds-stress probe. Each
 * row is padded with pseudo-random filler so that scanning many rows exceeds
 * the hard timeout, letting the benchmark verify the timeout guard actually
 * truncates the scan (rather than merely never being reached).
 */
export function buildStressCorpus(rows, seed = SEED + 1, owner = OWNER, repo = REPO, fillerChars = 5000) {
	const rand = mulberry32(seed);
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const out = [];
	for (let i = 1; i <= rows; i++) {
		let filler = "";
		for (let c = 0; c < fillerChars; c++) filler += alphabet[Math.floor(rand() * alphabet.length)];
		out.push({
			id: i,
			title: `Stress ${i}`,
			content: filler,
			tags: "stress",
			owner,
			repo: `${repo}-stress`,
			status: "active"
		});
	}
	return out;
}
