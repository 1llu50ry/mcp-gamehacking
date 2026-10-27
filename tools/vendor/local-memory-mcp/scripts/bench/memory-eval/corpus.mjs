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

export const EN_SENTENCES = [
	"Workspace memory is indexed for fast semantic search across the project.",
	"The embedding vector is normalized before similarity computation.",
	"Content changes trigger a rebuild of the full-text index.",
	"Robust keyword search combines lexical and vector signals.",
	"Deploying the migration requires a schema version bump.",
	"The tokenizer splits content on word boundaries for prefix queries.",
	"Query latency improves when the index avoids a full table scan.",
	"Essential context is retrieved from long-term memory for the agent.",
	"Potential matches are scored with bm25 relevance ranking.",
	"The dashboard lists recent memories sorted by importance.",
	"Caching strategy uses an expiry policy with periodic reclamation.",
	"Multi-tenant isolation keeps every repository namespace separate.",
	"High-priority memories surface first in the ranked results.",
	"Recalling a technical decision requires exact identifier matching.",
	"Binary artifacts are excluded from the semantic index.",
	"A threshold on the composite score filters irrelevant candidates."
];
export const ID_SENTENCES = [
	"Sistem manajemen memori untuk agen pemrograman.",
	"Pengoptimalan kueri pencarian basis data dengan indeks teks lengkap.",
	"Penyimpanan vektor untuk kesamaan semantik antar dokumen.",
	"Pengindeksan teks lengkap menggunakan FTS5 dan tokenizer unicode.",
	"Cache hasil kueri untuk kinerja aplikasi yang lebih baik.",
	"Penjadwalan tugas latar belakang dilakukan secara berkala.",
	"Validasi skema antarmuka memakai Zod di lapisan kode.",
	"Skor hibrida menggabungkan kemiripan vektor dan kata kunci.",
	"Dokumentasi teknis ditulis dalam dua bahasa untuk aksesibilitas.",
	"Pengujian menyeluruh mencakup kasus positif dan negatif."
];
export const CJK_SENTENCES = [
	"记忆管理系统用于编程助手检索长期上下文。",
	"语义向量搜索与全文检索优化并行工作。",
	"数据库索引与查询性能分析在存储层完成。",
	"嵌入向量的相似度计算支撑混合排序算法。",
	"跨语言搜索质量评估覆盖英语印尼语和中文。",
	"基于FTS5的全文索引保留词前缀匹配能力。",
	"关键词权重在混合评分中占三成比例。",
	"缓存过期策略与回收机制避免陈旧数据。",
	"多租户隔离的数据库设计保障仓库级安全。",
	"技术决策记忆通过标识符精确匹配检索。"
];
export const MIXED_SENTENCES = [
	"RAG pipeline 用于代码库问答，召回层结合 bm25。",
	"vector 检索与 bm25 混合排序在 memory.read 中合并。",
	"Embedding 模型输出 384 维向量用于相似度计算。",
	"Artikel bahasa Indonesia membahas optimasi kueri dan pengindeksan.",
	"Memory berisi konteks untuk agen: skema, kontrak API, dan keputusan desain.",
	"查询速度在索引就绪后显著提升，全文检索替代全表扫描。"
];
export const TECH_PHRASES = [
	"uses the libsql driver for local persistence",
	"better-sqlite3 bindings compile the FTS5 extension",
	"tree-sitter grammar indexes source symbols",
	"supabase auth validates the dashboard session",
	"zod schema validation guards the tool inputs",
	"openai embeddings feed the vector index",
	"esbuild bundles the server entry point",
	"vitest runs the unit and integration suites",
	"chart.js renders the dashboard analytics",
	"svelte components compose the management UI"
];
export const STEMS = [
	["vector", "vectors", "vectorized", "vectorization", "vectorless"],
	["memory", "memories", "memoryless", "memorized", "memorize"],
	["search", "searches", "searching", "searchable", "searchability"],
	["index", "indexed", "indexing", "indexable", "indexer"],
	["token", "tokens", "tokenized", "tokenizer", "tokenization"],
	["query", "queries", "queryable", "querying", "queryer"],
	["cache", "cached", "caching", "caches", "cacheable"],
	["schema", "schemas", "schemaful", "schemaless", "schematic"],
	["deploy", "deployed", "deploying", "deployment", "deploys"],
	["sqlite", "sqlites", "sqlite3", "sqlitefile", "sqliteindex"]
];
export const TAG_POOL = [
	"data",
	"pipeline",
	"cache",
	"fts5",
	"vector",
	"embed",
	"sql",
	"id",
	"ui",
	"go",
	"ts",
	"backend",
	"performance",
	"semantic"
];
export const MEMORY_TYPES = ["code_fact", "decision", "mistake", "pattern", "task_archive"];

export const BENCH_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
export const BENCH_EPOCH_ISO = "2026-01-01T00:00:00.000Z";
export const BENCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function pickTags(rand) {
	const n = 1 + Math.floor(rand() * 3);
	const tags = [];
	while (tags.length < n) {
		const t = TAG_POOL[Math.floor(rand() * TAG_POOL.length)];
		if (!tags.includes(t)) tags.push(t);
	}
	return tags;
}

export function buildMemoryCorpus(rows, seed = 0x478, owner = "bench", repo = "bench-repo", opts = {}) {
	const benchEpochMs = Number.isFinite(opts.benchEpochMs) ? opts.benchEpochMs : BENCH_EPOCH_MS;
	const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : BENCH_MAX_AGE_MS;
	const rand = mulberry32(seed);
	const sentences = [...EN_SENTENCES, ...ID_SENTENCES, ...CJK_SENTENCES, ...MIXED_SENTENCES, ...TECH_PHRASES];
	const out = [];
	for (let i = 1; i <= rows; i++) {
		const base = sentences[Math.floor(rand() * sentences.length)];
		const stem = STEMS[Math.floor(rand() * STEMS.length)];
		const w1 = stem[Math.floor(rand() * stem.length)];
		const w2 = STEMS[Math.floor(rand() * STEMS.length)][Math.floor(rand() * 5)];
		const type = MEMORY_TYPES[Math.floor(rand() * MEMORY_TYPES.length)];
		const importance = 1 + Math.floor(rand() * 5);
		const tags = pickTags(rand);
		const title = `Memory ${i} ${w1}`;
		const content =
			`${base} ${w1} ${w2} token-${i} mkt${i} proj${i % 13} grp${i % 5}` +
			(i % 17 === 0 ? " café menu" : "") +
			(i % 11 === 0 ? " WORKSPACE-BINARY" : "") +
			` ${CJK_SENTENCES[i % CJK_SENTENCES.length]}`;
		const rowJitterMs = ((seed * 1000003) ^ (i * 2654435761)) >>> 0;
		const ageJitterMs = rowJitterMs % Math.max(1, maxAgeMs);
		const createdAtMs = benchEpochMs - ageJitterMs;
		const bumpMs = ((seed * 977) ^ (i * 1013904223) ^ importance) % 60_000;
		const updatedAtMs = createdAtMs + ((bumpMs >>> 0) % 60_000);
		out.push({
			id: `00000000-0000-4000-a000-${String(i).padStart(12, "0")}`,
			code: `MEM-${String(i).padStart(6, "0")}`,
			type,
			title,
			content,
			importance,
			agent: "bench",
			role: "benchmark",
			model: "bench-model",
			scope: { owner, repo },
			created_at: new Date(createdAtMs).toISOString(),
			updated_at: new Date(updatedAtMs).toISOString(),
			completed_at: null,
			hit_count: 0,
			recall_count: 0,
			last_used_at: null,
			expires_at: null,
			supersedes: null,
			status: "active",
			tags,
			metadata: {},
			is_global: false
		});
	}
	return out;
}
