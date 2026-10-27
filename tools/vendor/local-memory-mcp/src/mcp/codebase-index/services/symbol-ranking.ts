/**
 * SymbolRankingService — in-memory ranking and filtering of CodebaseSymbols.
 *
 * No DB dependencies. Accepts CodebaseSymbol arrays, returns RankedSymbol arrays.
 *
 * Ranking tiers are applied sequentially — the first tier that produces matches
 * for a given symbol claims it. Ties within a tier are broken by:
 *   1. exported > non-exported
 *   2. shallow file_path > deep file_path (fewer path segments)
 *   3. alphabetical by name
 */

import type { CodebaseSymbol } from "../../types";

// ── Public types ────────────────────────────────────────────────────────

export enum RankTier {
	Exact = 1,
	CamelCase = 2,
	Prefix = 3,
	Substring = 4,
	FTS5 = 5
}

export interface RankedSymbol {
	symbol: CodebaseSymbol;
	rankTier: RankTier;
	/** 0.0 to 1.0 within tier — higher = better per tiebreaker rules. */
	score: number;
}

export interface SymbolFilter {
	kind?: string[];
	repo?: string;
	/** When non-empty, keeps only symbols whose `repo` is in this set (cross-repo search). */
	repos?: string[];
	filePath?: string;
	exportedOnly?: boolean;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Rank symbols against a query string.
 *
 * Empty query returns all symbols sorted alphabetically (all Tier.Exact, score 1.0).
 */
export function rankSymbols(symbols: CodebaseSymbol[], query: string): RankedSymbol[] {
	if (!query || query.trim() === "") {
		return symbols
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((symbol) => ({ symbol, rankTier: RankTier.Exact, score: 1.0 }));
	}

	const q = query.trim();

	// Assign each symbol to its best-matching tier
	const tiered: Map<RankTier, { symbol: CodebaseSymbol; matchDetails: MatchDetails }[]> = new Map();
	for (const tier of [RankTier.Exact, RankTier.CamelCase, RankTier.Prefix, RankTier.Substring, RankTier.FTS5]) {
		tiered.set(tier, []);
	}

	for (const symbol of symbols) {
		const details = classifyMatch(symbol, q);
		tiered.get(details.tier)!.push({ symbol, matchDetails: details });
	}

	// Flatten tiers and score within each
	const result: RankedSymbol[] = [];

	for (const tier of [RankTier.Exact, RankTier.CamelCase, RankTier.Prefix, RankTier.Substring, RankTier.FTS5]) {
		const bucket = tiered.get(tier)!;
		if (bucket.length === 0) continue;

		const scored = scoreBucket(bucket, tier);
		result.push(...scored);
	}

	return result;
}

/**
 * Filter symbols by optional criteria. All filters are AND-combined.
 */
export function filterSymbols(symbols: CodebaseSymbol[], filter: SymbolFilter): CodebaseSymbol[] {
	return symbols.filter((s) => {
		if (filter.kind && filter.kind.length > 0) {
			if (!filter.kind.includes(s.kind)) return false;
		}
		if (filter.repo && s.repo !== filter.repo) return false;
		if (filter.repos && filter.repos.length > 0 && !filter.repos.includes(s.repo)) return false;
		if (filter.filePath && s.file_path !== filter.filePath) return false;
		if (filter.exportedOnly && !s.exported) return false;
		return true;
	});
}

// ── Internal types ──────────────────────────────────────────────────────

interface MatchDetails {
	tier: RankTier;
	/** How exactly the match was found — used for intra-tier tiebreaking. */
	matchExactCase: boolean;
}

// ── Classification ──────────────────────────────────────────────────────

function classifyMatch(symbol: CodebaseSymbol, query: string): MatchDetails {
	const name = symbol.name;

	// Tier 1: Exact match
	if (name === query) return { tier: RankTier.Exact, matchExactCase: true };
	if (name.toLowerCase() === query.toLowerCase()) return { tier: RankTier.Exact, matchExactCase: false };

	// Tier 2: CamelCase match
	if (isCamelCaseQuery(query) && camelCaseContains(name, query)) {
		return { tier: RankTier.CamelCase, matchExactCase: false };
	}

	// Tier 3: Prefix match (case-insensitive)
	if (name.toLowerCase().startsWith(query.toLowerCase())) {
		return { tier: RankTier.Prefix, matchExactCase: false };
	}

	// Tier 4: Substring match (case-insensitive)
	if (name.toLowerCase().includes(query.toLowerCase())) {
		return { tier: RankTier.Substring, matchExactCase: false };
	}

	// Tier 5: FTS5 fallback — doc_comment match or partial in name (word boundary)
	const qLower = query.toLowerCase();
	const docComment = (symbol.doc_comment ?? "").toLowerCase();
	const signature = (symbol.signature ?? "").toLowerCase();
	if (docComment.includes(qLower) || signature.includes(qLower) || name.toLowerCase().includes(qLower)) {
		return { tier: RankTier.FTS5, matchExactCase: false };
	}

	// Should never reach here if symbols are pre-filtered, but be safe
	return { tier: RankTier.FTS5, matchExactCase: false };
}

// ── CamelCase helpers ───────────────────────────────────────────────────

/** Returns true if the query contains at least one camelCase boundary. */
function isCamelCaseQuery(query: string): boolean {
	return /[a-z][A-Z]/.test(query) || /[A-Z][a-z]/.test(query);
}

/** Like string.charCodeAt but for arbitrary index — returns 0 if out of bounds. */
function charCodeAt(s: string, i: number): number {
	return i < s.length ? s.charCodeAt(i) : 0;
}

/**
 * Split a string into camelCase parts.
 * "FooBar" → ["Foo", "Bar"]
 * "Foo" → ["Foo"]
 */
function splitCamelCase(s: string): string[] {
	const parts: string[] = [];
	let start = 0;
	for (let i = 1; i <= s.length; i++) {
		// Upper-to-lower transition (e.g. "Fo" → "Fo" | "o")
		if (charCodeAt(s, i) >= 97 && charCodeAt(s, i) <= 122 && charCodeAt(s, i - 1) >= 65 && charCodeAt(s, i - 1) <= 90) {
			if (i - 1 > start) {
				parts.push(s.slice(start, i - 1));
				start = i - 1;
			}
		}
		// Lower-to-upper transition (e.g. "barBaz" → "bar" | "Baz")
		if (charCodeAt(s, i) >= 65 && charCodeAt(s, i) <= 90 && charCodeAt(s, i - 1) >= 97 && charCodeAt(s, i - 1) <= 122) {
			parts.push(s.slice(start, i));
			start = i;
		}
	}
	parts.push(s.slice(start));
	return parts;
}

/**
 * Check whether `name` contains the camelCase pattern described by `query`.
 * Splits `query` into parts; all parts must appear in sequence within `name`
 * (case-insensitive). For example, "FooBar" matches "getFooBar", "MyFooBarBaz".
 */
function camelCaseContains(name: string, query: string): boolean {
	const parts = splitCamelCase(query);
	if (parts.length === 0) return false;

	const lowerName = name.toLowerCase();
	let pos = 0;
	for (const part of parts) {
		const lowerPart = part.toLowerCase();
		pos = lowerName.indexOf(lowerPart, pos);
		if (pos === -1) return false;
		pos += lowerPart.length;
	}
	return pos > 0 || parts.length > 0;
}

// ── Scoring ─────────────────────────────────────────────────────────────

/**
 * Score a bucket of symbols within a tier using tiebreaker rules:
 *   1. exact case match > case-insensitive match (only relevant for Tier.Exact)
 *   2. exported > non-exported
 *   3. shallow file_path > deep file_path
 *   4. alphabetical by name
 *
 * Scores are normalized to [0, 1] within the bucket.
 */
function scoreBucket(
	bucket: { symbol: CodebaseSymbol; matchDetails: MatchDetails }[],
	_tier: RankTier
): RankedSymbol[] {
	if (bucket.length === 0) return [];

	// Compute raw scores
	const raw: { item: (typeof bucket)[0]; score: number }[] = bucket.map((item) => {
		const { symbol, matchDetails } = item;

		// Base score
		let score = 0.6;

		// Case-exact bonus (Tier 1 only)
		if (matchDetails.matchExactCase) {
			score += 0.15;
		}

		// Exported boost — ensures exported always beats non-exported
		if (symbol.exported) {
			score += 0.2;
		}

		// Path depth — shallow paths rank higher
		const pathSegments = symbol.file_path.split("/").length;
		const pathBonus = (1 / Math.max(pathSegments, 1)) * 0.1;
		score += pathBonus;

		return { item, score };
	});

	// Sort by score descending, then by name ascending for ties
	raw.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		return a.item.symbol.name.localeCompare(b.item.symbol.name);
	});

	// Normalize scores to [0,1] within the bucket
	const minScore = raw[raw.length - 1].score;
	const maxScore = raw[0].score;
	const range = maxScore - minScore || 1;

	return raw.map((r) => ({
		symbol: r.item.symbol,
		rankTier: r.item.matchDetails.tier,
		score: range === 0 && raw.length === 1 ? 1.0 : parseFloat(((r.score - minScore) / range).toFixed(4))
	}));
}
