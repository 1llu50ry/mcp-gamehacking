import { describe, expect, it } from "vitest";
import { createTestStore } from "../storage/sqlite";

describe("StandardEntity.count", () => {
	it("matches search(limit:100000).length for plain filters (TASK-406 parity)", async () => {
		const store = await createTestStore();
		const now = new Date().toISOString();
		for (let i = 0; i < 5; i++) {
			store.standards.insert({
				id: `std-${i}`,
				title: `T${i}`,
				content: `c${i}`,
				parent_id: null,
				context: "general",
				version: "1.0.0",
				language: "typescript",
				stack: ["react"],
				is_global: i === 0, // one global
				owner: "acme",
				repo: i === 0 ? null : "app",
				tags: ["ui"],
				metadata: {},
				created_at: now,
				updated_at: now,
				hit_count: 0,
				last_used_at: null,
				agent: "test",
				model: "test"
			});
		}
		// add a row for another repo
		store.standards.insert({
			id: "std-other",
			title: "Other",
			content: "x",
			parent_id: null,
			context: "general",
			version: "1.0.0",
			language: null,
			stack: [],
			is_global: false,
			owner: "acme",
			repo: "other-repo",
			tags: [],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});

		const filters = {
			repo: "app",
			is_global: undefined as boolean | undefined,
			query: undefined as string | undefined
		};
		const materialized = store.standards.search({ ...filters, limit: 100000, offset: 0 }).length;
		const counted = store.standards.count(filters);
		expect(counted).toBe(materialized);
		expect(counted).toBe(5); // 4 repo rows + 1 global
		store.close();
	});

	it("matches the FTS search materialization when a query is present (TASK-406 parity)", async () => {
		const store = await createTestStore();
		const now = new Date().toISOString();
		for (let i = 0; i < 3; i++) {
			store.standards.insert({
				id: `fts-${i}`,
				title: `Use UUID primary keys rule ${i}`,
				content: "Every entity must use a uuid primary key for safety",
				parent_id: null,
				context: "general",
				version: "1.0.0",
				language: null,
				stack: [],
				is_global: true,
				owner: "",
				repo: null,
				tags: ["database"],
				metadata: {},
				created_at: now,
				updated_at: now,
				hit_count: 0,
				last_used_at: null,
				agent: "test",
				model: "test"
			});
		}
		store.standards.insert({
			id: "fts-unrelated",
			title: "Unrelated title",
			content: "no uuid here",
			parent_id: null,
			context: "general",
			version: "1.0.0",
			language: null,
			stack: [],
			is_global: true,
			owner: "",
			repo: null,
			tags: [],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});

		const q = { query: "uuid", is_global: undefined as boolean | undefined };
		const materialized = store.standards.search({ ...q, limit: 100000, offset: 0 }).length;
		const counted = store.standards.count(q);
		expect(counted).toBe(materialized);
		expect(counted).toBeGreaterThan(0);
		store.close();
	});
});
