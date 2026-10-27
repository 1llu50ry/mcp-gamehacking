export const TYPES = ["code_fact", "decision", "mistake", "pattern", "task_archive"] as const;

export const TYPE_LABELS: Record<string, string> = {
	code_fact: "Code Fact",
	decision: "Decision",
	mistake: "Mistake",
	pattern: "Pattern",
	task_archive: "Task Archive"
};

export const importanceColor: Record<number, string> = {
	1: "#64748b",
	2: "#3b82f6",
	3: "#f59e0b",
	4: "#f97316",
	5: "#ef4444"
};
export const importanceBg: Record<number, string> = {
	1: "rgba(100,116,139,0.12)",
	2: "rgba(59,130,246,0.12)",
	3: "rgba(245,158,11,0.12)",
	4: "rgba(249,115,22,0.12)",
	5: "rgba(239,68,68,0.12)"
};
