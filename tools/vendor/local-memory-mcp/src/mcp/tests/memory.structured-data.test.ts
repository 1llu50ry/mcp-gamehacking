import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../storage/sqlite";
import type { MemoryEntry } from "../types";

function createMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	const now = new Date().toISOString();

	return {
		id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
		code: overrides.code,
		type: overrides.type ?? "code_fact",
		title: overrides.title ?? "Structured Data Memory",
		content: overrides.content ?? "Structured data persistence test content.",
		importance: overrides.importance ?? 3,
		agent: overrides.agent ?? "test-agent",
		role: overrides.role ?? "backend-executor",
		model: overrides.model ?? "test-model",
		scope: overrides.scope ?? { owner: "test", repo: "structured-data-repo" },
		created_at: overrides.created_at ?? now,
		updated_at: overrides.updated_at ?? now,
		completed_at: overrides.completed_at ?? null,
		hit_count: overrides.hit_count ?? 0,
		recall_count: overrides.recall_count ?? 0,
		last_used_at: overrides.last_used_at ?? null,
		expires_at: overrides.expires_at ?? null,
		supersedes: overrides.supersedes ?? null,
		status: overrides.status ?? "active",
		tags: overrides.tags ?? [],
		metadata: overrides.metadata ?? {},
		structuredData: overrides.structuredData,
		is_global: overrides.is_global ?? false
	};
}

describe("Memory structuredData storage conversion", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;

	beforeEach(async () => {
		db = await createTestStore();
	});

	it("persists structuredData inside stored metadata and preserves existing metadata", () => {
		const structuredData = {
			decision: "runtime validation",
			nested: { enabled: true },
			count: 2
		};

		const entry = createMemory({
			metadata: { source: "review", retained: true },
			structuredData
		});
		db.memories.insert(entry);

		const raw = db.db.prepare("SELECT metadata FROM memories WHERE id = ?").get(entry.id) as { metadata: string };
		const persistedMetadata = JSON.parse(raw.metadata) as Record<string, unknown>;
		const stored = db.memories.getById(entry.id);

		expect(persistedMetadata).toEqual({ source: "review", retained: true, structuredData });
		expect(stored?.structuredData).toEqual(structuredData);
		expect(stored?.metadata).toEqual({ source: "review", retained: true });
	});

	it("persists absent top-level structuredData as an empty object in metadata", () => {
		const entry = createMemory({
			id: "22222222-2222-4222-8222-222222222222",
			metadata: { source: "legacy" }
		});
		db.memories.insert(entry);

		const raw = db.db.prepare("SELECT metadata FROM memories WHERE id = ?").get(entry.id) as { metadata: string };
		const persistedMetadata = JSON.parse(raw.metadata) as Record<string, unknown>;
		const stored = db.memories.getById(entry.id);

		expect(persistedMetadata).toEqual({ source: "legacy", structuredData: {} });
		expect(stored?.structuredData).toEqual({});
		expect(stored?.metadata).toEqual({ source: "legacy" });
	});

	it("persists explicit empty structuredData round-trip", () => {
		const entry = createMemory({
			id: "33333333-3333-4333-8333-333333333333",
			metadata: { source: "empty-explicit" },
			structuredData: {}
		});
		db.memories.insert(entry);

		const raw = db.db.prepare("SELECT metadata FROM memories WHERE id = ?").get(entry.id) as { metadata: string };
		const persistedMetadata = JSON.parse(raw.metadata) as Record<string, unknown>;
		const stored = db.memories.getById(entry.id);

		expect(persistedMetadata).toEqual({ source: "empty-explicit", structuredData: {} });
		expect(stored?.structuredData).toEqual({});
		expect(stored?.metadata).toEqual({ source: "empty-explicit" });
	});
});
