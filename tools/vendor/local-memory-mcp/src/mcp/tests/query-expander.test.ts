import { describe, it, expect } from "vitest";
import { expandQuery } from "../utils/query-expander";

describe("expandQuery", () => {
	it("includes original query and expands keywords", () => {
		const result = expandQuery("database");
		expect(result).toContain("database");
		expect(result).toContain("sql");
		expect(result).toContain("db");
	});

	it("expands query with prompt keywords", () => {
		const result = expandQuery("database", "user authentication implementation");
		expect(result).toContain("database");
		expect(result).toContain("auth");
		expect(result).toContain("login");
	});

	it("expands technical synonyms", () => {
		const result = expandQuery("auth", "login system");
		expect(result).toContain("auth");
		expect(result).toContain("login");
		expect(result).toContain("security");
		expect(result).toContain("permission");
	});

	it("removes duplicates", () => {
		const result = expandQuery("database", "database query optimization");
		const words = result.split(" ");
		const unique = new Set(words);
		expect(words.length).toBe(unique.size);
	});

	it("handles empty prompt gracefully", () => {
		expect(expandQuery("test", "")).toContain("test");
	});
});
