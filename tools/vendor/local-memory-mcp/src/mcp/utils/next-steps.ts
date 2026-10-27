/**
 * Shared helper: extract human-readable next-steps string from handoff context.
 * Used by handoff.write.ts — byte-identical to the local copy it replaced.
 */
export function extractNextSteps(context: Record<string, unknown> | undefined): string {
	const steps = context?.next_steps;
	if (!steps || !Array.isArray(steps) || steps.length === 0) {
		return "";
	}
	const joined = steps.map(String).join("; ");
	return joined.length > 300 ? joined.slice(0, 300) + "..." : joined;
}
