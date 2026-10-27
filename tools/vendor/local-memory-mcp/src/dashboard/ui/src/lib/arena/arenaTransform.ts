import type { Task, TaskClaim, Handoff } from "../interfaces";
import type { ArenaScene, ArenaLayoutConfig, AgentState } from "./arenaTypes";
import {
	ACTIVE_TASK_STATUSES,
	ROLE_COLORS,
	agentColor,
	nameHash,
	pickVehicle,
	pickHelper,
	priorityToLevel,
	inferTaskType,
	stateToAction,
	stateToHealth,
	healthToRing,
	stateToIcon,
	computeAgentProgress
} from "./arenaTransform-utils";
import { computeZones, placeTasksInZones, therapySlotPosition, aggregateZoneCounts } from "./arenaTransform-layout";
import { getArenaLayoutManager } from "./arena-layout/ArenaLayoutManager";

// Re-export all public symbols from split files for backward compatibility
export {
	STATUS_TO_ZONE,
	ACTIVE_TASK_STATUSES,
	ROLE_COLORS,
	agentColor,
	nameHash,
	pickVehicle,
	pickHelper,
	priorityToLevel,
	inferTaskType,
	stateToAction,
	stateToHealth,
	healthToRing,
	stateToIcon,
	computeAgentProgress
} from "./arenaTransform-utils";
export { computeZones, therapySlotPosition, placeTasksInZones } from "./arenaTransform-layout";

export function buildArenaScene(
	tasks: Task[],
	claims: TaskClaim[],
	handoffs: Handoff[],
	existingScene: ArenaScene | null,
	layout: ArenaLayoutConfig
): ArenaScene {
	// ── Single source of truth for geometry: the shared ArenaLayoutManager ──
	// The renderer consumes the SAME manager (layout.layoutManager, or the
	// module singleton) so baked task positions always match drawn rooms.
	const layoutManager = layout.layoutManager ?? getArenaLayoutManager();
	layoutManager.setDimensions(layout.canvasWidth, layout.canvasHeight);
	layoutManager.setOccupancy(
		aggregateZoneCounts(
			tasks,
			layoutManager.getDefinitions().map((d) => d.id)
		)
	);

	const zones = computeZones(layout.canvasWidth, layout.canvasHeight);
	const taskPositions = placeTasksInZones(tasks, zones);
	const idleZone = zones.find((z) => z.id === "in_progress") || zones[0];

	const scene: ArenaScene = { agents: new Map(), tasks: new Map(), handoffs: [], repositories: new Map() };

	// --- Tasks ---
	const now = Date.now();

	for (const task of tasks) {
		const pos = taskPositions.get(task.id);
		if (!pos) continue;
		const prev = existingScene?.tasks.get(task.id);
		const createdAt = task.created_at ? new Date(task.created_at).getTime() : now;
		const startedAt = task.in_progress_at ? new Date(task.in_progress_at).getTime() : null;
		const waitTime = Math.max(0, (now - createdAt) / 1000);
		const estDuration = task.est_tokens ? task.est_tokens * 2 : 300;

		let progress: number;
		if (task.status === "completed") {
			progress = 1.0;
		} else if (task.status === "in_progress" && startedAt) {
			progress = Math.min(1.0, (now - startedAt) / (estDuration * 1000));
		} else {
			progress = prev?.progress ?? 0;
		}

		scene.tasks.set(task.id, {
			id: task.id,
			taskCode: task.task_code,
			title: task.title,
			repo: task.repo,
			status: task.status,
			priority: task.priority ?? 3,
			priorityLevel: priorityToLevel(task.priority ?? 3),
			claimedByAgentId: task.coordination?.active_claim_agent ?? null,
			ownerId: task.agent ?? "",
			repositoryId: task.repo,
			createdAt,
			startedAt,
			estimatedDuration: estDuration,
			actualDuration: null,
			waitTime,
			progress,
			retryCount: prev?.retryCount ?? 0,
			maxRetries: prev?.maxRetries ?? 3,
			failureReason: null,
			blockedReason: null,
			blockedById: null,
			tokenCost: 0,
			estimatedCost: 0,
			labels: [],
			tags: task.tags ?? [],
			taskType: inferTaskType(task.task_code),
			hasPendingHandoff: (task.coordination?.pending_handoff_count ?? 0) > 0,
			x: pos.x,
			y: pos.y,
			animationState: prev ? "idle" : "entering"
		});
	}

	// --- Agents (from claims + task coordination) ---
	const agentMap = new Map<string, { tasks: Set<string>; role: string; repos: Set<string>; model: string }>();

	for (const claim of claims) {
		if (!agentMap.has(claim.agent))
			agentMap.set(claim.agent, {
				tasks: new Set(),
				role: claim.role,
				repos: new Set(),
				model: (claim.metadata?.model as string) ?? ""
			});
		const e = agentMap.get(claim.agent)!;
		e.tasks.add(claim.task_id);
		e.repos.add(claim.repo);
	}
	for (const task of tasks) {
		const a = task.coordination?.active_claim_agent;
		if (!a) continue;
		if (!agentMap.has(a))
			agentMap.set(a, {
				tasks: new Set(),
				role: task.coordination?.active_claim_role ?? "agent",
				repos: new Set(),
				model: ""
			});
		const e = agentMap.get(a)!;
		e.tasks.add(task.id);
		e.repos.add(task.repo);
	}

	const agentNames = Array.from(agentMap.keys());

	agentNames.forEach((name, idx) => {
		const { tasks: claimedIds, role, repos, model } = agentMap.get(name)!;
		const prev = existingScene?.agents.get(name);

		const roleColor = ROLE_COLORS[role] ?? agentColor(name);

		// Initial spawn in idle zone centre (spread out)
		const spawnX = idleZone.x + idleZone.w / 2 + ((idx % 3) - 1) * 30;
		const spawnY = idleZone.y + idleZone.h / 2 + (Math.floor(idx / 3) - 1) * 30;

		const firstVisibleTask = Array.from(claimedIds).find((id) => scene.tasks.has(id));
		const tgt = firstVisibleTask ? scene.tasks.get(firstVisibleTask)! : null;
		const visibleClaimedTasks = Array.from(claimedIds)
			.map((id) => scene.tasks.get(id))
			.filter((task): task is NonNullable<typeof task> => Boolean(task));
		const hasActiveClaimedTask = visibleClaimedTasks.some((task) => ACTIVE_TASK_STATUSES.has(task.status));

		// Target: 18px above+right of task (so agent is adjacent to desk)
		let targetX = tgt ? tgt.x + 20 : spawnX;
		let targetY = tgt ? tgt.y - 18 : spawnY;

		const claimedArr = Array.from(claimedIds).sort();
		const prevClaimed = prev?.claimedTaskIds.slice().sort() ?? [];
		const tasksChanged = !prev || claimedArr.join(",") !== prevClaimed.join(",");

		const now = Date.now();
		const lastUpdateTs = tasksChanged ? now : (prev?.lastUpdateTs ?? now);
		const isStale = !hasActiveClaimedTask && now - lastUpdateTs > 30000;

		let state: AgentState = claimedIds.size > 0 ? "processing" : "idle";
		if (tgt && tgt.status === "blocked") {
			state = "blocked";
		}

		// Detect burnout and start handoff animation
		let handoffAnim = prev?.handoffAnim ?? null;
		if (isStale) {
			state = "burnout";
			const burnoutZone = zones.find((z) => z.id === "recovery") || idleZone;
			// Place them inside the therapy room, aligned with the rendered beds.
			const therapySlot = therapySlotPosition(burnoutZone, idx);
			targetX = therapySlot.x;
			targetY = therapySlot.y;

			// Start handoff animation if agent just transitioned to burnout
			const wasBurnout = prev?.state === "burnout";
			if (!wasBurnout && !handoffAnim) {
				const nh = nameHash(name);
				const currentX = prev?.x ?? spawnX;
				const currentY = prev?.y ?? spawnY;
				handoffAnim = {
					phase: "pickup",
					vehicle: pickVehicle(nh),
					helperVariant: pickHelper(nh),
					startX: currentX,
					startY: currentY,
					endX: targetX,
					endY: targetY,
					progress: 0,
					phaseStartTs: performance.now(),
					wheelAngle: 0,
					helperWalkPhase: 0,
					helperFacing: "down",
					stepBounce: 0
				};
			}
		} else {
			// Clear handoff animation when agent is no longer burnout
			handoffAnim = null;
		}

		// ── Compute telemetry & health based on state ──────────────────────
		const curAction = stateToAction(state);
		const curHealth = stateToHealth(state);
		const curHealthRing = healthToRing(curHealth);
		const curIcon = stateToIcon(state);
		const avgProgress = computeAgentProgress(visibleClaimedTasks);

		scene.agents.set(name, {
			id: name,
			name,
			role,
			color: roleColor,
			x: prev?.x ?? spawnX,
			y: prev?.y ?? spawnY,
			targetX,
			targetY,
			vx: prev?.vx ?? 0,
			vy: prev?.vy ?? 0,
			walkPhase: prev?.walkPhase ?? 0,
			facing: prev?.facing ?? "down",
			state,
			claimedTaskIds: Array.from(claimedIds),
			repos: Array.from(repos),
			lastUpdateTs,
			model,
			handoffAnim,

			// ── Health & Status (computed from state) ───────────────────────
			health: curHealth,
			currentAction: curAction,
			currentTool: prev?.currentTool ?? "",
			confidence: 1.0,
			progress: avgProgress,

			// ── Telemetry (carried forward; updated by animations) ──────────
			tokenUsage: prev?.tokenUsage ?? 0,
			tokenBurnRate: prev?.tokenBurnRate ?? 0,
			cost: prev?.cost ?? 0,
			latency: prev?.latency ?? 0,
			contextUsage: prev?.contextUsage ?? 0,
			queueLength: prev?.queueLength ?? claimedIds.size,
			memoryOps: prev?.memoryOps ?? 0,
			toolCalls: prev?.toolCalls ?? 0,

			// ── Visual Enhancements (computed from state) ──────────────────
			statusIcon: curIcon,
			speechBubble: null,
			speechBubbleTs: 0,
			activityAnimation: prev?.activityAnimation ?? "",
			healthRing: curHealthRing,
			coloredOutline: roleColor
		});
	});

	// --- Handoffs ---
	for (const h of handoffs) {
		if (h.status !== "pending") continue;
		scene.handoffs.push({
			id: h.id,
			fromAgentId: h.from_agent,
			toAgentId: h.to_agent,
			taskId: h.task_id,
			summary: h.summary
		});
	}

	// --- Repositories ---
	const repoIds = new Set<string>();
	if (existingScene?.repositories) {
		for (const id of existingScene.repositories.keys()) {
			repoIds.add(id);
		}
	}
	for (const task of tasks) {
		if (task.repo) {
			repoIds.add(task.repo);
		}
	}
	for (const claim of claims) {
		if (claim.repo) {
			repoIds.add(claim.repo);
		}
	}

	for (const repoId of repoIds) {
		const prev = existingScene?.repositories?.get(repoId);
		const fullName = repoId;
		const name = repoId.split("/").pop() || repoId;

		let tasksInProgress = 0;
		let tasksPending = 0;
		let tasksBlocked = 0;
		for (const task of scene.tasks.values()) {
			if (task.repo === repoId) {
				if (task.status === "in_progress") {
					tasksInProgress++;
				} else if (task.status === "pending") {
					tasksPending++;
				} else if (task.status === "blocked") {
					tasksBlocked++;
				}
			}
		}

		let activeAgents = 0;
		for (const agent of scene.agents.values()) {
			if (agent.repos.includes(repoId)) {
				activeAgents++;
			}
		}

		let health: "healthy" | "degraded" | "critical" = prev?.health ?? "healthy";
		if (!prev?.health) {
			if (tasksBlocked > 0) {
				health = "degraded";
			}
			for (const agent of scene.agents.values()) {
				if (agent.repos.includes(repoId)) {
					if (agent.state === "blocked" || agent.state === "burnout") {
						health = "degraded";
					}
				}
			}
		}

		scene.repositories.set(repoId, {
			id: repoId,
			name,
			fullName,
			health,
			activeBranches: prev?.activeBranches ?? 1,
			lockedFiles: prev?.lockedFiles ?? [],
			mergeQueueLength: prev?.mergeQueueLength ?? 0,
			activePRs: prev?.activePRs ?? 0,
			runningWorkflows: prev?.runningWorkflows ?? (tasksInProgress > 0 ? 1 : 0),
			activeAgents,
			tasksInProgress,
			tasksPending,
			tasksBlocked,
			utilizationPercent: prev?.utilizationPercent ?? (activeAgents > 0 ? 100 : 0),
			avgTaskDuration: prev?.avgTaskDuration ?? 0,
			recentFailures: prev?.recentFailures ?? 0
		});
	}

	return scene;
}
