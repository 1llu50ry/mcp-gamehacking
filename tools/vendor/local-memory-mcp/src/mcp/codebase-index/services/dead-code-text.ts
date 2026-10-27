/**
 * Text rendering for the ARCHITECTURE-mode `deadCode` block (TASK-319).
 *
 * Extracted from dead-code.ts into its own module (TASK-366) so the analysis
 * module stays under the 500-line guideline; dead-code.ts re-exports this
 * function for import-surface compatibility (codebase.read.ts imports it from
 * ./dead-code). The type-only import below is erased at emit — no runtime
 * circular dependency between the modules.
 */

import type { DeadCodeBlock } from "./dead-code";

/**
 * Render the deadCode block for the architecture text summary. Returns "" for
 * an empty analysis (no refs, no candidates) so untouched-repo output stays
 * byte-identical to the pre-TASK-319 format.
 */
export function renderDeadCodeText(block: DeadCodeBlock): string {
	const t = block.totals;
	if (t.scanned === 0 && block.hotspots.length === 0) return "";

	const lines: string[] = ["\n### Dead Code"];
	if (t.scanned > 0) {
		lines.push(
			`Candidates: ${t.scanned} (dead: ${t.dead} · entry-excluded: ${t.entryExcluded})${t.truncated ? " · capped" : ""}`
		);
		for (const u of block.unreferenced) {
			const tag = u.entryPoint ? ` — ${u.entryPoint.type}` : " — dead";
			lines.push(`- \`${u.kind}\` ${u.name} L${u.line ?? "-"} ${u.file_path}${tag}`);
		}
	}
	if (block.hotspots.length > 0) {
		lines.push(`Hotspots (top ${block.hotspots.length} by reference count):`);
		for (const h of block.hotspots) {
			const kinds = Object.entries(h.topKinds)
				.map(([k, n]) => `${k} ${n}`)
				.join(", ");
			lines.push(`- \`${h.kind}\` ${h.name} ${h.file_path} — ${h.refCount} refs${kinds ? ` (${kinds})` : ""}`);
		}
	}
	const cov = block.coverageNote;
	if (cov) lines.push(`Coverage: ${cov}`);

	return lines.join("\n");
}
