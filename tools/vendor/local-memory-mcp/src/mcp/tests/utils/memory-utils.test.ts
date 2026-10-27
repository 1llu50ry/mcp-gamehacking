import { describe, it, expect, vi } from "vitest";
import { hasMetadataLikeTitle, isMemoryAcknowledged, resolveMemorySupersedes } from "../../utils/memory-utils";
import type { SQLiteStore } from "../../storage/sqlite";

function makeStorage() {
	const getByCode = vi.fn();
	return {
		memories: { getByCode }
	} as unknown as SQLiteStore;
}

describe("hasMetadataLikeTitle", () => {
	it("detects bracket-enclosed metadata patterns", () => {
		expect(hasMetadataLikeTitle("[agent: backend] fix pagination")).toBe(true);
		expect(hasMetadataLikeTitle("[role: dev] wire the UI")).toBe(true);
		expect(hasMetadataLikeTitle("[model: gpt-4] summarize")).toBe(true);
		expect(hasMetadataLikeTitle("[2024-06-01] daily recap")).toBe(true);
		expect(hasMetadataLikeTitle("[source_github] PR review")).toBe(true);
	});

	it("matches metadata prefixes case-insensitively", () => {
		expect(hasMetadataLikeTitle("[AGENT: backe] x")).toBe(true);
		expect(hasMetadataLikeTitle("[Source_GitHub] x")).toBe(true);
	});

	it("trims surrounding whitespace before matching", () => {
		expect(hasMetadataLikeTitle("  [agent: backend] title  ")).toBe(true);
	});

	it("rejects plain titles without metadata markers", () => {
		expect(hasMetadataLikeTitle("Implement pagination")).toBe(false);
		expect(hasMetadataLikeTitle("[feature] landing page")).toBe(false);
		expect(hasMetadataLikeTitle("")).toBe(false);
	});
});

describe("resolveMemorySupersedes", () => {
	it("returns null for null/undefined values", () => {
		const storage = makeStorage();
		expect(resolveMemorySupersedes(null, storage)).toBeNull();
		expect(resolveMemorySupersedes(undefined, storage)).toBeNull();
		expect(storage.memories.getByCode).not.toHaveBeenCalled();
	});

	it("passes a valid UUID through unchanged", () => {
		const storage = makeStorage();
		const uuid = "d8597488-f19c-4958-96b9-1dee148f2e91";
		expect(resolveMemorySupersedes(uuid, storage)).toBe(uuid);
	});

	it("resolves a memory code to its UUID via the store", () => {
		const storage = makeStorage();
		const getByCode = vi.mocked(storage.memories.getByCode) as ReturnType<typeof vi.fn>;
		getByCode.mockReturnValue({ id: "superseded-id" });
		expect(resolveMemorySupersedes("MEM-042", storage, "vheins", "repo")).toBe("superseded-id");
		expect(getByCode).toHaveBeenCalledWith("MEM-042", "vheins", "repo");
	});

	it("throws when a code does not resolve to a memory", () => {
		const storage = makeStorage();
		const getByCode = vi.mocked(storage.memories.getByCode) as ReturnType<typeof vi.fn>;
		getByCode.mockReturnValue(null);
		expect(() => resolveMemorySupersedes("MEM-404", storage)).toThrow("Memory not found: MEM-404");
	});
});

describe("isMemoryAcknowledged", () => {
	it("returns true when recall_count is greater than zero", () => {
		expect(isMemoryAcknowledged({ recall_count: 1 })).toBe(true);
		expect(isMemoryAcknowledged({ recall_count: 7 })).toBe(true);
	});

	it("returns false when recall_count is zero", () => {
		expect(isMemoryAcknowledged({ recall_count: 0 })).toBe(false);
	});
});
