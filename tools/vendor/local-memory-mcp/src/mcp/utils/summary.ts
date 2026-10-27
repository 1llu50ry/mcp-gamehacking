/**
 * Shared grouped content-summary renderer used by the three search engines
 * (memory-read by type, task-read by status, standard-read by scope).
 *
 * Shape (identical across engines):
 *   ### Results: {total} {kind} for "{query}" (showing {n})   ← result-level truncation marker
 *   > [N] = {scoreLabel} ({scoreRange}) · grouped by {dim}, ≤{cap} shown per group (+N more)
 *   **{groupLabel} ({count})**                                ← group header = count of matches in this group
 *   #{rank} {formatted line}                                  ← [N] = per-engine score (see formatOutputLegend)
 *   ... +N more in this group                                 ← group-level cap overflow marker
 *   <blank>
 *   {footer}
 *
 * Output conventions (TASK-424) — kept identical across engines via
 * {@link formatOutputLegend} so consumers interpret the metadata uniformly:
 *   - `(showing N)` at the result level  = number of result rows fed into the
 *     grouped renderer (pre group-cap). N may equal `total` (task-read renders
 *     the whole eligible pool, capped per group) or the paginated slice
 *     (memory/standard-read respect `limit`).
 *   - `[N]` in each line = the engine score for that row: a hybrid relevance
 *     composite (0.00–1.00) for task/standard engines, or the stored
 *     `importance` (1–5) for memory-read.
 *   - `≤5 shown per group (+N more)` = the per-group visible-line cap (default
 *     5, see {@link GroupedSummaryOptions.cap}) and the overflow marker the
 *     renderer appends when a group exceeds it.
 */

export interface GroupedSummaryOptions<T> {
	/** Items to group and render (already paginated). */
	items: T[];
	/** Extracts the group key for an item. */
	getGroup: (item: T, index: number) => string;
	/** Comparator for group keys (enum order, custom scope order, ...). */
	groupOrder: (a: string, b: string) => number;
	/** Max visible lines per group — a constant or a per-group-key function. */
	cap?: number | ((groupKey: string) => number);
	/** Optional label transform for the group header (defaults to raw key). */
	formatGroupLabel?: (groupKey: string) => string;
	/** Formats one visible item line (receives the global 1-based rank). */
	formatLine: (item: T, rank: number) => string;
	/** Trailing hint appended after the last group. */
	footer: string;
}

export function renderGroupedSummary<T>(options: GroupedSummaryOptions<T>): string {
	const { items, getGroup, groupOrder, cap = 5, formatGroupLabel, formatLine, footer } = options;

	const grouped = new Map<string, { item: T; rank: number }[]>();
	items.forEach((item, i) => {
		const groupKey = getGroup(item, i);
		if (!grouped.has(groupKey)) grouped.set(groupKey, []);
		grouped.get(groupKey)!.push({ item, rank: i + 1 });
	});

	const sortedKeys = [...grouped.keys()].sort(groupOrder);
	const parts: string[] = [];

	for (const key of sortedKeys) {
		const entries = grouped.get(key)!;
		const groupCap = typeof cap === "function" ? cap(key) : cap;
		const visible = entries.slice(0, groupCap);
		const hidden = entries.length - visible.length;
		const label = formatGroupLabel ? formatGroupLabel(key) : key;
		parts.push(`**${label} (${entries.length})**`);
		for (const { item, rank } of visible) {
			parts.push(formatLine(item, rank));
		}
		if (hidden > 0) parts.push(`... +${hidden} more in this group`);
		parts.push("");
	}

	parts.push(footer);
	return parts.join("\n");
}

/**
 * Builds the single shared legend line documenting the text-summary metadata
 * conventions so task-read, memory-read and standard-read render it identically
 * (TASK-424). Place it immediately under the `### Results: … (showing N)`
 * header.
 *
 * @param scoreLabel  What the bracketed `[N]` denotes — "relevance score" for
 *                    the task/standard hybrid engines, "importance" for
 *                    memory-read (stored 1–5 field).
 * @param scoreRange  Valid value range of `[N]` — "0.00–1.00" or "1–5".
 * @param groupBy     Grouping dimension — "status" | "type" | "scope".
 * @param perGroupCap Visible-line cap per group. Pass a number (default 5) or a
 *                    string describing exceptions (e.g. "5 (task_archive 2)").
 */
export function formatOutputLegend(opts: {
	scoreLabel: string;
	scoreRange: string;
	groupBy: string;
	perGroupCap: number | string;
}): string {
	const cap = typeof opts.perGroupCap === "number" ? String(opts.perGroupCap) : opts.perGroupCap;
	return `> [N] = ${opts.scoreLabel} (${opts.scoreRange}) · grouped by ${opts.groupBy}, ≤${cap} shown per group (+N more)`;
}

/**
 * Builds a comparator that orders group keys by their position in `order`,
 * with unknown keys sorted last (alphabetically among themselves). Shared by
 * the memory (type order) and task (status order) renderers.
 */
export function enumOrderComparator(order: string[]): (a: string, b: string) => number {
	return (a, b) => {
		const ai = order.indexOf(a);
		const bi = order.indexOf(b);
		if (ai === -1 && bi === -1) return a.localeCompare(b);
		if (ai === -1) return 1;
		if (bi === -1) return -1;
		return ai - bi;
	};
}
