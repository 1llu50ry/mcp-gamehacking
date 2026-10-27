import { describe, expect, it, vi } from "vitest";
import { CapabilityAwareVectorStore } from "../storage/lazy-vectors";
import {
	RuntimeCapabilityRegistry,
	getRuntimeCapabilities,
	isSemanticToolDemand,
	resolveRuntimeProfile,
	setRuntimeCapabilities
} from "../runtime-capabilities";
import type { VectorStore } from "../types";

describe("RuntimeCapabilityRegistry", () => {
	it("defaults to full for backward compatibility and accepts explicit profiles", () => {
		expect(resolveRuntimeProfile(undefined)).toBe("full");
		expect(resolveRuntimeProfile("balanced")).toBe("balanced");
		expect(resolveRuntimeProfile("minimal")).toBe("minimal");
		expect(resolveRuntimeProfile("unknown")).toBe("full");
	});

	it("keeps semantic, indexing, watcher, and maintenance unavailable in minimal", async () => {
		const registry = new RuntimeCapabilityRegistry("minimal");
		const loader = vi.fn();
		registry.register("semantic", loader);
		expect(await registry.ensure("semantic")).toBe(false);
		expect(loader).not.toHaveBeenCalled();
		expect(registry.snapshot().capabilities.semantic.state).toBe("unavailable");
	});

	it("shares one initialization promise across concurrent first-use calls", async () => {
		const registry = new RuntimeCapabilityRegistry("balanced");
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const loader = vi.fn(() => gate);
		registry.register("semantic", loader);
		const first = registry.ensure("semantic");
		const second = registry.ensure("semantic");
		await Promise.resolve();
		expect(loader).toHaveBeenCalledTimes(1);
		release();
		expect(await Promise.all([first, second])).toEqual([true, true]);
		expect(registry.snapshot().capabilities.semantic.state).toBe("ready");
	});

	it("keeps balanced lazy and full explicitly warmable", async () => {
		const balanced = new RuntimeCapabilityRegistry("balanced");
		const balancedLoader = vi.fn();
		balanced.register("semantic", balancedLoader);
		expect(balanced.snapshot().capabilities.semantic.state).toBe("idle");
		expect(balancedLoader).not.toHaveBeenCalled();

		const full = new RuntimeCapabilityRegistry("full");
		const fullLoader = vi.fn();
		full.register("semantic", fullLoader);
		await full.warmup(["semantic"]);
		expect(fullLoader).toHaveBeenCalledTimes(1);
		expect(full.snapshot().capabilities.semantic.state).toBe("ready");
	});

	it("recognizes semantic writes and query-bearing reads", () => {
		expect(isSemanticToolDemand("memory-read", { query: "cache" })).toBe(true);
		expect(isSemanticToolDemand("agent-context", { objective: "cache" })).toBe(true);
		expect(isSemanticToolDemand("memory-write", { content: "cache" })).toBe(true);
		expect(isSemanticToolDemand("task-read", {})).toBe(false);
	});

	it("exposes the active process registry to existing status surfaces", () => {
		const registry = new RuntimeCapabilityRegistry("balanced");
		setRuntimeCapabilities(registry);
		expect(getRuntimeCapabilities()).toBe(registry);
		setRuntimeCapabilities(new RuntimeCapabilityRegistry("full"));
	});

	it("lets legacy environment gates disable one capability without changing the profile", async () => {
		const registry = new RuntimeCapabilityRegistry("full");
		const loader = vi.fn();
		registry.register("watcher", loader);
		registry.disable("watcher", "Disabled via ENABLE_FILE_WATCHER=false");
		expect(await registry.ensure("watcher")).toBe(false);
		expect(loader).not.toHaveBeenCalled();
		expect(registry.snapshot().capabilities.watcher).toMatchObject({
			state: "unavailable",
			error: "Disabled via ENABLE_FILE_WATCHER=false"
		});
	});

	it("reports a missing loader as degraded instead of pretending it is ready", async () => {
		const registry = new RuntimeCapabilityRegistry("balanced");
		expect(await registry.ensure("indexing")).toBe(false);
		expect(registry.snapshot().capabilities.indexing).toMatchObject({
			state: "degraded",
			error: "No capability loader registered"
		});
	});

	it("isolates failures and retries a transient initialization on next demand", async () => {
		const registry = new RuntimeCapabilityRegistry("full");
		const loader = vi.fn().mockRejectedValueOnce(new Error("model unavailable")).mockResolvedValueOnce(undefined);
		registry.register("semantic", loader);
		expect(await registry.ensure("semantic")).toBe(false);
		const failed = registry.snapshot();
		expect(failed.capabilities.semantic).toMatchObject({ state: "failed", error: "model unavailable" });
		expect(failed.capabilities.indexing.state).toBe("idle");
		expect(failed.footprint.rss_bytes).toBeGreaterThan(0);
		expect(await registry.ensure("semantic")).toBe(true);
		expect(loader).toHaveBeenCalledTimes(2);
		expect(registry.snapshot().capabilities.semantic.state).toBe("ready");
	});
});

describe("CapabilityAwareVectorStore", () => {
	function makeInner(): VectorStore {
		return {
			initialize: vi.fn().mockResolvedValue(undefined),
			embed: vi.fn().mockResolvedValue([[1, 0]]),
			upsert: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			search: vi.fn().mockResolvedValue([{ id: "m1", score: 1 }])
		};
	}

	it("keeps lexical paths operational when semantic is unavailable", async () => {
		const registry = new RuntimeCapabilityRegistry("minimal");
		const inner = makeInner();
		const vectors = new CapabilityAwareVectorStore(inner, registry);
		expect(await vectors.search("query", 5)).toEqual([]);
		expect(await vectors.embed(["text"])).toEqual([]);
		expect(inner.search).not.toHaveBeenCalled();
		expect(inner.embed).not.toHaveBeenCalled();
	});

	it("loads semantic once and delegates first-use operations in balanced", async () => {
		const registry = new RuntimeCapabilityRegistry("balanced");
		const inner = makeInner();
		registry.register("semantic", () => inner.initialize?.());
		const vectors = new CapabilityAwareVectorStore(inner, registry);
		await Promise.all([vectors.search("query", 5), vectors.search("other", 5)]);
		expect(inner.initialize).toHaveBeenCalledTimes(1);
		expect(inner.search).toHaveBeenCalledTimes(2);
	});
});
