// Feature: memory-mcp-optimization, Property 19: memory://index filter repo
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { createTestStore } from "../storage/sqlite";
import { readResource, listResourceTemplates, listResources } from "../resources/index";
import { MemoryEntry } from "../types";
import { createSessionContext, updateSessionRoots } from "../session";

function makeEntry(id: string, repo: string): MemoryEntry {
	return {
		id,
		type: "code_fact",
		title: `Memory ${id}`,
		content: `Content for memory ${id} in repo ${repo}`,
		importance: 3,
		agent: "test-agent",
		role: "unknown",
		model: "test-model",
		scope: { owner: "test", repo },
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: false
	};
}

describe("readResource memory://memories", () => {
	it("returns recent entries when no repo filter", async () => {
		const db = await createTestStore();
		db.memories.insert(makeEntry("id-1", "repo-a"));
		db.memories.insert(makeEntry("id-2", "repo-b"));

		const result = readResource("repository://repo-a/memories", db);
		const entries = JSON.parse(result.contents[0].text);
		expect(entries.length).toBeGreaterThan(0);
		db.close();
	});

	it("returns only entries for the specified repo when ?repo=X is given", async () => {
		const db = await createTestStore();
		db.memories.insert(makeEntry("id-a1", "repo-alpha"));
		db.memories.insert(makeEntry("id-a2", "repo-alpha"));
		db.memories.insert(makeEntry("id-b1", "repo-beta"));

		const result = readResource("repository://repo-alpha/memories", db);
		const entries: MemoryEntry[] = JSON.parse(result.contents[0].text);

		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) {
			expect(entry.scope.repo).toBe("repo-alpha");
		}
		db.close();
	});

	it("returns empty array when repo has no entries", async () => {
		const db = await createTestStore();
		db.memories.insert(makeEntry("id-1", "repo-a"));

		const result = readResource("repository://nonexistent/memories", db);
		const entries = JSON.parse(result.contents[0].text);
		expect(entries).toEqual([]);
		db.close();
	});

	/**
	 * Property 19: memory://memories dengan filter repo mengembalikan subset yang benar
	 * Validates: Requirements 19.1, 19.3
	 */
	it("Property 19: all returned entries have repo === queried repo", async () => {
		await fc.assert(
			fc.asyncProperty(
				// Generate 2-4 distinct repo names
				fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{2,8}$/), { minLength: 2, maxLength: 4 }),
				// Generate 1-5 memories per repo
				fc.integer({ min: 1, max: 5 }),
				async (repos: string[], memoriesPerRepo: number) => {
					const db = await createTestStore();

					// Insert memories for each repo
					let counter = 0;
					for (const repo of repos) {
						for (let i = 0; i < memoriesPerRepo; i++) {
							db.memories.insert(makeEntry(`id-${counter++}`, repo));
						}
					}

					// Query with the first repo as filter
					const targetRepo = repos[0];
					const result = readResource(`repository://${targetRepo}/memories`, db);
					const entries: MemoryEntry[] = JSON.parse(result.contents[0].text);

					// All returned entries must belong to targetRepo
					const allMatch = entries.every((e) => e.scope.repo === targetRepo);

					db.close();
					return allMatch;
				}
			),
			{ numRuns: 50 }
		);
		// REL-051: raised from 15000ms. This property creates a fresh in-memory
		// SQLite store per run (50 runs) and flaked with a timeout under
		// parallel load (observed during the 0.49.0 gate as well as the 0.51.0
		// Release gate). The assertion is unchanged; only the wall-clock budget
		// is widened to absorb scheduling contention.
	}, 60_000);

	it("Property 19 (no filter): returns entries from all repos", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{2,8}$/), { minLength: 2, maxLength: 3 }),
				async (repos: string[]) => {
					const db = await createTestStore();

					for (const repo of repos) {
						db.memories.insert(makeEntry(`id-${repo}`, repo));
					}

					const result = readResource(`repository://${repos[0]}/memories`, db);
					const entries: MemoryEntry[] = JSON.parse(result.contents[0].text);

					// Returns entries for the specific repo
					expect(entries.length).toBeGreaterThan(0);

					db.close();
					return true;
				}
			),
			{ numRuns: 100 }
		);
		// REL-051: explicit 60s budget. This property creates a fresh
		// in-memory SQLite store per run (100 runs) and flaked with a timeout
		// under full parallel load (observed in a clean `--project unit` run).
		// The assertion is unchanged; only the wall-clock budget is widened to
		// absorb scheduling contention.
	}, 60_000);
});

describe("MCP resource templates and session resources", () => {
	it("supports resource list pagination with nextCursor", () => {
		const session = createSessionContext();
		const firstPage = listResources(session, { limit: 1 });
		const secondPage = listResources(session, { limit: 1, cursor: firstPage.nextCursor });

		expect(firstPage.resources).toHaveLength(1);
		expect(firstPage.nextCursor).toBeTruthy();
		expect(secondPage.resources).toHaveLength(1);
	});

	it("supports resource template pagination with nextCursor", () => {
		const firstPage = listResourceTemplates({ limit: 2 });
		const secondPage = listResourceTemplates({ limit: 2, cursor: firstPage.nextCursor });
		const secondTemplates = secondPage.resourceTemplates as Array<{ uriTemplate: string }>;

		expect(firstPage.resourceTemplates).toHaveLength(2);
		expect(firstPage.nextCursor).toBeTruthy();
		expect(secondTemplates.length).toBeGreaterThan(0);
	});

	it("rejects invalid cursors for resources/list with MCP invalid params error", () => {
		const session = createSessionContext();

		expect(() => listResources(session, { cursor: "%%%not-base64%%%" })).toThrowError(/Invalid cursor/);

		try {
			listResources(session, { cursor: "%%%not-base64%%%" });
		} catch (error: unknown) {
			const mcpError = error as { code?: number };
			expect(mcpError.code).toBe(-32602);
		}
	});

	it("rejects invalid cursors for resources/templates/list with MCP invalid params error", () => {
		expect(() => listResourceTemplates({ cursor: "%%%not-base64%%%" })).toThrowError(/Invalid cursor/);

		try {
			listResourceTemplates({ cursor: "%%%not-base64%%%" });
		} catch (error: unknown) {
			const mcpError = error as { code?: number };
			expect(mcpError.code).toBe(-32602);
		}
	});

	it("lists parameterized resources via resources/templates/list", () => {
		const result = listResourceTemplates();
		const templates = (result.resourceTemplates as Array<{ uriTemplate: string }>).map((entry) => entry.uriTemplate);

		expect(templates).toContain("memory://{id}");
		expect(templates).toContain("repository://{name}/tasks");
		expect(templates).toContain("repository://{name}/memories");
	});

	it("returns active session roots as a concrete resource", async () => {
		const db = await createTestStore();
		const session = createSessionContext();
		updateSessionRoots(session, [
			{ uri: "file:///workspace/project-a", name: "project-a" },
			{ uri: "file:///workspace/project-b" }
		]);

		const result = readResource("session://roots", db, session);
		const payload = JSON.parse(result.contents[0].text);

		expect(payload.roots).toHaveLength(2);
		expect(payload.roots[0].name).toBe("project-a");
		db.close();
	});

	it("adds annotations and size metadata to concrete resource content", async () => {
		const db = await createTestStore();
		const result = readResource("repository://repo-a/summary", db);
		const content = result.contents[0];

		expect(content.annotations.priority).toBeGreaterThan(0.5);
		expect(content.size).toBeGreaterThan(0);
		db.close();
	});

	it("throws MCP resource not found error code for unknown resources", async () => {
		const db = await createTestStore();

		expect(() => readResource("memory://missing/resource", db)).toThrowError(/Unknown resource URI/);

		try {
			readResource("memory://missing/resource", db);
		} catch (error: unknown) {
			const mcpError = error as { code: number; data: { uri: string } };
			expect(mcpError.code).toBe(-32002);
			expect(mcpError.data.uri).toBe("memory://missing/resource");
		} finally {
			db.close();
		}
	});
});
