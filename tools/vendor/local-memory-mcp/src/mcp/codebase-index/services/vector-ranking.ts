/**
 * VectorRankingService — blends vector similarity scores with text-based ranking.
 *
 * Applies SPEC-001 hybrid scoring formula:
 *   final = (vector × 0.30) + (tier_score × 0.70)
 *
 * Within each rank tier, symbols are re-sorted by their blended score.
 * Gracefully falls back to text-only ranking if vector search fails.
 */

import { RankTier, type RankedSymbol } from "./symbol-ranking";
import type { VectorStore } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Apply SPEC-001 hybrid scoring to ranking results.
 *
 * Blends vector similarity (cosine) with the existing 5-tier text ranking score:
 *   final = (vector × 0.30) + (tier_score × 0.70)
 *
 * Within each rank tier, symbols are re-sorted by their blended score.
 * Falls back gracefully if vector search fails or returns nothing.
 */
export async function blendVectorRanking(
	ranked: RankedSymbol[],
	query: string,
	repo: string,
	vectors: VectorStore
): Promise<RankedSymbol[]> {
	if (ranked.length === 0) return ranked;

	try {
		const vectorResults = await vectors.search(query, ranked.length, repo, "codebase_symbol");
		if (vectorResults.length === 0) return ranked;

		// Build symbol_id → vector_score map
		const vectorMap = new Map<string, number>();
		for (const vr of vectorResults) {
			vectorMap.set(vr.id, vr.score);
		}

		// Group by rank tier, preserving tier order
		const tierGroups = new Map<RankTier, RankedSymbol[]>();
		for (const rs of ranked) {
			const group = tierGroups.get(rs.rankTier);
			if (group) {
				group.push(rs);
			} else {
				tierGroups.set(rs.rankTier, [rs]);
			}
		}

		// Re-score within each tier using SPEC-001 hybrid formula
		// final = (vector × 0.30) + (tier_score × 0.70)
		const result: RankedSymbol[] = [];
		for (const tier of [RankTier.Exact, RankTier.CamelCase, RankTier.Prefix, RankTier.Substring, RankTier.FTS5]) {
			const group = tierGroups.get(tier);
			if (!group || group.length === 0) continue;

			// Compute blended score, sort by it descending
			const withBlend = group.map((rs) => {
				const vecScore = vectorMap.get(rs.symbol.id) ?? 0;
				const blended = vecScore * 0.3 + rs.score * 0.7;
				return { ...rs, blended };
			});

			withBlend.sort((a, b) => b.blended - a.blended);

			// Write blended score back for output consistency
			for (const item of withBlend) {
				item.score = parseFloat(item.blended.toFixed(4));
				delete (item as Record<string, unknown>).blended;
			}

			result.push(...withBlend);
		}

		return result;
	} catch (err) {
		logger.warn("[blendVectorRanking] Vector search failed, falling back to text-only ranking", {
			error: err instanceof Error ? err.message : String(err)
		});
		return ranked;
	}
}
