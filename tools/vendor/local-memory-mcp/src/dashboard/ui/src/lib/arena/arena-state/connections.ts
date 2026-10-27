import type { VisualAgent, VisualTask, VisualRepository } from "../arenaTypes";
import type { DomainEvent, ArenaPatch, ZoneAggregate, ArenaState } from "../arenaEvents";

// ── Task event patch builders ─────────────────────────────────────────────

export function buildTaskCreatedPatch(event: DomainEvent & { type: "task-created" }): Partial<ArenaPatch> {
	const task: VisualTask = {
		id: event.taskId,
		taskCode: event.taskId,
		title: event.title,
		repo: event.repositoryId,
		status: "pending",
		priority: 2,
		x: 0,
		y: 0,
		claimedByAgentId: null,
		hasPendingHandoff: false,
		priorityLevel: "p2",
		ownerId: "",
		repositoryId: event.repositoryId,
		createdAt: event.timestamp,
		startedAt: null,
		estimatedDuration: 0,
		actualDuration: null,
		waitTime: 0,
		progress: 0,
		retryCount: 0,
		maxRetries: 3,
		failureReason: null,
		blockedReason: null,
		blockedById: null,
		tokenCost: 0,
		estimatedCost: 0,
		labels: [],
		tags: [],
		taskType: "feature",
		animationState: "entering"
	};
	return {
		entities: { tasks: new Map([[event.taskId, task]]) },
		invalidatedZones: ["pending"],
		metricsChanged: true
	};
}

export function buildTaskAssignedPatch(event: DomainEvent & { type: "task-assigned" }): Partial<ArenaPatch> {
	return {
		entities: {
			tasks: new Map([
				[
					event.taskId,
					{
						claimedByAgentId: event.agentId,
						ownerId: event.agentId,
						status: "pending",
						animationState: "pulse"
					} as Partial<VisualTask>
				]
			])
		},
		invalidatedZones: ["pending", "inProgress"]
	};
}

export function buildTaskStartedPatch(event: DomainEvent & { type: "task-started" }): Partial<ArenaPatch> {
	return {
		entities: {
			tasks: new Map([
				[
					event.taskId,
					{
						status: "in_progress",
						startedAt: event.timestamp,
						progress: 0,
						animationState: "pulse"
					} as Partial<VisualTask>
				]
			]),
			agents: new Map([
				[
					event.agentId,
					{
						state: "processing",
						currentAction: "coding"
					} as Partial<VisualAgent>
				]
			])
		},
		invalidatedZones: ["pending", "inProgress"]
	};
}

export function buildTaskProgressedPatch(event: DomainEvent & { type: "task-progressed" }): Partial<ArenaPatch> {
	return {
		entities: {
			tasks: new Map([
				[
					event.taskId,
					{
						progress: event.progress,
						tokenCost: event.tokenUsage
					}
				]
			])
		}
	};
}

export function buildTaskBlockedPatch(event: DomainEvent & { type: "task-blocked" }): Partial<ArenaPatch> {
	return {
		entities: {
			tasks: new Map([
				[
					event.taskId,
					{
						status: "blocked",
						blockedReason: event.reason as VisualTask["blockedReason"],
						blockedById: event.blockedById,
						failureReason: event.detail,
						animationState: "shake"
					} as Partial<VisualTask>
				]
			])
		},
		invalidatedZones: ["inProgress", "blocked"],
		effects: [
			{
				type: "blocked-pulse",
				entityId: event.taskId,
				entityType: "task",
				intensity: 0.5,
				duration: 800
			}
		]
	};
}

export function buildTaskUnblockedPatch(event: DomainEvent & { type: "task-unblocked" }): Partial<ArenaPatch> {
	return {
		entities: {
			tasks: new Map([
				[
					event.taskId,
					{
						status: "pending",
						blockedReason: null,
						blockedById: null,
						failureReason: null,
						animationState: "entering"
					} as Partial<VisualTask>
				]
			])
		},
		invalidatedZones: ["blocked", "pending"]
	};
}

export function buildTaskRetryScheduledPatch(
	event: DomainEvent & { type: "task-retry-scheduled" }
): Partial<ArenaPatch> {
	return {
		entities: {
			tasks: new Map([
				[
					event.taskId,
					{
						retryCount: event.attempt,
						maxRetries: event.maxRetries,
						status: "pending",
						animationState: "pulse"
					} as Partial<VisualTask>
				]
			])
		},
		invalidatedZones: ["recovery", "pending"],
		effects: [
			{
				type: "cooldown",
				entityId: event.taskId,
				entityType: "task",
				intensity: 0.3,
				duration: event.backoffSeconds * 1000
			}
		]
	};
}

export function buildTaskCompletedPatch(event: DomainEvent & { type: "task-completed" }): Partial<ArenaPatch> {
	return {
		entities: {
			tasks: new Map([
				[
					event.taskId,
					{
						status: "completed",
						actualDuration: event.duration,
						tokenCost: event.tokenCost,
						progress: 1,
						animationState: "celebration"
					} as Partial<VisualTask>
				]
			]),
			agents: new Map([
				[
					event.agentId,
					{
						state: "idle",
						currentAction: "idle",
						progress: 0
					} as Partial<VisualAgent>
				]
			])
		},
		invalidatedZones: ["inProgress"],
		metricsChanged: true,
		effects: [
			{
				type: "celebration",
				entityId: event.taskId,
				entityType: "task",
				intensity: 1,
				duration: 1500
			}
		]
	};
}

export function buildTaskFailedPatch(event: DomainEvent & { type: "task-failed" }): Partial<ArenaPatch> {
	return {
		entities: {
			tasks: new Map([
				[
					event.taskId,
					{
						status: "blocked",
						failureReason: event.error,
						retryCount: event.canRetry ? 1 : 0,
						animationState: "shake"
					} as Partial<VisualTask>
				]
			]),
			agents: new Map([
				[
					event.agentId,
					{
						state: "burnout",
						currentAction: "retrying"
					} as Partial<VisualAgent>
				]
			])
		},
		invalidatedZones: ["inProgress", "blocked", "recovery"],
		metricsChanged: true,
		effects: [
			{
				type: "error-flash",
				entityId: event.taskId,
				entityType: "task",
				intensity: 1,
				duration: 600
			}
		]
	};
}

// ── Repository event patch builders ────────────────────────────────────────

export function buildRepoLockedPatch(event: DomainEvent & { type: "repository-locked" }): Partial<ArenaPatch> {
	return {
		entities: {
			repositories: new Map([[event.repositoryId, { lockedFiles: [event.file] } as Partial<VisualRepository>]])
		}
	};
}

export function buildRepoUnlockedPatch(event: DomainEvent & { type: "repository-unlocked" }): Partial<ArenaPatch> {
	return {
		entities: {
			repositories: new Map([[event.repositoryId, { lockedFiles: [] } as Partial<VisualRepository>]])
		}
	};
}

export function buildRepoHealthChangedPatch(
	event: DomainEvent & { type: "repository-health-changed" }
): Partial<ArenaPatch> {
	return {
		entities: {
			repositories: new Map([
				[
					event.repositoryId,
					{
						health: event.health,
						utilizationPercent: event.metrics.utilizationPercent || 0
					} as Partial<VisualRepository>
				]
			])
		}
	};
}

export function buildMetricsUpdatedPatch(): Partial<ArenaPatch> {
	return { metricsChanged: true };
}

// ── Zone Recomputations ────────────────────────────────────────────────────

function emptyZone(): ZoneAggregate {
	return {
		count: 0,
		oldestWait: 0,
		averageWait: 0,
		priorityDistribution: {},
		eta: null,
		blockedByDistribution: null
	};
}

export function recomputeZones(state: ArenaState, zoneNames: string[]): void {
	const tasks = Array.from(state.tasks.values());
	const agents = Array.from(state.agents.values());
	const now = Date.now();

	for (const zoneName of zoneNames) {
		let zoneTasks: VisualTask[];
		switch (zoneName) {
			case "pending":
				zoneTasks = tasks.filter((t) => t.status === "pending" && !t.claimedByAgentId);
				break;
			case "inProgress":
				zoneTasks = tasks.filter((t) => t.status === "in_progress" || (t.status === "pending" && t.claimedByAgentId));
				break;
			case "backlog":
				zoneTasks = tasks.filter((t) => t.status === "backlog");
				break;
			case "blocked":
				zoneTasks = tasks.filter((t) => t.status === "blocked");
				break;
			case "recovery":
				zoneTasks = tasks.filter((t) => t.retryCount > 0 || t.failureReason !== null);
				break;
			default:
				zoneTasks = [];
		}

		const aggregate = emptyZone();
		aggregate.count = zoneTasks.length;

		if (zoneTasks.length > 0) {
			const waits = zoneTasks.map((t) => (t.createdAt ? (now - t.createdAt) / 1000 : 0));
			aggregate.oldestWait = Math.max(...waits);
			aggregate.averageWait = waits.reduce((a, b) => a + b, 0) / waits.length;

			const dist: Record<string, number> = {};
			for (const t of zoneTasks) {
				const p = `p${t.priority}`;
				dist[p] = (dist[p] || 0) + 1;
			}
			aggregate.priorityDistribution = dist;

			const activeAgents = agents.filter((a) => a.state === "processing").length;
			if (activeAgents > 0 && zoneTasks.length > 0) {
				const avgDuration = 30;
				aggregate.eta = (zoneTasks.length * avgDuration) / activeAgents;
			}

			if (zoneName === "blocked") {
				const blockedDist: Record<string, number> = {};
				for (const t of zoneTasks) {
					const reason = t.blockedReason || "unknown";
					blockedDist[reason] = (blockedDist[reason] || 0) + 1;
				}
				aggregate.blockedByDistribution = blockedDist;
			}
		}

		(state.zones as Record<string, ZoneAggregate>)[zoneName] = aggregate;
	}
}

// ── Metrics Recomputations ─────────────────────────────────────────────────

export function recomputeMetrics(state: ArenaState): void {
	const tasks = Array.from(state.tasks.values());
	const agents = Array.from(state.agents.values());
	const completed = tasks.filter((t) => t.status === "completed").length;
	const failed = tasks.filter((t) => t.status === "blocked" && t.failureReason !== null).length;
	const total = completed + failed + tasks.filter((t) => t.status === "in_progress").length;

	state.metrics = {
		successRate: total > 0 ? (completed / total) * 100 : 100,
		failureRate: total > 0 ? (failed / total) * 100 : 0,
		retryRate: (tasks.filter((t) => t.retryCount > 0).length / Math.max(1, total)) * 100,
		throughput: completed / Math.max(1, (Date.now() - (tasks[0]?.createdAt || Date.now())) / 60000),
		avgDuration:
			completed > 0
				? tasks.filter((t) => t.actualDuration !== null).reduce((s, t) => s + (t.actualDuration || 0), 0) / completed
				: 0,
		tokenConsumption: tasks.reduce((s, t) => s + (t.tokenCost || 0), 0),
		cost: tasks.reduce((s, t) => s + (t.estimatedCost || 0), 0),
		agentUtilization:
			agents.length > 0 ? (agents.filter((a) => a.state === "processing").length / agents.length) * 100 : 0,
		queueDepth: tasks.filter((t) => t.status === "pending").length
	};
}
