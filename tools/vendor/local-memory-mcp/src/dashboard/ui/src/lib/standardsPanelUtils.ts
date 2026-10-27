/** Build pagination page numbers */
export function buildPaginationPages(page: number, totalPages: number): number[] {
	const start = Math.max(1, Math.min(page - 2, totalPages - 4));
	return Array.from({ length: Math.min(5, totalPages) }, (_, i) => start + i);
}

/** Build insight cards for standards panel */
export interface StandardsInsight {
	label: string;
	value: string | number;
}

export function buildStandardsInsights(
	count: number,
	scope: string,
	total: number,
	page: number,
	totalPages: number
): StandardsInsight[] {
	return [
		{ label: "Visible", value: count },
		{
			label: "Scope",
			value: scope === "repo" ? "Repo + global" : scope === "global" ? "Global only" : "All"
		},
		{ label: "Total", value: total },
		{ label: "Page", value: `${page} / ${totalPages}` }
	];
}

/** Format scope label */
export function formatScopeLabel(isGlobal: boolean): string {
	return isGlobal ? "Global" : "Repo";
}
