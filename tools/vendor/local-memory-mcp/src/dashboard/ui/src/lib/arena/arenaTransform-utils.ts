import type { AgentState, VisualAgent, HelperVariant, HandoffVehicle } from "./arenaTypes";

// ── Color constants ─────────────────────────────────────────────────
export const AGENT_COLORS = [
	"#06b6d4",
	"#f59e0b",
	"#ec4899",
	"#10b981",
	"#3b82f6",
	"#f97316",
	"#14b8a6",
	"#e11d48",
	"#8b5cf6",
	"#84cc16"
];

export const ROLE_COLORS: Record<string, string> = {
	backend: "#3B82F6",
	frontend: "#10B981",
	debugger: "#F59E0B",
	devops: "#8B5CF6",
	"data-engineer": "#14B8A6",
	explore: "#06B6D4",
	documentation: "#6B7280",
	general: "#F9FAFB"
};

export const ACTIVE_TASK_STATUSES = new Set(["in_progress", "pending"]);

// Maps task status → zone id
export const STATUS_TO_ZONE: Record<string, string> = {
	backlog: "backlog",
	pending: "pending",
	in_progress: "in_progress",
	blocked: "blocked",
	completed: "completed",
	canceled: "canceled"
};

// ── Handoff helpers ─────────────────────────────────────────────────
const HELPER_VARIANTS: HelperVariant[] = ["male_nurse", "female_nurse", "staff1", "staff2"];

export function nameHash(name: string): number {
	let h = 5381;
	for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
	return h;
}

export function pickVehicle(nameHashVal: number): HandoffVehicle {
	return nameHashVal % 2 === 0 ? "wheelchair" : "stretcher";
}

export function pickHelper(nameHashVal: number): HelperVariant {
	return HELPER_VARIANTS[(nameHashVal >>> 4) % HELPER_VARIANTS.length];
}

export function agentColor(name: string, role?: string | null): string {
	if (role && ROLE_COLORS[role]) {
		return ROLE_COLORS[role];
	}
	let h = 5381;
	for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
	return AGENT_COLORS[h % AGENT_COLORS.length];
}

// ── Priority helpers ────────────────────────────────────────────────
export function priorityToLevel(p: number): "p0" | "p1" | "p2" | "p3" {
	if (p <= 1) return "p0";
	if (p === 2) return "p1";
	if (p === 3) return "p2";
	return "p3";
}

export function inferTaskType(code: string): "feature" | "fix" | "refactor" | "chore" | "docs" | "test" {
	const prefix = code.split("-")[0]?.toUpperCase() ?? "";
	const typeMap: Record<string, "feature" | "fix" | "refactor" | "chore" | "docs" | "test"> = {
		FEAT: "feature",
		FIX: "fix",
		REFACTOR: "refactor",
		CHORE: "chore",
		DOCS: "docs",
		TEST: "test"
	};
	return typeMap[prefix] ?? "feature";
}

// ── Agent telemetry helpers ─────────────────────────────────────────
export function stateToAction(state: AgentState): VisualAgent["currentAction"] {
	const map: Record<AgentState, VisualAgent["currentAction"]> = {
		processing: "coding",
		idle: "idle",
		blocked: "waiting",
		burnout: "retrying",
		claiming: "thinking",
		handoff_out: "waiting",
		handoff_in: "waiting",
		recovering: "retrying",
		cooldown: "idle",
		retrying: "retrying",
		self_healing: "retrying"
	};
	return map[state] ?? "idle";
}

export function stateToHealth(state: AgentState): VisualAgent["health"] {
	if (state === "burnout" || state === "blocked") return "degraded";
	return "healthy";
}

export function healthToRing(health: VisualAgent["health"]): number {
	const map: Record<VisualAgent["health"], number> = {
		healthy: 100,
		degraded: 60,
		critical: 25,
		offline: 0
	};
	return map[health];
}

export function stateToIcon(state: AgentState): string {
	const map: Record<AgentState, string> = {
		processing: "⚡",
		idle: "●",
		blocked: "⚠",
		burnout: "🔄",
		claiming: "●",
		handoff_out: "●",
		handoff_in: "●",
		recovering: "🔄",
		cooldown: "●",
		retrying: "🔄",
		self_healing: "🔄"
	};
	return map[state] ?? "";
}

export function computeAgentProgress(tasks: Array<{ progress: number }>): number {
	if (tasks.length === 0) return 0;
	const sum = tasks.reduce((acc, t) => acc + t.progress, 0);
	return sum / tasks.length;
}
