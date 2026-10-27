import { derived, writable } from "svelte/store";
import { taskTimeStats } from "../stores";
import type { TaskTimePeriodStats } from "../stores";

type TimeStatsHistoryItem = TaskTimePeriodStats["history"][number];

export function createTimeStatsHandler() {
	const periods = [
		{ id: "daily", label: "Today" },
		{ id: "weekly", label: "This Week" },
		{ id: "monthly", label: "This Month" },
		{ id: "overall", label: "Overall" }
	] as const;

	type PeriodId = (typeof periods)[number]["id"];
	const activePeriod = writable<PeriodId>("daily");

	const stats = derived(taskTimeStats, ($s) => $s);

	const periodData = derived([stats, activePeriod], ([$stats, $active]) => {
		if (!$stats) return null;
		return $stats[$active] || null;
	});

	const history = derived(periodData, ($data) => $data?.history || []);

	const maxVal = derived(history, ($history) =>
		Math.max(5, ...($history as TimeStatsHistoryItem[]).map((h) => Math.max(h.created || 0, h.completed || 0)))
	);

	function formatDuration(minutes: number) {
		if (!minutes) return "0m";
		if (minutes < 60) return `${Math.round(minutes)}m`;
		const h = Math.floor(minutes / 60);
		const m = Math.round(minutes % 60);
		return `${h}h ${m}m`;
	}

	function formatTokens(tokens: number) {
		if (!tokens) return "0";
		if (tokens < 1000) return tokens.toString();
		return `${(tokens / 1000).toFixed(1)}k`;
	}

	return {
		periods,
		activePeriod,
		periodData,
		history,
		maxVal,
		setActivePeriod: (p: PeriodId) => activePeriod.set(p),
		formatDuration,
		formatTokens
	};
}
