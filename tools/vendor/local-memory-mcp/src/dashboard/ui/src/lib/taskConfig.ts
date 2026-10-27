export const priorityColors: Record<number, string> = {
	1: "#94a3b8",
	2: "#3b82f6",
	3: "#f59e0b",
	4: "#f97316",
	5: "#ef4444"
};

export const statusIconMap: Record<string, string> = {
	backlog: "archive",
	pending: "circle-dot",
	in_progress: "zap",
	completed: "circle-check",
	blocked: "circle-x",
	canceled: "circle-pause-alt"
};

export const statusColors: Record<string, string> = {
	backlog: "#64748b",
	pending: "#0ea5e9",
	in_progress: "#a855f7",
	completed: "#10b981",
	blocked: "#ef4444",
	canceled: "#f59e0b"
};

export function cleanDesc(md: string | undefined): string {
	if (!md) return "";
	return md
		.replace(/<[^>]*>/g, "")
		.replace(/!\[.*?\]\(.*?\)/g, "")
		.replace(/\[([^\]]+)\]\(.*?\)/g, "$1")
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/[#*~_-]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}
