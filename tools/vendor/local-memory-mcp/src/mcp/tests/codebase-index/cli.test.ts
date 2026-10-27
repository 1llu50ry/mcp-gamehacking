/**
 * CLI Index Tests — argument parsing and error handling.
 */
import { describe, it, expect } from "vitest";
import { parseIndexArgs } from "../../codebase-index/cli";

describe("parseIndexArgs", () => {
	it("parses required --repo and --path arguments", () => {
		const result = parseIndexArgs(["node", "server.js", "--index", "--repo", "owner/repo", "--path", "/tmp/test"]);

		expect(result).not.toHaveProperty("error");
		if ("error" in result) throw new Error("Expected success");
		expect(result.repo).toBe("owner/repo");
		expect(result.path).toBe("/tmp/test");
		expect(result.includeGlobs).toEqual([]);
		expect(result.excludeGlobs).toEqual([]);
	});

	it("parses optional --include flags (single)", () => {
		const result = parseIndexArgs([
			"node",
			"server.js",
			"--index",
			"--repo",
			"my/project",
			"--path",
			"/home/user/code",
			"--include",
			"src/**/*.ts"
		]);

		expect(result).not.toHaveProperty("error");
		if ("error" in result) throw new Error("Expected success");
		expect(result.includeGlobs).toEqual(["src/**/*.ts"]);
		expect(result.excludeGlobs).toEqual([]);
	});

	it("parses optional --exclude flags (single)", () => {
		const result = parseIndexArgs([
			"node",
			"server.js",
			"--index",
			"--repo",
			"my/project",
			"--path",
			"/home/user/code",
			"--exclude",
			"**/*.test.ts"
		]);

		expect(result).not.toHaveProperty("error");
		if ("error" in result) throw new Error("Expected success");
		expect(result.includeGlobs).toEqual([]);
		expect(result.excludeGlobs).toEqual(["**/*.test.ts"]);
	});

	it("accumulates multiple --include and --exclude flags", () => {
		const result = parseIndexArgs([
			"node",
			"server.js",
			"--index",
			"--repo",
			"my/project",
			"--path",
			"/tmp",
			"--include",
			"src/**/*.ts",
			"--include",
			"lib/**/*.js",
			"--exclude",
			"**/*.test.ts",
			"--exclude",
			"**/node_modules/**"
		]);

		expect(result).not.toHaveProperty("error");
		if ("error" in result) throw new Error("Expected success");
		expect(result.includeGlobs).toEqual(["src/**/*.ts", "lib/**/*.js"]);
		expect(result.excludeGlobs).toEqual(["**/*.test.ts", "**/node_modules/**"]);
	});

	it("handles --include and --exclude with no repo/path gracefully", () => {
		const result = parseIndexArgs(["node", "server.js", "--include", "src/**/*.ts", "--exclude", "**/*.test.ts"]);

		expect(result).toHaveProperty("error");
		if (!("error" in result)) throw new Error("Expected error");
		expect(result.error).toContain("--repo");
	});

	it("returns error when --repo is missing", () => {
		const result = parseIndexArgs(["node", "server.js", "--index", "--path", "/tmp/test"]);

		expect(result).toHaveProperty("error");
		if (!("error" in result)) throw new Error("Expected error");
		expect(result.error).toContain("--repo");
	});

	it("returns error when --path is missing", () => {
		const result = parseIndexArgs(["node", "server.js", "--index", "--repo", "owner/repo"]);

		expect(result).toHaveProperty("error");
		if (!("error" in result)) throw new Error("Expected error");
		expect(result.error).toContain("--path");
	});

	it("returns error when --repo value starts with dash", () => {
		const result = parseIndexArgs(["node", "server.js", "--index", "--repo", "--some-flag", "--path", "/tmp/test"]);

		expect(result).toHaveProperty("error");
		if (!("error" in result)) throw new Error("Expected error");
		expect(result.error).toContain("--repo");
	});

	it("returns error when --path value starts with dash", () => {
		const result = parseIndexArgs(["node", "server.js", "--index", "--repo", "owner/repo", "--path", "--some-flag"]);

		expect(result).toHaveProperty("error");
		if (!("error" in result)) throw new Error("Expected error");
		expect(result.error).toContain("--path");
	});

	it("ignores unknown flags", () => {
		const result = parseIndexArgs([
			"node",
			"server.js",
			"--index",
			"--repo",
			"owner/repo",
			"--path",
			"/tmp/test",
			"--verbose",
			"--debug"
		]);

		expect(result).not.toHaveProperty("error");
		if ("error" in result) throw new Error("Expected success");
		expect(result.repo).toBe("owner/repo");
		expect(result.path).toBe("/tmp/test");
	});

	it("skips --include without a value (next arg is a flag)", () => {
		const result = parseIndexArgs([
			"node",
			"server.js",
			"--index",
			"--repo",
			"owner/repo",
			"--path",
			"/tmp/test",
			"--include",
			"--exclude",
			"**/*.test.ts"
		]);

		expect(result).not.toHaveProperty("error");
		if ("error" in result) throw new Error("Expected success");
		expect(result.includeGlobs).toEqual([]);
		expect(result.excludeGlobs).toEqual(["**/*.test.ts"]);
	});

	it("skips --exclude without a value (next arg is a flag)", () => {
		const result = parseIndexArgs([
			"node",
			"server.js",
			"--index",
			"--repo",
			"owner/repo",
			"--path",
			"/tmp/test",
			"--exclude",
			"--include",
			"src/**/*.ts"
		]);

		expect(result).not.toHaveProperty("error");
		if ("error" in result) throw new Error("Expected success");
		expect(result.excludeGlobs).toEqual([]);
		expect(result.includeGlobs).toEqual(["src/**/*.ts"]);
	});

	it("handles include at the end of argv with no next value", () => {
		const result = parseIndexArgs([
			"node",
			"server.js",
			"--index",
			"--repo",
			"owner/repo",
			"--path",
			"/tmp/test",
			"--include"
		]);

		expect(result).not.toHaveProperty("error");
		if ("error" in result) throw new Error("Expected success");
		expect(result.includeGlobs).toEqual([]);
	});

	it("handles exclude at the end of argv with no next value", () => {
		const result = parseIndexArgs([
			"node",
			"server.js",
			"--index",
			"--repo",
			"owner/repo",
			"--path",
			"/tmp/test",
			"--exclude"
		]);

		expect(result).not.toHaveProperty("error");
		if ("error" in result) throw new Error("Expected success");
		expect(result.excludeGlobs).toEqual([]);
	});

	it("handles both missing repo and missing path", () => {
		const result = parseIndexArgs(["node", "server.js"]);

		expect(result).toHaveProperty("error");
		if (!("error" in result)) throw new Error("Expected error");
		expect(result.error).toContain("--repo");
	});

	it("returns error when --repo value is empty string", () => {
		const result = parseIndexArgs(["node", "server.js", "--index", "--repo", "", "--path", "/tmp/test"]);

		expect(result).toHaveProperty("error");
	});

	it("returns error when --path value is empty string", () => {
		const result = parseIndexArgs(["node", "server.js", "--index", "--repo", "owner/repo", "--path", ""]);

		expect(result).toHaveProperty("error");
	});
});
