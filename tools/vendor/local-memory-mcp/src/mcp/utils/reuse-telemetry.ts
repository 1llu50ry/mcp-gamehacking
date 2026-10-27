import { createHash } from "node:crypto";
import type { SQLiteStore } from "../storage/sqlite";
import type { AgentContextSource } from "../tools/agent-context-compiler";
import { logger } from "./logger";

const ENABLED = process.env.ENABLE_REUSE_TELEMETRY !== "false";
const RETENTION_DAYS = Math.max(1, Number.parseInt(process.env.REUSE_TELEMETRY_RETENTION_DAYS ?? "30", 10) || 30);
const MAX_ROWS = Math.max(24, Number.parseInt(process.env.REUSE_TELEMETRY_MAX_ROWS ?? "20000", 10) || 20_000);
const FLUSH_EVENTS = 4_096;
const SESSION_CAP = 64;
const SESSION_POINTER_CAP = 64;
const SESSION_CLAIM_CAP = 16;
const PACK_CACHE_CAP = 8;
const PACK_CACHE_TTL_MS = 5 * 60_000;

interface PendingDelta {
	owner: string;
	repo: string;
	bucket: string;
	metric: string;
	source: string;
	count: number;
	value: number;
}

interface SessionState {
	reads: Set<string>;
	retrievedMemories: Set<string>;
	claimedAt: Map<string, number>;
	lastSeenAt: number;
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function hourBucket(now: Date): string {
	const bucket = new Date(now);
	bucket.setUTCMinutes(0, 0, 0);
	return bucket.toISOString();
}

function sessionKey(sessionCorrelation: string | undefined, owner: string, repo: string): string {
	return hash(sessionCorrelation || `${owner}/${repo}/anonymous`);
}

function latencyBucket(ms: number): string {
	if (ms <= 100) return "le_100ms";
	if (ms <= 500) return "le_500ms";
	if (ms <= 1_000) return "le_1s";
	if (ms <= 5_000) return "le_5s";
	if (ms <= 30_000) return "le_30s";
	return "gt_30s";
}

export class ReuseTelemetry {
	private pending = new Map<string, PendingDelta>();
	private sessions = new Map<string, SessionState>();
	private packCache = new Map<string, { expiresAt: number; value: unknown }>();
	private eventCount = 0;
	private lastFlushAt = 0;
	private lastPruneAt = 0;

	constructor(private readonly enabled = ENABLED) {}

	isEnabled(): boolean {
		return this.enabled;
	}

	private state(sessionId: string): SessionState {
		let state = this.sessions.get(sessionId);
		if (!state) {
			if (this.sessions.size >= SESSION_CAP) {
				const oldest = [...this.sessions].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt)[0]?.[0];
				if (oldest) this.sessions.delete(oldest);
			}
			state = {
				reads: new Set(),
				retrievedMemories: new Set(),
				claimedAt: new Map(),
				lastSeenAt: Date.now()
			};
			this.sessions.set(sessionId, state);
		}
		state.lastSeenAt = Date.now();
		return state;
	}

	private add(owner: string, repo: string, metric: string, value = 0, source = "", count = 1): void {
		if (!this.enabled) return;
		const bucket = hourBucket(new Date());
		const key = `${owner}\u001f${repo}\u001f${bucket}\u001f${metric}\u001f${source}`;
		const current = this.pending.get(key) ?? { owner, repo, bucket, metric, source, count: 0, value: 0 };
		current.count += count;
		current.value += value;
		this.pending.set(key, current);
	}

	private markEvent(): void {
		this.eventCount++;
	}

	createContextPackId(owner: string, repo: string, correlation: string): string {
		return hash(`${owner}\u001f${repo}\u001f${correlation}`);
	}

	getCachedPack<T>(packId: string): T | undefined {
		if (!this.enabled) return undefined;
		const cached = this.packCache.get(packId);
		if (!cached) return undefined;
		if (cached.expiresAt <= Date.now()) {
			this.packCache.delete(packId);
			return undefined;
		}
		return cached.value as T;
	}

	cachePack(packId: string, value: unknown): void {
		if (!this.enabled) return;
		if (this.packCache.size >= PACK_CACHE_CAP) this.packCache.delete(this.packCache.keys().next().value!);
		this.packCache.set(packId, { expiresAt: Date.now() + PACK_CACHE_TTL_MS, value });
	}

	recordContextPack(input: {
		owner: string;
		repo: string;
		session?: string;
		packId: string;
		cacheLookup: boolean;
		cacheHit: boolean;
		allocation: Record<AgentContextSource, { included: number; excluded: number; estimated_tokens: number }>;
		observationIds: string[];
		memoryIds?: string[];
		evidencePointers: number;
		staleRejected: number;
	}): void {
		if (!this.enabled) return;
		this.markEvent();
		const state = this.state(sessionKey(input.session, input.owner, input.repo));
		this.add(input.owner, input.repo, "context_packs_requested");
		if (input.cacheLookup) {
			this.add(input.owner, input.repo, input.cacheHit ? "context_cache_hits" : "context_cache_misses");
		}
		for (const [source, values] of Object.entries(input.allocation)) {
			this.add(input.owner, input.repo, "context_items_included", 0, source, values.included);
			this.add(input.owner, input.repo, "context_items_excluded", 0, source, values.excluded);
			this.add(input.owner, input.repo, "context_estimated_tokens", values.estimated_tokens, source);
		}
		for (const id of input.memoryIds ?? []) {
			if (state.retrievedMemories.size >= SESSION_POINTER_CAP) {
				state.retrievedMemories.delete(state.retrievedMemories.values().next().value!);
			}
			state.retrievedMemories.add(hash(id));
		}
		this.add(input.owner, input.repo, "observation_ids_reused", 0, "", input.observationIds.length);
		this.add(input.owner, input.repo, "evidence_pointers_reused", 0, "", input.evidencePointers);
		this.add(input.owner, input.repo, "stale_observations_rejected", 0, "", input.staleRejected);
		this.add(input.owner, input.repo, "observation_tokens_avoided", input.evidencePointers * 96);
	}

	recordTool(input: {
		owner: string;
		repo: string;
		session?: string;
		toolName: string;
		args: Record<string, unknown>;
		result: unknown;
	}): void {
		if (!this.enabled) return;
		const relevant = ["codebase-read", "memory-read", "memory-write", "claim-manage", "task-write"].includes(
			input.toolName
		);
		if (!relevant) return;
		this.markEvent();
		const state = this.state(sessionKey(input.session, input.owner, input.repo));
		if (input.toolName === "codebase-read") {
			const kind = input.args.filePath ? "file" : input.args.name ? "symbol" : null;
			if (kind) {
				const pointer = hash(`${kind}:${String(input.args.filePath ?? input.args.name)}:${input.repo}`);
				const repeated = state.reads.has(pointer);
				if (!repeated && state.reads.size >= SESSION_POINTER_CAP)
					state.reads.delete(state.reads.values().next().value!);
				state.reads.add(pointer);
				this.add(input.owner, input.repo, `${kind}_reads`);
				if (repeated) this.add(input.owner, input.repo, `repeated_${kind}_reads`);
			}
		}
		if (input.toolName === "memory-read") {
			const structured = (input.result as { structuredContent?: Record<string, unknown> } | undefined)
				?.structuredContent;
			const ids = [
				(structured?.memory as { id?: string } | undefined)?.id,
				...(Array.isArray(structured?.memories)
					? (structured.memories as Array<{ id?: string }>).map((memory) => memory.id)
					: []),
				...(Array.isArray(structured?.results)
					? (structured.results as Array<{ id?: string }>).map((memory) => memory.id)
					: [])
			].filter((id): id is string => Boolean(id));
			for (const id of ids) {
				if (state.retrievedMemories.size >= SESSION_POINTER_CAP) {
					state.retrievedMemories.delete(state.retrievedMemories.values().next().value!);
				}
				state.retrievedMemories.add(hash(id));
			}
		}
		if (
			input.toolName === "claim-manage" &&
			(input.args.task_id || input.args.task_code) &&
			input.args.agent &&
			!input.args.release
		) {
			const task = String(input.args.task_id ?? input.args.task_code);
			if (state.claimedAt.size >= SESSION_CLAIM_CAP) state.claimedAt.delete(state.claimedAt.keys().next().value!);
			state.claimedAt.set(hash(task), Date.now());
		}
		if (input.toolName === "task-write") {
			const task = input.args.id ?? input.args.code ?? input.args.task_code;
			if (task) {
				const claimedAt = state.claimedAt.get(hash(String(task)));
				if (claimedAt) {
					const elapsedMs = Date.now() - claimedAt;
					this.add(input.owner, input.repo, "claim_to_first_action_ms", elapsedMs, latencyBucket(elapsedMs));
					state.claimedAt.delete(hash(String(task)));
				}
			}
		}
		if (input.toolName === "memory-write" && input.args.acknowledge === "used") {
			const structured = (input.result as { structuredContent?: Record<string, unknown> } | undefined)
				?.structuredContent;
			const id = String(structured?.id ?? input.args.id ?? "");
			if (id && state.retrievedMemories.delete(hash(id))) {
				this.add(input.owner, input.repo, "retrievals_acknowledged_used");
			}
		}
	}

	flush(store: SQLiteStore): void {
		if (!this.enabled || this.pending.size === 0) return;
		const deltas = [...this.pending.values()];
		try {
			store.reuseTelemetry.flush(deltas);
			const now = Date.now();
			if (now - this.lastPruneAt >= 3_600_000) {
				store.reuseTelemetry.prune(RETENTION_DAYS, MAX_ROWS);
				this.lastPruneAt = now;
			}
			this.pending.clear();
			this.eventCount = 0;
			this.lastFlushAt = Date.now();
		} catch (error) {
			logger.warn("[ReuseTelemetry] Aggregate flush failed; counters retained", { error: String(error) });
		}
	}

	flushIfNeeded(store: SQLiteStore): void {
		if (!this.enabled) return;
		if (this.eventCount >= FLUSH_EVENTS || (this.pending.size > 0 && Date.now() - this.lastFlushAt >= 60_000)) {
			this.flush(store);
		}
	}

	reset(): void {
		this.pending.clear();
		this.sessions.clear();
		this.packCache.clear();
		this.eventCount = 0;
		this.lastFlushAt = 0;
		this.lastPruneAt = 0;
	}
}

export const reuseTelemetry = new ReuseTelemetry();
