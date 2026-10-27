import type { Memory } from "./memory";

export interface DashboardRepoPulse {
	repo: string;
	memoryCount: number;
	taskCount: number;
	inProgressCount: number;
	pendingCount: number;
	blockedCount: number;
	backlogCount: number;
	lastActivity: string | null;
	activeClaims: number;
	pendingHandoffs: number;
	unassignedHandoffs: number;
	staleClaims: number;
}

export interface DashboardStats {
	scope?: "repo" | "global";
	total: number;
	avgImportance: string;
	totalHitCount: number;
	expiringSoon: number;
	byType: Record<string, number>;
	taskStats?: {
		total: number;
		backlog: number;
		pending: number;
		in_progress: number;
		completed: number;
		blocked: number;
		canceled?: number;
	};
	repoCount?: number;
	activeRepoCount?: number;
	coordination?: {
		activeClaims: number;
		agentsClaiming: number;
		pendingHandoffs: number;
		unassignedHandoffs: number;
		staleClaims: number;
		staleHandoffs: number;
	};
	repos?: DashboardRepoPulse[];
	todayCompleted?: number;
	todayAdded?: number;
	todayProcessed?: number;
	todayTokens?: number;
	todayAvgDuration?: number;
	timeSeries?: Record<string, Array<{ date: string; count: number }>>;
	scatterData?: Array<{ x: number; y: number }>;
	topMemories?: Memory[];
}

export interface TaskTimePeriodStats {
	completed: number;
	added: number;
	tokens: number;
	avgDuration: number;
	history: Array<{ label: string; created: number; completed: number }>;
}

export interface TaskTimeStats {
	daily: TaskTimePeriodStats;
	weekly: TaskTimePeriodStats;
	monthly: TaskTimePeriodStats;
	overall: TaskTimePeriodStats;
}
