import { afterEach, describe, expect, it } from "vitest";
import { createTestStore } from "../storage/sqlite";
import { ReuseTelemetry } from "../utils/reuse-telemetry";

const OWNER = "test-owner";
const REPO = "telemetry-repo";

function allocation() {
	return {
		tasks: { included: 1, excluded: 0, estimated_tokens: 40 },
		decisions: { included: 0, excluded: 0, estimated_tokens: 0 },
		handoffs: { included: 0, excluded: 0, estimated_tokens: 0 },
		standards: { included: 0, excluded: 0, estimated_tokens: 0 },
		observations: { included: 2, excluded: 1, estimated_tokens: 120 },
		code: { included: 1, excluded: 0, estimated_tokens: 30 },
		memories: { included: 0, excluded: 0, estimated_tokens: 0 }
	};
}

describe("reuse telemetry", () => {
	const stores: Awaited<ReturnType<typeof createTestStore>>[] = [];
	afterEach(() => stores.splice(0).forEach((store) => store.close()));

	it("migrates an aggregate-only schema and reapplies idempotently", async () => {
		const store = await createTestStore();
		stores.push(store);
		const columns = store.db.prepare("PRAGMA table_info(reuse_telemetry_hourly)").all() as Array<{ name: string }>;
		expect(columns.map((column) => column.name)).toEqual([
			"owner",
			"repo",
			"bucket",
			"metric",
			"source",
			"count",
			"value"
		]);
		expect(
			store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_reuse_telemetry_scope_bucket'").get()
		).toBeTruthy();
	});

	it("reconciles source allocation and stores no prompt or content columns", async () => {
		const store = await createTestStore();
		stores.push(store);
		const telemetry = new ReuseTelemetry(true);
		telemetry.recordContextPack({
			owner: OWNER,
			repo: REPO,
			session: "session-a",
			packId: "pack-a",
			cacheLookup: true,
			cacheHit: false,
			allocation: allocation(),
			observationIds: ["obs-1", "obs-2"],
			evidencePointers: 3,
			staleRejected: 1
		});
		telemetry.flush(store);
		const summary = store.reuseTelemetry.summarize(OWNER, REPO, 24);
		expect(summary.metrics.context_items_included.count).toBe(4);
		expect(summary.metrics.context_items_excluded.count).toBe(1);
		expect(summary.metrics.context_estimated_tokens.value).toBe(190);
		expect(summary.metrics.context_cache_misses.count).toBe(1);
		expect(summary.metrics.observation_ids_reused.count).toBe(2);
		expect(summary.metrics.evidence_pointers_reused.count).toBe(3);
		expect(summary.metrics.observation_tokens_avoided.value).toBe(288);
		const sql = store.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'reuse_telemetry_hourly'").get() as {
			sql: string;
		};
		expect(sql.sql).not.toMatch(/prompt|content|secret/i);
	});

	it("serves only explicitly keyed packs from the bounded cache", () => {
		const telemetry = new ReuseTelemetry(true);
		const packId = telemetry.createContextPackId(OWNER, REPO, "shared-key");
		expect(telemetry.getCachedPack(packId)).toBeUndefined();
		telemetry.cachePack(packId, { context_pack_id: packId });
		expect(telemetry.getCachedPack(packId)).toEqual({ context_pack_id: packId });
		expect(packId).not.toContain("shared-key");
	});

	it("counts repeated file/symbol reads within a hashed session window", async () => {
		const store = await createTestStore();
		stores.push(store);
		const telemetry = new ReuseTelemetry(true);
		const base = { owner: OWNER, repo: REPO, session: "private-session", result: {} };
		for (let index = 0; index < 2; index++) {
			telemetry.recordTool({ ...base, toolName: "codebase-read", args: { filePath: "src/example.ts" } });
			telemetry.recordTool({ ...base, toolName: "codebase-read", args: { name: "exampleSymbol" } });
		}
		telemetry.flush(store);
		const metrics = store.reuseTelemetry.summarize(OWNER, REPO).metrics;
		expect(metrics.file_reads.count).toBe(2);
		expect(metrics.repeated_file_reads.count).toBe(1);
		expect(metrics.symbol_reads.count).toBe(2);
		expect(metrics.repeated_symbol_reads.count).toBe(1);
	});

	it("counts acknowledge/use only after the same session retrieved the memory", async () => {
		const store = await createTestStore();
		stores.push(store);
		const telemetry = new ReuseTelemetry(true);
		const base = { owner: OWNER, repo: REPO, session: "session-a" };
		telemetry.recordTool({
			...base,
			toolName: "memory-read",
			args: { id: "memory-a" },
			result: { structuredContent: { memory: { id: "memory-a" } } }
		});
		telemetry.recordTool({
			...base,
			toolName: "memory-write",
			args: { id: "memory-a", acknowledge: "used" },
			result: { structuredContent: { id: "memory-a" } }
		});
		telemetry.recordTool({
			...base,
			toolName: "memory-write",
			args: { id: "never-read", acknowledge: "used" },
			result: { structuredContent: { id: "never-read" } }
		});
		telemetry.flush(store);
		expect(store.reuseTelemetry.summarize(OWNER, REPO).metrics.retrievals_acknowledged_used.count).toBe(1);
	});

	it("has a no-op disabled path with no buffered or persisted rows", async () => {
		const store = await createTestStore();
		stores.push(store);
		const telemetry = new ReuseTelemetry(false);
		telemetry.recordTool({ owner: OWNER, repo: REPO, toolName: "codebase-read", args: { filePath: "x" }, result: {} });
		telemetry.recordContextPack({
			owner: OWNER,
			repo: REPO,
			packId: "pack",
			cacheLookup: false,
			cacheHit: false,
			allocation: allocation(),
			observationIds: [],
			evidencePointers: 0,
			staleRejected: 0
		});
		telemetry.flush(store);
		expect(store.db.prepare("SELECT COUNT(*) AS count FROM reuse_telemetry_hourly").get()).toEqual({ count: 0 });
	});

	it("correlates claim to first useful task action", async () => {
		const store = await createTestStore();
		stores.push(store);
		const telemetry = new ReuseTelemetry(true);
		const base = { owner: OWNER, repo: REPO, session: "session-a", result: {} };
		telemetry.recordTool({
			...base,
			toolName: "claim-manage",
			args: { task_code: "TASK-1", agent: "worker" }
		});
		telemetry.recordTool({ ...base, toolName: "task-write", args: { task_code: "TASK-1", status: "in_progress" } });
		telemetry.flush(store);
		const metric = store.reuseTelemetry.summarize(OWNER, REPO).metrics.claim_to_first_action_ms;
		expect(metric.count).toBe(1);
		expect(metric.value).toBeGreaterThanOrEqual(0);
	});

	it("bounds persisted rows by retention cap", async () => {
		const store = await createTestStore();
		stores.push(store);
		for (let index = 0; index < 40; index++) {
			store.db
				.prepare("INSERT INTO reuse_telemetry_hourly VALUES (?, ?, ?, ?, '', 1, 0)")
				.run(OWNER, REPO, new Date(Date.now() - index * 3_600_000).toISOString(), `metric-${index}`);
		}
		store.reuseTelemetry.prune(365, 24);
		expect(
			(store.db.prepare("SELECT COUNT(*) AS count FROM reuse_telemetry_hourly").get() as { count: number }).count
		).toBe(24);
	});
});
