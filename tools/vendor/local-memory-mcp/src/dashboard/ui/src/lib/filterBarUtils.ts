import type { FilterState } from "./arena/arenaEvents";

export const AGENT_ROLES = [
	"backend",
	"frontend",
	"debugger",
	"devops",
	"data-engineer",
	"explore",
	"documentation",
	"general"
] as const;

export const PRIORITIES = [
	{ key: "p0", label: "P0 Critical", color: "#ef4444" },
	{ key: "p1", label: "P1 High", color: "#f59e0b" },
	{ key: "p2", label: "P2 Medium", color: "#3b82f6" },
	{ key: "p3", label: "P3 Low", color: "#64748b" }
] as const;

export const STATUSES = [
	{ key: "in_progress", label: "In Progress", color: "#a855f7" },
	{ key: "pending", label: "Pending", color: "#0ea5e9" },
	{ key: "blocked", label: "Blocked", color: "#ef4444" },
	{ key: "backlog", label: "Backlog", color: "#64748b" },
	{ key: "recovery", label: "Recovery", color: "#14b8a6" }
] as const;

export function computeActiveCount(filter: FilterState): number {
	return (
		(filter.repository ? 1 : 0) +
		filter.roles.length +
		filter.priorities.length +
		filter.statuses.length +
		(filter.search ? 1 : 0)
	);
}
