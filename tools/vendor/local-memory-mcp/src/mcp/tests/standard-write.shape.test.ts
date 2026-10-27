import { describe, it, expect, beforeEach } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleStandardWrite } from "../tools/standard.write";
import { diagnoseStandardWriteShape } from "../tools/standard-write";
import { toErrorResponse } from "../utils/mcp-error";
import { McpResponse } from "../utils/mcp-response";
import type { VectorStore } from "../types";

// ─── standard-write shape diagnosis (FIX-026) ─────────────────────────────
// The unified schema no longer rejects a mode mismatch with a single generic
// three-mode message. The handler now reports the DETECTED mode + the exact
// missing fields for it (task-write directive style). This suite covers both
// the pure detector and the end-to-end tool envelope.

describe("CSL — standard-write shape diagnosis (FIX-026)", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(() => {
		db = new SQLiteStore(":memory:");
		vectors = new StubVectorStore(db);
	});

	// ── Unit: diagnoseStandardWriteShape ──────────────────────────────────

	describe("diagnoseStandardWriteShape", () => {
		it("detects bulk when standards[] is present", () => {
			const result = diagnoseStandardWriteShape({
				json: false,
				standards: [{ name: "A", content: "content", tags: ["t"], metadata: { s: 1 } }]
			});
			expect(result).toEqual({ kind: "ok", mode: "bulk" });
		});

		it("detects update when id is present", () => {
			expect(diagnoseStandardWriteShape({ json: false, id: "abc" })).toEqual({ kind: "ok", mode: "update" });
		});

		it("detects update when code is present", () => {
			expect(diagnoseStandardWriteShape({ json: false, code: "STD-001" })).toEqual({
				kind: "ok",
				mode: "update"
			});
		});

		it("detects create when all four required fields are present", () => {
			const result = diagnoseStandardWriteShape({
				json: false,
				name: "Name",
				content: "content",
				tags: ["t"],
				metadata: { s: 1 }
			});
			expect(result).toEqual({ kind: "ok", mode: "create" });
		});

		it("negative: names the missing fields for a partial single-create", () => {
			const result = diagnoseStandardWriteShape({ json: false, name: "Only A Name" });
			expect(result.kind).toBe("invalid");
			if (result.kind === "invalid") {
				expect(result.message).toContain("Detected single-create");
				expect(result.message).toContain("'content'");
				expect(result.message).toContain("'tags'");
				expect(result.message).toContain("'metadata'");
				expect(result.message).toContain("required: name, content, tags, metadata");
			}
		});

		it("negative: singular grammar when exactly one field is missing", () => {
			const result = diagnoseStandardWriteShape({
				json: false,
				name: "Name",
				content: "content",
				tags: ["t"]
			});
			expect(result.kind).toBe("invalid");
			if (result.kind === "invalid") {
				expect(result.message).toContain("Detected single-create but 'metadata' is missing");
			}
		});

		it("negative: reports the empty-bulk shape explicitly", () => {
			const result = diagnoseStandardWriteShape({ json: false, standards: [] });
			expect(result.kind).toBe("invalid");
			if (result.kind === "invalid") {
				expect(result.message).toContain("Detected bulk-create");
				expect(result.message).toContain("standards[]");
			}
		});

		it("negative: falls back to the three-mode directive when no signal is present", () => {
			const result = diagnoseStandardWriteShape({ json: false });
			expect(result.kind).toBe("invalid");
			if (result.kind === "invalid") {
				expect(result.message).toContain("Could not infer operation");
				expect(result.message).toContain("standards[]");
			}
		});
	});

	// ── End-to-end: malformed payload surfaces the detected mode ──────────

	describe("handleStandardWrite — malformed payload envelope", () => {
		it("negative: partial single-create returns detected mode + missing fields as VALIDATION_ERROR", async () => {
			let thrown: unknown;
			try {
				await handleStandardWrite({ owner: "test", name: "Only Name Here" }, db, vectors);
			} catch (err) {
				thrown = err;
			}
			expect(thrown).toBeInstanceOf(Error);

			const res = toErrorResponse(thrown);
			expect(res.isError).toBe(true);
			expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
			const text = (res.content?.[0] as { text: string }).text;
			expect(text).toContain("Detected single-create");
			expect(text).toContain("required: name, content, tags, metadata");
			// The old generic three-mode message must NOT be the only feedback.
			expect(text).not.toContain("Provide 'standards[]' for bulk");
		});

		it("negative: name + content without tags/metadata names the two missing fields", async () => {
			await expect(
				handleStandardWrite(
					{ owner: "test", name: "Name Long Enough", content: "This content is long enough to pass." },
					db,
					vectors
				)
			).rejects.toThrow(/Detected single-create but 'tags', 'metadata' are missing/);
		});

		it("negative: no operational signal falls back to the three-mode directive", async () => {
			await expect(handleStandardWrite({ owner: "test" }, db, vectors)).rejects.toThrow(/Could not infer operation/);
		});
	});

	// ── Positive: valid payloads still succeed ────────────────────────────

	describe("handleStandardWrite — valid payloads unchanged", () => {
		it("positive: single CREATE succeeds", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					name: "Valid Create Standard",
					content: "This content is long enough to be valid.",
					tags: ["valid"],
					metadata: { source: "shape-test" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			expect(result.isError).toBe(false);
			expect((result.structuredContent as { success: boolean }).success).toBe(true);
		});

		it("positive: UPDATE succeeds", async () => {
			const created = (await handleStandardWrite(
				{
					owner: "test",
					name: "Updatable Standard",
					content: "Original content that is long enough.",
					tags: ["update"],
					metadata: { source: "shape-test" },
					json: true
				},
				db,
				vectors
			)) as McpResponse;
			const id = (created.structuredContent as { standard: { id: string } }).standard.id;

			const result = (await handleStandardWrite(
				{ owner: "test", id, tags: ["update", "changed"], json: true },
				db,
				vectors
			)) as McpResponse;

			expect(result.isError).toBe(false);
			expect((result.structuredContent as { success: boolean }).success).toBe(true);
		});

		it("positive: BULK CREATE succeeds", async () => {
			const result = (await handleStandardWrite(
				{
					owner: "test",
					repo: "shape-bulk-repo",
					standards: [
						{ name: "Bulk A", content: "Bulk content A long enough.", tags: ["b"], metadata: { s: 1 } },
						{ name: "Bulk B", content: "Bulk content B long enough.", tags: ["b"], metadata: { s: 2 } }
					],
					json: true
				},
				db,
				vectors
			)) as McpResponse;

			expect(result.isError).toBe(false);
			expect((result.structuredContent as { processed: number }).processed).toBe(2);
		});
	});
});
