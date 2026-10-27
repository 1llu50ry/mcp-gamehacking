import type { VisualAgent } from "../arenaTypes";
import type { DomainEvent, ArenaPatch, VisualEffect, ArenaState } from "../arenaEvents";

// ── Agent event patch builders ────────────────────────────────────────────

export function buildAgentConnectedPatch(event: DomainEvent & { type: "agent-connected" }): Partial<ArenaPatch> {
	const agent: VisualAgent = {
		id: event.agentId,
		name: event.name,
		role: event.role,
		model: event.model,
		color: "#8b5cf6",
		x: 100,
		y: 100,
		targetX: 100,
		targetY: 100,
		vx: 0,
		vy: 0,
		walkPhase: 0,
		facing: "down",
		state: "idle",
		claimedTaskIds: [],
		repos: [],
		lastUpdateTs: event.timestamp,
		handoffAnim: null,
		health: "healthy",
		currentAction: "idle",
		currentTool: "",
		confidence: 1.0,
		progress: 0,
		tokenUsage: 0,
		tokenBurnRate: 0,
		cost: 0,
		latency: 0,
		contextUsage: 0,
		queueLength: 0,
		memoryOps: 0,
		toolCalls: 0,
		statusIcon: "●",
		speechBubble: null,
		speechBubbleTs: 0,
		activityAnimation: "idle",
		healthRing: 100,
		coloredOutline: "#8b5cf6"
	};
	return {
		entities: { agents: new Map([[event.agentId, agent]]) },
		invalidatedZones: ["inProgress"]
	};
}

export function buildAgentDisconnectedPatch(event: DomainEvent & { type: "agent-disconnected" }): Partial<ArenaPatch> {
	return {
		entities: {
			agents: new Map([[event.agentId, { state: "burnout", health: "offline" } as Partial<VisualAgent>]])
		},
		invalidatedZones: ["inProgress", "recovery"]
	};
}

export function buildAgentHealthChangedPatch(
	event: DomainEvent & { type: "agent-health-changed" }
): Partial<ArenaPatch> {
	const effects: VisualEffect[] = [];
	if (event.health === "critical") {
		effects.push({
			type: "error-flash",
			entityId: event.agentId,
			entityType: "agent",
			intensity: 1,
			duration: 500
		});
	}
	return {
		entities: {
			agents: new Map([
				[
					event.agentId,
					{
						health: event.health,
						healthRing: event.health === "healthy" ? 100 : event.health === "degraded" ? 60 : 25,
						speechBubble: `Health: ${event.reason}`,
						speechBubbleTs: Date.now()
					}
				]
			])
		},
		effects
	};
}

export function buildAgentActionChangedPatch(
	event: DomainEvent & { type: "agent-action-changed" }
): Partial<ArenaPatch> {
	return {
		entities: {
			agents: new Map([
				[
					event.agentId,
					{
						currentAction: event.action as VisualAgent["currentAction"],
						currentTool: event.tool || ""
					}
				]
			])
		}
	};
}

export function buildAgentMemoryPatch(
	event: DomainEvent & { type: "memory-created" | "memory-updated" },
	state: ArenaState
): Partial<ArenaPatch> {
	const memEvent = event as { agentId: string; summary: string };
	if (!memEvent.agentId || !state.agents.has(memEvent.agentId)) return {};

	return {
		entities: {
			agents: new Map([
				[
					memEvent.agentId,
					{
						memoryOps: (state.agents.get(memEvent.agentId)?.memoryOps || 0) + 1,
						speechBubble: `Memory: ${memEvent.summary || "synced"}`,
						speechBubbleTs: Date.now()
					}
				]
			])
		},
		effects: [
			{
				type: "memory-sync",
				entityId: memEvent.agentId,
				entityType: "agent",
				intensity: 0.4,
				duration: 2000
			}
		]
	};
}
