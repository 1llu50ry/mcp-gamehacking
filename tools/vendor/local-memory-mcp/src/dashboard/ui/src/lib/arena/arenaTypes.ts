import type { ArenaLayoutManager } from "./arena-layout/ArenaLayoutManager";
import type { SectionBounds } from "./arena-layout/types";

/** Visual tokens per section (color/accent/decor/floor) owned by the layout manager. */
export type SectionVisual = SectionBounds["visual"];

export type AgentState =
	| "idle"
	| "claiming"
	| "processing"
	| "handoff_out"
	| "handoff_in"
	| "burnout"
	| "blocked"
	| "recovering"
	| "cooldown"
	| "retrying"
	| "self_healing";
export type AgentFacing = "down" | "up" | "left" | "right";

// ── Handoff Animation Types ────────────────────────────────────────────────
export type HandoffAnimPhase = "pickup" | "moving" | "arrive" | "resting";
export type HandoffVehicle = "wheelchair" | "stretcher";
export type HelperVariant = "male_nurse" | "female_nurse" | "staff1" | "staff2";

export interface HandoffAnimData {
	phase: HandoffAnimPhase;
	vehicle: HandoffVehicle;
	helperVariant: HelperVariant;
	/** Start position when handoff began */
	startX: number;
	startY: number;
	/** Target position in therapy room */
	endX: number;
	endY: number;
	/** 0..1 progress along the path */
	progress: number;
	/** Timestamp when current phase started */
	phaseStartTs: number;
	/** Wheel rotation angle (radians) */
	wheelAngle: number;
	/** Helper walk phase for leg animation */
	helperWalkPhase: number;
	/** Helper facing direction */
	helperFacing: AgentFacing;
	/** Step bounce offset (sine-based for natural walk) */
	stepBounce: number;
}

export interface VisualAgent {
	id: string;
	name: string;
	role: string;
	color: string;
	x: number;
	y: number;
	targetX: number;
	targetY: number;
	vx: number;
	vy: number;
	walkPhase: number; // 0–2π continuous, drives leg/bob animation
	facing: AgentFacing;
	state: AgentState;
	claimedTaskIds: string[];
	repos: string[];
	lastUpdateTs: number;
	/** LLM model name (e.g. claude-sonnet-4-20250514) */
	model: string;
	/** Active handoff animation data, null when no handoff in progress */
	handoffAnim: HandoffAnimData | null;

	// ── Health & Status ───────────────────────────────────────────────────────
	health: "healthy" | "degraded" | "critical" | "offline";
	currentAction:
		| "thinking"
		| "coding"
		| "testing"
		| "reviewing"
		| "searching"
		| "memory-syncing"
		| "waiting"
		| "retrying"
		| "idle";
	currentTool: string;
	confidence: number; // 0.0 - 1.0
	progress: number; // 0.0 - 1.0 on current task

	// ── Telemetry ─────────────────────────────────────────────────────────────
	tokenUsage: number;
	tokenBurnRate: number; // tokens/second
	cost: number;
	latency: number; // ms
	contextUsage: number; // 0.0 - 1.0 (percentage of context window)
	queueLength: number;
	memoryOps: number;
	toolCalls: number;

	// ── Visual Enhancements ───────────────────────────────────────────────────
	statusIcon: string;
	speechBubble: string | null;
	speechBubbleTs: number; // Date.now() when speechBubble was last set (for auto-clear after 3s)
	activityAnimation: string;
	healthRing: number; // 0-100 for progress ring
	coloredOutline: string; // hex color for outline based on role/health
}

export interface VisualTask {
	// ── Identity ────────────────────────────────────────────────────────────────
	id: string;
	taskCode: string;
	title: string;
	repo: string;

	// ── Priority & Status ───────────────────────────────────────────────────────
	status: string;
	priority: number;
	priorityLevel: "p0" | "p1" | "p2" | "p3";

	// ── Ownership ───────────────────────────────────────────────────────────────
	claimedByAgentId: string | null;
	ownerId: string;
	repositoryId: string;

	// ── Timing ──────────────────────────────────────────────────────────────────
	createdAt: number;
	startedAt: number | null;
	estimatedDuration: number;
	actualDuration: number | null;
	waitTime: number;

	// ── Progress & Quality ──────────────────────────────────────────────────────
	progress: number; // 0.0 - 1.0
	retryCount: number;
	maxRetries: number;
	failureReason: string | null;
	blockedReason: "dependency" | "rate-limit" | "human" | "conflict" | "token" | "memory" | "tool" | null;
	blockedById: string | null;

	// ── Cost ────────────────────────────────────────────────────────────────────
	tokenCost: number;
	estimatedCost: number;

	// ── Metadata ────────────────────────────────────────────────────────────────
	labels: string[];
	tags: string[];
	taskType: "feature" | "fix" | "refactor" | "chore" | "docs" | "test";
	hasPendingHandoff: boolean;

	// ── Position ────────────────────────────────────────────────────────────────
	x: number;
	y: number;

	// ── Visual ──────────────────────────────────────────────────────────────────
	animationState: "idle" | "entering" | "exiting" | "pulse" | "shake" | "celebration";
}

export interface VisualHandoff {
	id: string;
	fromAgentId: string;
	toAgentId: string | null;
	taskId: string | null;
	summary: string;
}

export interface VisualRepository {
	id: string;
	name: string;
	fullName: string;
	health: "healthy" | "degraded" | "critical";
	activeBranches: number;
	lockedFiles: string[];
	mergeQueueLength: number;
	activePRs: number;
	runningWorkflows: number;
	activeAgents: number;
	tasksInProgress: number;
	tasksPending: number;
	tasksBlocked: number;
	utilizationPercent: number;
	avgTaskDuration: number;
	recentFailures: number;
}

export interface ArenaScene {
	agents: Map<string, VisualAgent>;
	tasks: Map<string, VisualTask>;
	handoffs: VisualHandoff[];
	repositories: Map<string, VisualRepository>;
}

export interface ArenaLayoutConfig {
	canvasWidth: number;
	canvasHeight: number;
	/**
	 * Shared ArenaLayoutManager instance (module singleton). The scene
	 * transform (buildArenaScene) and the renderer both consume this one
	 * manager so baked task positions and drawn room geometry always match.
	 * Optional — callers fall back to getArenaLayoutManager().
	 */
	layoutManager?: ArenaLayoutManager;
}

export interface ZoneRect {
	id: string;
	label: string;
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
}
