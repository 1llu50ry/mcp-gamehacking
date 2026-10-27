import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleStandardWrite } from "../tools/standard.write";
import { McpResponse } from "../utils/mcp-response";
import type { VectorStore } from "../types";

describe("CSL (Coding Standards Library) — standard-write", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(() => {
		db = new SQLiteStore(":memory:");
		vectors = new StubVectorStore(db);
	});

	// =========================================================================
	// standard-write — CREATE mode
	// =========================================================================

	describe("standard-write — create", () => {
		it("persists a coding standard and requires tags plus metadata", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					name: "Error Handling Best Practices",
					content: "Always use try-catch blocks for async operations. Handle errors gracefully and log them.",
					language: "typescript",
					stack: ["node", "express"],
					version: "1.0.0",
					context: "error-handling",
					tags: ["backend", "errors"],
					metadata: { source: "internal-docs", owner: "platform" },
					agent: "test-agent",
					model: "gpt-4",
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			expect(result.isError).toBe(false);
			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.standard.title).toBe("Error Handling Best Practices");

			// Verify full entry persisted in DB
			const entry = db.standards.getByCode(data.standard.code, "test");
			expect(entry).not.toBeNull();
			expect(entry!.language).toBe("typescript");
			expect(entry!.stack).toContain("node");
			expect(entry!.tags).toContain("backend");
			expect(entry!.metadata.source).toBe("internal-docs");
		});

		it("rejects missing required tags and metadata", async () => {
			await expect(
				handleStandardWrite(
					{
						owner: "test",
						name: "React Hooks Rule",
						content: "Use hooks consistently and never call them conditionally."
					},
					db,
					vectors
				)
			).rejects.toThrow();
		});

		it("stores standards with repo-specific scope by default", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					repo: "test-repo",
					name: "React Hooks Standard",
					content: "Use hooks for state management. Never call hooks conditionally.",
					language: "typescript",
					stack: ["react"],
					tags: ["react", "hooks"],
					metadata: { source: "styleguide" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			const entry = db.standards.getByCode(data.standard.code, "test");
			expect(entry?.is_global).toBe(false);
		});

		it("stores child standards linked to a parent", async () => {
			const parent = (await handleStandardWrite(
				{
					owner: "test",
					name: "React Hooks",
					content: "Follow hook rules consistently.",
					tags: ["react", "hooks"],
					metadata: { source: "react-docs" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const parentId = (parent.structuredContent as any).standard.id;
			const child = (await handleStandardWrite(
				{
					owner: "test",
					name: "React Hooks Cleanup",
					content: "Always clean up subscriptions in effects.",
					parent_id: parentId,
					tags: ["react", "hooks", "effects"],
					metadata: { source: "react-docs" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const childEntryId = (child.structuredContent as any).standard.id;
			const childEntry = db.standards.getById(childEntryId);
			expect(childEntry?.parent_id).toBe(parentId);
		});
	});

	// =========================================================================
	// standard-write — UPDATE mode
	// =========================================================================

	describe("standard-write — update", () => {
		it("updates standard fields and keeps vectors in sync", async () => {
			const stored = (await handleStandardWrite(
				{
					owner: "test",
					name: "Node Error Handling",
					content: "Use try-catch with logging.",
					language: "typescript",
					stack: ["node"],
					tags: ["node", "errors"],
					metadata: { source: "guide-v1" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const standardId = (stored.structuredContent as any).standard.id;
			const result = (await handleStandardWrite(
				{
					id: standardId,
					owner: "test",
					repo: "test-repo",
					content: "Use typed errors, try-catch, and structured logging.",
					tags: ["node", "errors", "logging"],
					metadata: { source: "guide-v2", changed_by: "qa" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.updatedFields).toContain("content");
			expect(db.standards.getById(standardId)?.metadata.source).toBe("guide-v2");
			expect(db.standards.getById(standardId)?.tags).toContain("logging");
		});

		it("updates parent linkage", async () => {
			const parent = (await handleStandardWrite(
				{
					owner: "test",
					name: "Parent Standard",
					content: "Parent guidance.",
					tags: ["architecture"],
					metadata: { source: "guide" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;
			const child = (await handleStandardWrite(
				{
					owner: "test",
					name: "Child Standard",
					content: "Child guidance.",
					tags: ["architecture", "child"],
					metadata: { source: "guide" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const parentId = (parent.structuredContent as any).standard.id;
			const childId = (child.structuredContent as any).standard.id;
			await handleStandardWrite(
				{ id: childId, parent_id: parentId, owner: "test", repo: "test-repo", json: true },
				db,
				vectors
			);

			expect(db.standards.getById(childId)?.parent_id).toBe(parentId);
		});
	});

	// =========================================================================
	// standard-write — BULK mode
	// =========================================================================

	describe("standard-write — bulk", () => {
		it("creates multiple standards in a single bulk call", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					repo: "bulk-repo",
					standards: [
						{
							name: "Bulk Standard A",
							content: "Content for standard A.",
							tags: ["bulk"],
							metadata: { source: "bulk-test" }
						},
						{
							name: "Bulk Standard B",
							content: "Content for standard B.",
							tags: ["bulk"],
							metadata: { source: "bulk-test" }
						}
					],
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			const data = result.structuredContent as any;
			expect(data.success).toBe(true);
			expect(data.total).toBe(2);
			expect(data.processed).toBe(2);

			// Verify persisted
			const all = db.standards.search({ repo: "bulk-repo", limit: 10, offset: 0 });
			expect(all).toHaveLength(2);
		});
	});
});
