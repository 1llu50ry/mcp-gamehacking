import { writable, type Writable } from "svelte/store";
import type { VisualAgent, VisualTask, VisualRepository, ArenaScene } from "./arenaTypes";
import type { DomainEvent, ArenaState, ArenaPatch, ZoneAggregate, FilterState, EventLogEntry } from "./arenaEvents";
import {
	buildAgentConnectedPatch,
	buildAgentDisconnectedPatch,
	buildAgentHealthChangedPatch,
	buildAgentActionChangedPatch,
	buildAgentMemoryPatch
} from "./arena-state/agents";
import {
	buildTaskCreatedPatch,
	buildTaskAssignedPatch,
	buildTaskStartedPatch,
	buildTaskProgressedPatch,
	buildTaskBlockedPatch,
	buildTaskUnblockedPatch,
	buildTaskRetryScheduledPatch,
	buildTaskCompletedPatch,
	buildTaskFailedPatch,
	buildRepoLockedPatch,
	buildRepoUnlockedPatch,
	buildRepoHealthChangedPatch,
	buildMetricsUpdatedPatch,
	recomputeZones,
	recomputeMetrics
} from "./arena-state/connections";

export class ArenaStateManager {
	private state: ArenaState;
	private subscribers: Set<(patch: ArenaPatch) => void> = new Set();
	private store: Writable<ArenaState>;

	constructor() {
		this.state = this.createInitialState();
		this.store = writable(this.state);
	}

	private createInitialState(): ArenaState {
		return {
			version: 0,
			agents: new Map(),
			tasks: new Map(),
			repositories: new Map(),
			handoffs: [],
			zones: {
				pending: this.emptyZone(),
				inProgress: this.emptyZone(),
				backlog: this.emptyZone(),
				blocked: this.emptyZone(),
				recovery: this.emptyZone()
			},
			metrics: {
				successRate: 0,
				failureRate: 0,
				retryRate: 0,
				throughput: 0,
				avgDuration: 0,
				tokenConsumption: 0,
				cost: 0,
				agentUtilization: 0,
				queueDepth: 0
			},
			ui: {
				selectedEntityId: null,
				selectedEntityType: null,
				zoom: 1.0,
				panX: 0,
				panY: 0,
				hoveredEntityId: null,
				activeFilter: {
					repository: null,
					roles: [],
					priorities: [],
					statuses: [],
					search: ""
				},
				timelineVisible: false,
				sidePanelVisible: false,
				sidePanelView: "agent",
				eventLog: [],
				paused: false
			}
		};
	}

	private emptyZone(): ZoneAggregate {
		return {
			count: 0,
			oldestWait: 0,
			averageWait: 0,
			priorityDistribution: {},
			eta: null,
			blockedByDistribution: null
		};
	}

	// ── Public API ──────────────────────────────────────────────────────────

	subscribe(cb: (patch: ArenaPatch) => void): () => void {
		this.subscribers.add(cb);
		return () => {
			this.subscribers.delete(cb);
		};
	}

	getStore(): Writable<ArenaState> {
		return this.store;
	}

	getSnapshot(): ArenaState {
		return { ...this.state };
	}

	applyEvent(event: DomainEvent): ArenaPatch {
		this.logDomainEvent(event);
		const patch = this.processEvent(event);
		if (patch) this.applyPatch(patch);
		return patch;
	}

	applyPatch(patch: ArenaPatch): void {
		this.state.version++;
		if (patch.entities.agents) {
			for (const [id, changes] of patch.entities.agents) {
				const existing = this.state.agents.get(id);
				if (existing) Object.assign(existing, changes);
				else this.state.agents.set(id, changes as VisualAgent);
			}
		}
		if (patch.entities.tasks) {
			for (const [id, changes] of patch.entities.tasks) {
				const existing = this.state.tasks.get(id);
				if (existing) Object.assign(existing, changes);
				else this.state.tasks.set(id, changes as VisualTask);
			}
		}
		if (patch.entities.repositories) {
			for (const [id, changes] of patch.entities.repositories) {
				const existing = this.state.repositories.get(id);
				if (existing) Object.assign(existing, changes);
				else this.state.repositories.set(id, changes as VisualRepository);
			}
		}
		if (patch.invalidatedZones.length > 0) recomputeZones(this.state, patch.invalidatedZones);
		if (patch.metricsChanged) recomputeMetrics(this.state);
		this.store.set(this.state);
		for (const cb of this.subscribers) cb(patch);
	}

	// ── Event Processing ────────────────────────────────────────────────────

	private processEvent(event: DomainEvent): ArenaPatch {
		const patch: ArenaPatch = { entities: {}, invalidatedZones: [], effects: [], metricsChanged: false };
		let partial: Partial<ArenaPatch> = {};

		switch (event.type) {
			case "agent-connected":
				partial = buildAgentConnectedPatch(event);
				break;
			case "agent-disconnected":
				partial = buildAgentDisconnectedPatch(event);
				break;
			case "agent-health-changed":
				partial = buildAgentHealthChangedPatch(event);
				break;
			case "agent-action-changed":
				partial = buildAgentActionChangedPatch(event);
				break;
			case "task-created":
				partial = buildTaskCreatedPatch(event);
				break;
			case "task-assigned":
				partial = buildTaskAssignedPatch(event);
				break;
			case "task-started":
				partial = buildTaskStartedPatch(event);
				break;
			case "task-progressed":
				partial = buildTaskProgressedPatch(event);
				break;
			case "task-blocked":
				partial = buildTaskBlockedPatch(event);
				break;
			case "task-unblocked":
				partial = buildTaskUnblockedPatch(event);
				break;
			case "task-retry-scheduled":
				partial = buildTaskRetryScheduledPatch(event);
				break;
			case "task-completed":
				partial = buildTaskCompletedPatch(event);
				break;
			case "task-failed":
				partial = buildTaskFailedPatch(event);
				break;
			case "memory-created":
			case "memory-updated":
				partial = buildAgentMemoryPatch(event, this.state);
				break;
			case "repository-locked":
				partial = buildRepoLockedPatch(event);
				break;
			case "repository-unlocked":
				partial = buildRepoUnlockedPatch(event);
				break;
			case "repository-health-changed":
				partial = buildRepoHealthChangedPatch(event);
				break;
			case "metrics-updated":
				partial = buildMetricsUpdatedPatch();
				break;
		}

		if (partial.entities) Object.assign(patch.entities, partial.entities);
		if (partial.invalidatedZones) patch.invalidatedZones.push(...partial.invalidatedZones);
		if (partial.effects) patch.effects.push(...partial.effects);
		if (partial.metricsChanged) patch.metricsChanged = true;
		return patch;
	}

	// ── Initialization ──────────────────────────────────────────────────────

	initFromScene(scene: ArenaScene): void {
		this.state.agents = new Map(scene.agents);
		this.state.tasks = new Map(scene.tasks);
		this.state.handoffs = scene.handoffs;
		this.state.repositories = new Map(scene.repositories);
		recomputeZones(this.state, ["pending", "inProgress", "backlog", "blocked", "recovery"]);
		recomputeMetrics(this.state);
		this.store.set(this.state);
	}

	// ── UI State Helpers ────────────────────────────────────────────────────

	setSelected(entityId: string | null, entityType: "agent" | "task" | "repository" | null): void {
		this.state.ui.selectedEntityId = entityId;
		this.state.ui.selectedEntityType = entityType;
		this.store.set(this.state);
	}

	setZoom(zoom: number): void {
		this.state.ui.zoom = Math.max(0.1, Math.min(3.0, zoom));
		this.store.set(this.state);
	}

	setPan(panX: number, panY: number): void {
		this.state.ui.panX = panX;
		this.state.ui.panY = panY;
		this.store.set(this.state);
	}

	resetView(): void {
		this.state.ui.zoom = 1.0;
		this.state.ui.panX = 0;
		this.state.ui.panY = 0;
		this.store.set(this.state);
	}

	zoomToEntity(_worldX: number, _worldY: number, targetZoom: number = 2.0): void {
		this.state.ui.zoom = Math.max(0.1, Math.min(3.0, targetZoom));
		this.store.set(this.state);
	}

	setHovered(entityId: string | null): void {
		this.state.ui.hoveredEntityId = entityId;
		this.store.set(this.state);
	}

	setFilter(filter: Partial<FilterState>): void {
		Object.assign(this.state.ui.activeFilter, filter);
		this.store.set(this.state);
	}

	toggleTimeline(): void {
		this.state.ui.timelineVisible = !this.state.ui.timelineVisible;
		this.store.set(this.state);
	}

	toggleSidePanel(): void {
		this.state.ui.sidePanelVisible = !this.state.ui.sidePanelVisible;
		this.store.set(this.state);
	}

	setSidePanelView(view: "agent" | "task" | "repo" | "trace"): void {
		this.state.ui.sidePanelView = view;
		this.state.ui.sidePanelVisible = true;
		this.store.set(this.state);
	}

	togglePause(): void {
		this.state.ui.paused = !this.state.ui.paused;
		this.store.set(this.state);
	}

	clearSpeechBubble(agentId: string): void {
		const agent = this.state.agents.get(agentId);
		if (agent) {
			agent.speechBubble = null;
			agent.speechBubbleTs = 0;
			this.store.set(this.state);
		}
	}

	private logDomainEvent(event: DomainEvent): void {
		let detail: string;
		let entityType: "agent" | "task" | "repository" = "task";
		let entityId = "";
		const action = event.type;

		switch (event.type) {
			case "agent-connected":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Agent connected: ${event.name} (${event.role})`;
				break;
			case "agent-disconnected":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Agent disconnected: ${event.agentId}`;
				break;
			case "agent-health-changed":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Agent health changed to ${event.health} (${event.reason})`;
				break;
			case "agent-action-changed":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Agent action: ${event.action}${event.tool ? ` using ${event.tool}` : ""}`;
				break;
			case "task-created":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task created: ${event.title}`;
				break;
			case "task-assigned":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task assigned to agent ${event.agentId}`;
				break;
			case "task-started":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task started by agent ${event.agentId}`;
				break;
			case "task-progressed":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task progress: ${Math.round(event.progress * 100)}%`;
				break;
			case "task-blocked":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task blocked: ${event.reason}`;
				break;
			case "task-unblocked":
				entityType = "task";
				entityId = event.taskId;
				detail = "Task unblocked";
				break;
			case "task-retry-scheduled":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task retry scheduled: attempt ${event.attempt}/${event.maxRetries}`;
				break;
			case "task-completed":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task completed by agent ${event.agentId}`;
				break;
			case "task-failed":
				entityType = "task";
				entityId = event.taskId;
				detail = `Task failed by agent ${event.agentId}: ${event.error}`;
				break;
			case "memory-created":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Memory created by agent: ${event.summary}`;
				break;
			case "memory-updated":
				entityType = "agent";
				entityId = event.agentId;
				detail = `Memory updated by agent: ${event.summary}`;
				break;
			case "repository-locked":
				entityType = "repository";
				entityId = event.repositoryId;
				detail = `Repository locked file: ${event.file}`;
				break;
			case "repository-unlocked":
				entityType = "repository";
				entityId = event.repositoryId;
				detail = "Repository unlocked";
				break;
			case "repository-health-changed":
				entityType = "repository";
				entityId = event.repositoryId;
				detail = `Repository health changed to ${event.health}`;
				break;
			case "metrics-updated":
				entityType = "repository";
				entityId = "metrics";
				detail = "Metrics updated";
				break;
			default:
				detail = `Event: ${(event as { type: string }).type}`;
		}

		const entry: EventLogEntry = {
			id: Math.random().toString(36).substring(2, 9) + "-" + Date.now(),
			type: event.type,
			entityId,
			entityType,
			action,
			timestamp: (event as { timestamp?: number }).timestamp || Date.now(),
			detail,
			event
		};

		this.state.ui.eventLog = [...this.state.ui.eventLog, entry];
		if (this.state.ui.eventLog.length > 200) {
			this.state.ui.eventLog = this.state.ui.eventLog.slice(this.state.ui.eventLog.length - 200);
		}
	}
}

// Singleton instance
export const arenaStateManager = new ArenaStateManager();
