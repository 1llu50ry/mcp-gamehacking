import type { VisualAgent, VisualTask, VisualRepository, VisualHandoff } from "./arenaTypes";

// ── Domain Events ───────────────────────────────────────────────────────────

export type DomainEvent =
	| AgentConnectedEvent
	| AgentDisconnectedEvent
	| AgentHealthChangedEvent
	| AgentActionChangedEvent
	| TaskCreatedEvent
	| TaskAssignedEvent
	| TaskStartedEvent
	| TaskProgressedEvent
	| TaskBlockedEvent
	| TaskUnblockedEvent
	| TaskRetryScheduledEvent
	| TaskCompletedEvent
	| TaskFailedEvent
	| MemoryCreatedEvent
	| MemoryUpdatedEvent
	| RepositoryLockedEvent
	| RepositoryUnlockedEvent
	| RepositoryHealthChangedEvent
	| MetricsUpdatedEvent;

interface AgentConnectedEvent {
	type: "agent-connected";
	agentId: string;
	name: string;
	role: string;
	model: string;
	timestamp: number;
}

interface AgentDisconnectedEvent {
	type: "agent-disconnected";
	agentId: string;
}

interface AgentHealthChangedEvent {
	type: "agent-health-changed";
	agentId: string;
	health: "healthy" | "degraded" | "critical" | "offline";
	reason: string;
}

interface AgentActionChangedEvent {
	type: "agent-action-changed";
	agentId: string;
	action: string;
	tool?: string;
}

interface TaskCreatedEvent {
	type: "task-created";
	taskId: string;
	title: string;
	repositoryId: string;
	timestamp: number;
}

interface TaskAssignedEvent {
	type: "task-assigned";
	taskId: string;
	agentId: string;
}

interface TaskStartedEvent {
	type: "task-started";
	taskId: string;
	agentId: string;
	timestamp: number;
}

interface TaskProgressedEvent {
	type: "task-progressed";
	taskId: string;
	progress: number;
	tokenUsage: number;
}

interface TaskBlockedEvent {
	type: "task-blocked";
	taskId: string;
	reason: string;
	blockedById: string | null;
	detail: string;
}

interface TaskUnblockedEvent {
	type: "task-unblocked";
	taskId: string;
}

interface TaskRetryScheduledEvent {
	type: "task-retry-scheduled";
	taskId: string;
	attempt: number;
	maxRetries: number;
	backoffSeconds: number;
}

interface TaskCompletedEvent {
	type: "task-completed";
	taskId: string;
	agentId: string;
	duration: number;
	tokenCost: number;
}

interface TaskFailedEvent {
	type: "task-failed";
	taskId: string;
	agentId: string;
	error: string;
	canRetry: boolean;
}

interface MemoryCreatedEvent {
	type: "memory-created";
	agentId: string;
	summary: string;
}

interface MemoryUpdatedEvent {
	type: "memory-updated";
	agentId: string;
	summary: string;
}

interface RepositoryLockedEvent {
	type: "repository-locked";
	repositoryId: string;
	file: string;
}

interface RepositoryUnlockedEvent {
	type: "repository-unlocked";
	repositoryId: string;
}

interface RepositoryHealthChangedEvent {
	type: "repository-health-changed";
	repositoryId: string;
	health: "healthy" | "degraded" | "critical";
	metrics: {
		utilizationPercent?: number;
	};
}

interface MetricsUpdatedEvent {
	type: "metrics-updated";
}

// ── Arena State ─────────────────────────────────────────────────────────────

export interface ZoneAggregate {
	count: number;
	oldestWait: number;
	averageWait: number;
	priorityDistribution: Record<string, number>;
	eta: number | null;
	blockedByDistribution: Record<string, number> | null;
}

export interface ArenaMetrics {
	successRate: number;
	failureRate: number;
	retryRate: number;
	throughput: number;
	avgDuration: number;
	tokenConsumption: number;
	cost: number;
	agentUtilization: number;
	queueDepth: number;
}

export interface FilterState {
	repository: string | null;
	roles: string[];
	priorities: string[];
	statuses: string[];
	search: string;
}

export interface EventLogEntry {
	id: string;
	type: string;
	entityId: string;
	entityType: "agent" | "task" | "repository";
	action: string;
	timestamp: number;
	detail: string;
	event?: DomainEvent;
}

export interface VisualEffect {
	type: string;
	entityId: string;
	entityType: "agent" | "task";
	intensity: number;
	duration: number;
}

export interface ArenaUI {
	selectedEntityId: string | null;
	selectedEntityType: "agent" | "task" | "repository" | null;
	zoom: number;
	panX: number;
	panY: number;
	hoveredEntityId: string | null;
	activeFilter: FilterState;
	timelineVisible: boolean;
	sidePanelVisible: boolean;
	sidePanelView: "agent" | "task" | "repo" | "trace";
	eventLog: EventLogEntry[];
	paused: boolean;
}

export interface ArenaState {
	version: number;
	agents: Map<string, VisualAgent>;
	tasks: Map<string, VisualTask>;
	repositories: Map<string, VisualRepository>;
	handoffs: VisualHandoff[];
	zones: {
		pending: ZoneAggregate;
		inProgress: ZoneAggregate;
		backlog: ZoneAggregate;
		blocked: ZoneAggregate;
		recovery: ZoneAggregate;
	};
	metrics: ArenaMetrics;
	ui: ArenaUI;
}

// ── Arena Patch ─────────────────────────────────────────────────────────────

export interface ArenaPatch {
	entities: {
		agents?: Map<string, Partial<VisualAgent>>;
		tasks?: Map<string, Partial<VisualTask>>;
		repositories?: Map<string, Partial<VisualRepository>>;
	};
	invalidatedZones: string[];
	effects: VisualEffect[];
	metricsChanged: boolean;
}
