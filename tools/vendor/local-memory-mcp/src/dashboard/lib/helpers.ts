import type { RecentAction } from "./interfaces";

export type { RecentAction } from "./interfaces";

export type CondensedRecentAction = RecentAction & {
	burstCount: number;
};

export function condenseRecentActions(actions: RecentAction[], limit: number): CondensedRecentAction[] {
	const condensed: CondensedRecentAction[] = [];
	for (const action of actions) {
		const prev = condensed[condensed.length - 1];
		const same =
			prev && prev.action === action.action && prev.query === action.query && prev.memory_id === action.memory_id;
		const within =
			prev && Math.abs(new Date(prev.created_at).getTime() - new Date(action.created_at).getTime()) <= 600000;
		if (same && within) {
			prev.burstCount++;
			prev.created_at = action.created_at;
		} else {
			condensed.push({ ...action, burstCount: 1 });
		}
	}
	return condensed.slice(0, limit);
}
