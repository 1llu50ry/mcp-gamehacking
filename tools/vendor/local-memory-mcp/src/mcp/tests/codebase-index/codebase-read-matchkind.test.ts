/**
 * codebase-read SEARCH — matchKind + related source lookup + repo scope
 * envelope (issue #81 / TASK-550).
 *
 * Regression coverage:
 *  (a) a Markdown-indexed heading result carries matchKind "documentation"
 *  (b) a real source symbol result carries matchKind "source"
 *  (c) when a doc heading references a source path token, the bounded
 *      secondary lookup surfaces matchKind "source" results with relatedTo set
 *  (d) the SEARCH envelope exposes repoRoot and a scope count (files/symbols)
 *      for the repo
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";

// ── Helpers ──────────────────────────────────────────────────────────────

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

function seed(store: SQLiteStore): void {
	store.codebaseSymbols.bulkUpsertSymbols([
		// Markdown heading (doc-only) — references a PHP namespace path.
		{
			repo: "test-repo",
			file_path: "docs/models.md",
			name: "Vheins\\Common\\Models",
			kind: "heading1",
			exported: false,
			start_line: 1,
			signature: "# Vheins\\Common\\Models"
		},
		// Markdown heading (doc-only) — references a module path.
		{
			repo: "test-repo",
			file_path: "docs/modules.md",
			name: "modules/Common",
			kind: "heading2",
			exported: false,
			start_line: 5,
			signature: "## modules/Common"
		},
		// Real source symbol that the heading references.
		{
			repo: "test-repo",
			file_path: "modules/Common/Models/User.php",
			name: "User",
			kind: "class",
			exported: true,
			start_line: 1,
			doc_comment: "Vheins\\Common\\Models user entity"
		},
		// Plain source symbol (no doc involvement).
		{
			repo: "test-repo",
			file_path: "src/core.ts",
			name: "createUser",
			kind: "function",
			exported: true,
			start_line: 10,
			doc_comment: "Creates a new user"
		}
	]);

	// File records so the scope counts are non-zero and deterministic.
	store.codebaseFiles.upsertFile({ repo: "test-repo", file_path: "docs/models.md", language: "markdown", lines: 10 });
	store.codebaseFiles.upsertFile({ repo: "test-repo", file_path: "docs/modules.md", language: "markdown", lines: 8 });
	store.codebaseFiles.upsertFile({
		repo: "test-repo",
		file_path: "modules/Common/Models/User.php",
		language: "php",
		lines: 30
	});
	store.codebaseFiles.upsertFile({ repo: "test-repo", file_path: "src/core.ts", language: "typescript", lines: 40 });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("handleCodebaseRead SEARCH — matchKind / related / scope (issue #81)", () => {
	let store: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		store = await createTestStore();
		vectors = noopVectorStore();
		seed(store);
	});

	afterEach(() => {
		store.close();
	});

	it('(a) Markdown heading results carry matchKind "documentation"', async () => {
		const response = await handleCodebaseRead(
			{ query: "Models", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		const heading = symbols.find((s) => s.kind === "heading1" || s.kind === "heading2" || s.kind === "heading");
		expect(heading).toBeDefined();
		expect(heading!.matchKind).toBe("documentation");
	});

	it('(b) real source symbols carry matchKind "source"', async () => {
		const response = await handleCodebaseRead(
			{ query: "createUser", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const symbols = data.symbols as Array<Record<string, unknown>>;

		expect(symbols.length).toBeGreaterThanOrEqual(1);
		for (const s of symbols) {
			expect(s.matchKind).toBe("source");
		}
	});

	it("(c) doc heading referencing a source path token surfaces related source results with relatedTo", async () => {
		// "Models" matches the heading (Vheins\Common\Models) via FTS, and the
		// heading's extracted token lookup finds the User class in
		// modules/Common/Models/User.php.
		const response = await handleCodebaseRead(
			{ query: "Models", repo: "test-repo", owner: "vheins", json: true },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;
		const related = data.related as Array<Record<string, unknown>>;

		expect(related.length).toBeGreaterThanOrEqual(1);
		const sourceRel = related.find((r) => r.matchKind === "source");
		expect(sourceRel).toBeDefined();
		expect(sourceRel!.relatedTo).toBe("Vheins\\Common\\Models");
		expect(sourceRel!.file_path).toContain("modules/Common/Models/User.php");
		expect(sourceRel!.name).toBe("User");
	});

	it("(d) SEARCH envelope exposes repoRoot and a scope count (files/symbols) for the repo", async () => {
		const response = await handleCodebaseRead(
			{ query: "Models", repo: "test-repo", owner: "vheins", json: true, repoPath: "/abs/path/to/test-repo" },
			store,
			vectors
		);
		const data = response.structuredContent as Record<string, unknown>;

		expect(data.repoRoot).toBe("/abs/path/to/test-repo");
		const scope = data.scope as Record<string, { files: number; symbols: number }>;
		expect(scope["test-repo"]).toBeDefined();
		expect(scope["test-repo"].files).toBe(4);
		expect(scope["test-repo"].symbols).toBe(4);
	});
});
