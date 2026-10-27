import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore, createTestStore } from "../../storage/sqlite";
import { CodebaseFileEntity } from "../../entities/codebase-file";

describe("CodebaseFile Entity", () => {
	let store: SQLiteStore;
	let entity: CodebaseFileEntity;

	beforeEach(async () => {
		store = await createTestStore();
		entity = store.codebaseFiles;
	});

	it("upsertFile inserts a new file and returns it", () => {
		const result = entity.upsertFile({
			repo: "test-repo",
			file_path: "src/index.ts",
			language: "typescript",
			checksum: "abc123",
			lines: 42,
			size_bytes: 1500
		});

		expect(result.id).toBeDefined();
		expect(result.repo).toBe("test-repo");
		expect(result.file_path).toBe("src/index.ts");
		expect(result.language).toBe("typescript");
		expect(result.checksum).toBe("abc123");
		expect(result.lines).toBe(42);
		expect(result.size_bytes).toBe(1500);
		expect(result.last_indexed_at).toBeDefined();
		expect(result.created_at).toBeDefined();
		expect(result.updated_at).toBeDefined();
	});

	it("upsertFile updates an existing file on second call", () => {
		const first = entity.upsertFile({
			repo: "test-repo",
			file_path: "src/main.ts",
			checksum: "v1",
			lines: 10
		});

		const second = entity.upsertFile({
			repo: "test-repo",
			file_path: "src/main.ts",
			checksum: "v2",
			lines: 25,
			language: "typescript"
		});

		expect(second.id).toBe(first.id);
		expect(second.checksum).toBe("v2");
		expect(second.lines).toBe(25);
		expect(second.language).toBe("typescript");
		expect(second.created_at).toBe(first.created_at);
	});

	it("getFile retrieves a file by repo and path", () => {
		entity.upsertFile({
			repo: "my-repo",
			file_path: "lib/utils.ts",
			language: "typescript"
		});

		const found = entity.getFile("my-repo", "lib/utils.ts");
		expect(found).toBeDefined();
		expect(found?.repo).toBe("my-repo");
		expect(found?.file_path).toBe("lib/utils.ts");

		const notFound = entity.getFile("my-repo", "nonexistent.ts");
		expect(notFound).toBeUndefined();
	});

	it("getFilesByRepo returns all files for a repo ordered by path", () => {
		entity.upsertFile({ repo: "repo-a", file_path: "z.ts" });
		entity.upsertFile({ repo: "repo-a", file_path: "a.ts" });
		entity.upsertFile({ repo: "repo-b", file_path: "m.ts" });

		const files = entity.getFilesByRepo("repo-a");
		expect(files.length).toBe(2);
		expect(files[0].file_path).toBe("a.ts");
		expect(files[1].file_path).toBe("z.ts");
	});

	it("getFilesByRepo slim mode selects only staleness/planning columns", () => {
		entity.upsertFile({
			repo: "repo-slim",
			file_path: "src/index.ts",
			language: "typescript",
			checksum: "abc123",
			lines: 42,
			size_bytes: 1500
		});

		const slim = entity.getFilesByRepo("repo-slim", { slim: true });
		expect(slim.length).toBe(1);

		// Only the three projected columns are returned — no full-row columns.
		expect(Object.keys(slim[0]).sort()).toEqual(["checksum", "file_path", "last_indexed_at"]);
		expect(slim[0].file_path).toBe("src/index.ts");
		expect(slim[0].checksum).toBe("abc123");
		expect(slim[0].last_indexed_at).toBeDefined();

		// Default (full) mode is unaffected and still hydrates every column.
		const full = entity.getFilesByRepo("repo-slim");
		expect(full[0].id).toBeDefined();
		expect(full[0].language).toBe("typescript");
		expect(full[0].lines).toBe(42);
		expect(full[0].size_bytes).toBe(1500);
	});

	it("getFileCountByRepo returns the count of files", () => {
		expect(entity.getFileCountByRepo("empty-repo")).toBe(0);

		entity.upsertFile({ repo: "repo-x", file_path: "a.ts" });
		entity.upsertFile({ repo: "repo-x", file_path: "b.ts" });
		entity.upsertFile({ repo: "repo-y", file_path: "c.ts" });

		expect(entity.getFileCountByRepo("repo-x")).toBe(2);
		expect(entity.getFileCountByRepo("repo-y")).toBe(1);
	});

	it("deleteFile removes a file and returns true, returns false for missing", () => {
		entity.upsertFile({ repo: "repo-d", file_path: "to-delete.ts" });

		expect(entity.deleteFile("repo-d", "to-delete.ts")).toBe(true);
		expect(entity.getFile("repo-d", "to-delete.ts")).toBeUndefined();
		expect(entity.deleteFile("repo-d", "to-delete.ts")).toBe(false);
	});

	it("deleteFilesByRepo removes all files for a repo and returns count", () => {
		entity.upsertFile({ repo: "repo-del", file_path: "a.ts" });
		entity.upsertFile({ repo: "repo-del", file_path: "b.ts" });
		entity.upsertFile({ repo: "repo-keep", file_path: "c.ts" });

		const deleted = entity.deleteFilesByRepo("repo-del");
		expect(deleted).toBe(2);
		expect(entity.getFilesByRepo("repo-del")).toEqual([]);
		expect(entity.getFilesByRepo("repo-keep").length).toBe(1);
	});

	it("unique constraint: upsertFile twice for same repo+path upserts instead of error", () => {
		const first = entity.upsertFile({ repo: "repo-u", file_path: "same.ts", lines: 1 });
		// Second upsert should NOT throw
		const second = entity.upsertFile({ repo: "repo-u", file_path: "same.ts", lines: 2 });

		expect(second.id).toBe(first.id);
		expect(entity.getFilesByRepo("repo-u").length).toBe(1);
	});

	it("getFilesByStatus: indexed returns files with last_indexed_at", () => {
		entity.upsertFile({ repo: "repo-status", file_path: "indexed.ts", checksum: "abc" });
		// This file was just upserted so last_indexed_at is set
		const indexed = entity.getFilesByStatus("repo-status", "indexed");
		expect(indexed.length).toBe(1);
		expect(indexed[0].file_path).toBe("indexed.ts");
	});

	it("getFilesByStatus: unknown status returns all files", () => {
		entity.upsertFile({ repo: "repo-unknown", file_path: "file.ts" });
		const result = entity.getFilesByStatus("repo-unknown", "unknown");
		expect(result.length).toBe(1);
	});

	it("transferFile: moves file from old to new path", () => {
		entity.upsertFile({ repo: "repo-transfer", file_path: "old/path.ts", checksum: "abc" });

		const result = entity.transferFile("repo-transfer", "old/path.ts", "new/path.ts");
		expect(result).toBe(true);

		// Old path no longer exists
		expect(entity.getFile("repo-transfer", "old/path.ts")).toBeUndefined();

		// New path exists
		const moved = entity.getFile("repo-transfer", "new/path.ts");
		expect(moved).toBeDefined();
		expect(moved!.file_path).toBe("new/path.ts");
	});

	it("transferFile: returns false for non-existent file", () => {
		const result = entity.transferFile("repo-transfer", "ghost.ts", "moved.ts");
		expect(result).toBe(false);
	});

	it("upsertFile: handles null language, checksum, and missing lines/size", () => {
		const result = entity.upsertFile({
			repo: "repo-minimal",
			file_path: "src/minimal.ts",
			language: null,
			checksum: null
		});

		expect(result.language).toBeNull();
		expect(result.checksum).toBeNull();
		expect(result.lines).toBe(0);
		expect(result.size_bytes).toBe(0);
	});
});
