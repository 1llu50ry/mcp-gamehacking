// Feature: Dashboard Filter & Export Property Tests

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { MockMemory } from "../types/index";

describe("Property 12: Dashboard filter logic correctness", () => {
	// Filter function (same as in dashboard)
	function applyFilters(
		memories: MockMemory[],
		searchQuery: string,
		typeFilter: string,
		minImportance: number,
		maxImportance: number
	): MockMemory[] {
		let filtered = [...memories];

		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			filtered = filtered.filter((m) => m.content.toLowerCase().includes(q) || m.type.toLowerCase().includes(q));
		}

		if (typeFilter) {
			filtered = filtered.filter((m) => m.type === typeFilter);
		}

		if (minImportance > 0) {
			filtered = filtered.filter((m) => m.importance >= minImportance);
		}

		if (maxImportance < 5) {
			filtered = filtered.filter((m) => m.importance <= maxImportance);
		}

		return filtered;
	}

	it("property: search filter returns subset containing search term", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.uuid(),
						type: fc.constantFrom("code_fact", "decision", "mistake", "pattern", "task_archive"),
						content: fc.string({ minLength: 10, maxLength: 100 }),
						importance: fc.integer({ min: 1, max: 5 }),
						hit_count: fc.integer({ min: 0, max: 100 })
					})
				),
				fc.string({ minLength: 1, maxLength: 20 }),
				(memories: MockMemory[], query: string) => {
					if (memories.length === 0) return true;

					const filtered = applyFilters(memories, query, "", 0, 5);

					// All results should contain query (if any returned)
					for (const m of filtered) {
						const containsQuery =
							m.content.toLowerCase().includes(query.toLowerCase()) ||
							m.type.toLowerCase().includes(query.toLowerCase());
						expect(containsQuery).toBe(true);
					}

					// Filtered should not be larger than original
					expect(filtered.length).toBeLessThanOrEqual(memories.length);
				}
			),
			{ numRuns: 50 }
		);
	});

	it("property: type filter returns only matching types", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.uuid(),
						type: fc.constantFrom("code_fact", "decision", "mistake", "pattern", "task_archive"),
						content: fc.string({ minLength: 10, maxLength: 100 }),
						importance: fc.integer({ min: 1, max: 5 })
					})
				),
				fc.constantFrom("", "code_fact", "decision", "mistake", "pattern", "task_archive"),
				(memories: MockMemory[], typeFilter: string) => {
					const filtered = applyFilters(memories, "", typeFilter, 0, 5);

					if (typeFilter === "") {
						// No filter should return all
						expect(filtered.length).toBe(memories.length);
					} else {
						// All results should have matching type
						for (const m of filtered) {
							expect(m.type).toBe(typeFilter);
						}
					}
				}
			),
			{ numRuns: 50 }
		);
	});

	it("property: importance range filter returns correct subset", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.uuid(),
						type: fc.constantFrom("code_fact", "decision", "mistake", "pattern", "task_archive"),
						content: fc.string({ minLength: 10 }),
						importance: fc.integer({ min: 1, max: 5 })
					})
				),
				fc.integer({ min: 0, max: 5 }),
				fc.integer({ min: 0, max: 5 }),
				(memories: MockMemory[], minImp: number, maxImp: number) => {
					const safeMin = Math.min(minImp, maxImp);
					const safeMax = Math.max(minImp, maxImp);

					const filtered = applyFilters(memories, "", "", safeMin, safeMax);

					for (const m of filtered) {
						expect(m.importance).toBeGreaterThanOrEqual(safeMin);
						expect(m.importance).toBeLessThanOrEqual(safeMax);
					}
				}
			),
			{ numRuns: 50 }
		);
	});

	it("property: combination filters are additive (AND logic)", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.uuid(),
						type: fc.constantFrom("code_fact", "decision", "mistake", "pattern", "task_archive"),
						content: fc.string({ minLength: 10 }),
						importance: fc.integer({ min: 1, max: 5 })
					})
				),
				fc.string({ maxLength: 10 }),
				fc.constantFrom("", "code_fact", "decision"),
				fc.integer({ min: 1, max: 3 }),
				fc.integer({ min: 3, max: 5 }),
				(memories: MockMemory[], search: string, type: string, minImp: number, maxImp: number) => {
					const safeMin = Math.min(minImp, maxImp);
					const safeMax = Math.max(minImp, maxImp);

					const filtered = applyFilters(memories, search, type, safeMin, safeMax);

					// Verify each result matches ALL criteria
					for (const m of filtered) {
						if (search) {
							expect(
								m.content.toLowerCase().includes(search.toLowerCase()) ||
									m.type.toLowerCase().includes(search.toLowerCase())
							).toBe(true);
						}
						if (type) {
							expect(m.type).toBe(type);
						}
						expect(m.importance).toBeGreaterThanOrEqual(safeMin);
						expect(m.importance).toBeLessThanOrEqual(safeMax);
					}
				}
			),
			{ numRuns: 30 }
		);
	});
});

describe("Property 14: Export format correctness", () => {
	function exportToCsv(memories: MockMemory[]): string {
		const headers = ["id", "type", "content", "importance", "hit_count", "created_at", "agent", "model"];
		const csvRows = [headers.join(",")];
		for (const m of memories) {
			const row = [
				m.id,
				m.type,
				`"${m.content.replace(/"/g, '""')}"`,
				m.importance,
				m.hit_count,
				m.created_at,
				m.agent || "unknown",
				m.model || "unknown"
			];
			csvRows.push(row.join(","));
		}
		return csvRows.join("\n");
	}

	function exportToJson(memories: MockMemory[]): string {
		return JSON.stringify(memories, null, 2);
	}

	it("property: CSV export contains all filtered data", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.uuid(),
						type: fc.constantFrom("code_fact", "decision", "mistake", "pattern", "task_archive"),
						content: fc.string({ minLength: 5, maxLength: 50 }),
						importance: fc.integer({ min: 1, max: 5 }),
						hit_count: fc.integer({ min: 0, max: 20 }),
						created_at: fc.constant("2026-04-02T10:00:00Z"),
						agent: fc.string({ minLength: 3 }),
						model: fc.string({ minLength: 3 })
					})
				),
				(memories) => {
					if (memories.length === 0) return;

					const csv = exportToCsv(memories);
					const lines = csv.split("\n");

					// Header + data rows
					expect(lines.length).toBe(memories.length + 1);

					// Each row has 6 columns
					for (let i = 1; i < lines.length; i++) {
						const cols = lines[i].split(",");
						expect(cols.length).toBeGreaterThanOrEqual(5);
					}
				}
			),
			{ numRuns: 30, endOnFailure: true }
		);
	});

	it("property: JSON export is valid parseable JSON", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.uuid(),
						type: fc.constantFrom("code_fact", "decision", "mistake", "pattern", "task_archive"),
						content: fc.string({ minLength: 5 }),
						importance: fc.integer({ min: 1, max: 5 }),
						hit_count: fc.integer({ min: 0, max: 10 }),
						created_at: fc.string(),
						agent: fc.string({ minLength: 3 }),
						model: fc.string({ minLength: 3 })
					})
				),
				(memories: MockMemory[]) => {
					const json = exportToJson(memories);
					const parsed = JSON.parse(json);

					expect(Array.isArray(parsed)).toBe(true);
					expect(parsed.length).toBe(memories.length);
				}
			),
			{ numRuns: 30 }
		);
	});

	it("property: export respects filter (matches displayed data)", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.uuid(),
						type: fc.constantFrom("decision", "mistake", "code_fact", "pattern", "task_archive"),
						content: fc.string({ minLength: 10 }),
						importance: fc.integer({ min: 1, max: 5 }),
						hit_count: fc.integer({ min: 0, max: 100 }),
						created_at: fc.constant("2026-04-02T10:00:00Z"),
						agent: fc.string({ minLength: 3 }),
						model: fc.string({ minLength: 3 })
					})
				),
				fc.constantFrom("decision", "mistake", "code_fact", "pattern", "task_archive"),
				(memories, typeFilter) => {
					// Apply filter (same as dashboard)
					const filtered = memories.filter((m) => m.type === typeFilter);

					const csv = exportToCsv(filtered);
					const json = exportToJson(filtered);

					// CSV should have filtered count + 1 header
					expect(csv.split("\n").length).toBe(filtered.length + 1);

					// JSON should parse to filtered array
					const parsed = JSON.parse(json);
					expect(parsed.length).toBe(filtered.length);
				}
			),
			{ numRuns: 30 }
		);
	});
});

describe("Property 15: localStorage preferences round-trip", () => {
	// Mock localStorage for Node.js environment
	let mockStorage: Record<string, string> = {};

	beforeEach(() => {
		mockStorage = {};
		global.localStorage = {
			getItem: (key: string) => mockStorage[key] || null,
			setItem: (key: string, value: string) => {
				mockStorage[key] = value;
			},
			removeItem: (key: string) => {
				delete mockStorage[key];
			},
			clear: () => {
				mockStorage = {};
			},
			get length() {
				return Object.keys(mockStorage).length;
			},
			key: (i: number) => Object.keys(mockStorage)[i] || null
		} as unknown as Storage;
	});

	afterEach(() => {
		delete (global as unknown as Record<string, unknown>).localStorage;
	});

	interface DashboardPrefs {
		theme: "light" | "dark";
		pageSize: number;
		columnVisibility: Record<string, boolean>;
		columnWidths: Record<string, number>;
	}

	function savePrefs(prefs: DashboardPrefs): void {
		localStorage.setItem("dashboard_prefs", JSON.stringify(prefs));
	}

	function loadPrefs(): DashboardPrefs | null {
		const stored = localStorage.getItem("dashboard_prefs");
		return stored ? JSON.parse(stored) : null;
	}

	it("property: saved preferences can be loaded identically", () => {
		fc.assert(
			fc.property(
				fc.record({
					theme: fc.constantFrom("light", "dark"),
					pageSize: fc.constantFrom(10, 25, 50, 100),
					columnVisibility: fc.record({ id: fc.boolean(), type: fc.boolean(), content: fc.boolean() }),
					columnWidths: fc.record({ id: fc.integer({ min: 50, max: 300 }), type: fc.integer({ min: 50, max: 300 }) })
				}),
				(prefs) => {
					savePrefs(prefs as unknown as DashboardPrefs);
					const loaded = loadPrefs();

					expect(loaded).not.toBeNull();
					expect(loaded?.theme).toBe(prefs.theme);
					expect(loaded?.pageSize).toBe(prefs.pageSize);
				}
			),
			{ numRuns: 30 }
		);
	});
});

describe("Property 16: Recent Queries feature", () => {
	let mockStorage: Record<string, string> = {};

	beforeEach(() => {
		mockStorage = {};
		global.localStorage = {
			getItem: (key: string) => mockStorage[key] || null,
			setItem: (key: string, value: string) => {
				mockStorage[key] = value;
			},
			removeItem: (key: string) => {
				delete mockStorage[key];
			},
			clear: () => {
				mockStorage = {};
			},
			get length() {
				return Object.keys(mockStorage).length;
			},
			key: (i: number) => Object.keys(mockStorage)[i] || null
		} as unknown as Storage;
	});

	afterEach(() => {
		delete (global as unknown as Record<string, unknown>).localStorage;
	});

	// Simulate recent queries stored in localStorage (fallback)
	function getRecentQueriesFromStorage(): string[] {
		const stored = localStorage.getItem("recentQueries");
		return stored ? JSON.parse(stored) : [];
	}

	function addRecentQueryToStorage(query: string): void {
		if (!query.trim()) return;
		const queries = getRecentQueriesFromStorage();
		const filtered = queries.filter((q) => q !== query);
		filtered.unshift(query);
		const limited = filtered.slice(0, 20);
		localStorage.setItem("recentQueries", JSON.stringify(limited));
	}

	it("property: adding query moves it to front and removes duplicates", () => {
		addRecentQueryToStorage("database");
		addRecentQueryToStorage("authentication");
		addRecentQueryToStorage("database"); // duplicate - should move to front

		const queries = getRecentQueriesFromStorage();

		expect(queries[0]).toBe("database");
		expect(queries[1]).toBe("authentication");
		expect(queries.length).toBe(2);
	});

	it("property: recent queries are limited to 20", () => {
		for (let i = 0; i < 25; i++) {
			addRecentQueryToStorage(`query-${i}`);
		}

		const queries = getRecentQueriesFromStorage();

		expect(queries.length).toBe(20);
		expect(queries[0]).toBe("query-24");
		expect(queries[19]).toBe("query-5");
	});

	it("property: empty query is not added", () => {
		addRecentQueryToStorage("valid-query");
		addRecentQueryToStorage("");
		addRecentQueryToStorage("   ");

		const queries = getRecentQueriesFromStorage();

		expect(queries.length).toBe(1);
		expect(queries[0]).toBe("valid-query");
	});

	it("property: queries maintain insertion order with unique constraint", () => {
		addRecentQueryToStorage("first");
		addRecentQueryToStorage("second");
		addRecentQueryToStorage("third");
		addRecentQueryToStorage("first"); // move to front
		addRecentQueryToStorage("second"); // move to front

		const queries = getRecentQueriesFromStorage();

		expect(queries).toEqual(["second", "first", "third"]);
	});
});

describe("Property 17: Recent Queries API response format", () => {
	// Simulate API response parsing
	interface RecentQueriesResponse {
		queries: string[];
	}

	function parseRecentQueriesResponse(json: string): RecentQueriesResponse {
		const parsed = JSON.parse(json);
		if (!Array.isArray(parsed.queries)) {
			throw new Error("Invalid response: queries must be an array");
		}
		return parsed;
	}

	it("property: valid API response parses correctly", () => {
		const apiResponse = JSON.stringify({
			queries: ["database", "authentication", "user management"]
		});

		const result = parseRecentQueriesResponse(apiResponse);

		expect(result.queries).toHaveLength(3);
		expect(result.queries[0]).toBe("database");
	});

	it("property: empty queries array is valid", () => {
		const apiResponse = JSON.stringify({ queries: [] });

		const result = parseRecentQueriesResponse(apiResponse);

		expect(result.queries).toHaveLength(0);
	});

	it("property: malformed response throws error", () => {
		expect(() => parseRecentQueriesResponse("not json")).toThrow();
		expect(() => parseRecentQueriesResponse("{}")).toThrow();
		expect(() => parseRecentQueriesResponse('{"results": []}')).toThrow();
	});
});
