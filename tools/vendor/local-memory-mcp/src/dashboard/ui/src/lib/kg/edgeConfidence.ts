/**
 * Per-edge confidence visual helpers (TASK-330, KGCONF-2).
 *
 * Backend (TASK-325) attaches a per-edge `confidence` REAL 0..1 to every
 * relation (migration v24; default 1.0). This module maps that value to the
 * shared visual language used by BOTH graph renderers (the legacy
 * KGCanvasRenderer and the neural renderer) and the header legend:
 *
 *   ≥0.85  → "high"   solid default color, full opacity
 *   0.6–0.85 → "medium" amber tint, slightly reduced opacity
 *   <0.6   → "low"    reddish tint, dimmer opacity
 *
 * Label rule: `relation_type` alone when confidence is missing or 1.0
 * (DB default — no "%" suffix saves label space), otherwise
 * `relation_type · NN%` (rounded). All strings are English.
 *
 * Pure functions only — no DOM/canvas access, so this stays unit-testable
 * and shared across renderers without creating a renderer dependency.
 */

export type EdgeConfidenceBucket = "high" | "medium" | "low";

export interface EdgeConfidenceColor {
	r: number;
	g: number;
	b: number;
}

/** Bucket → edge opacity multiplier (folds into the renderer's base alpha). */
export const EDGE_ALPHA_MULTIPLIERS: Record<EdgeConfidenceBucket, number> = {
	high: 1,
	medium: 0.8,
	low: 0.55
};

/**
 * Bucket → rgb tint for edge strokes and label text. `high` is `null` —
 * renderers keep their default (solid) edge color.
 */
export const EDGE_BUCKET_COLORS: Record<EdgeConfidenceBucket, EdgeConfidenceColor | null> = {
	high: null,
	medium: { r: 245, g: 158, b: 11 }, // amber (#f59e0b)
	low: { r: 239, g: 68, b: 68 } // red (#ef4444)
};

export const EDGE_CONFIDENCE_HIGH = 0.85;
export const EDGE_CONFIDENCE_MEDIUM = 0.6;

/**
 * Confidence → visual bucket. Undefined counts as "high" — the backend
 * defaults every row to 1.0 (first-write-wins insert), so a missing value is
 * an explicit-grade edge, not an unknown one.
 */
export function getEdgeConfidenceBucket(confidence?: number): EdgeConfidenceBucket {
	if (confidence === undefined || confidence >= EDGE_CONFIDENCE_HIGH) return "high";
	if (confidence >= EDGE_CONFIDENCE_MEDIUM) return "medium";
	return "low";
}

/**
 * Edge label text: `relation_type` alone for 1.0/missing (no "%" suffix),
 * otherwise `relation_type · NN%` with the percentage rounded.
 */
export function formatEdgeConfidenceLabel(relationType: string, confidence?: number): string {
	if (confidence === undefined || confidence >= 1) return relationType;
	return `${relationType} · ${Math.round(confidence * 100)}%`;
}
