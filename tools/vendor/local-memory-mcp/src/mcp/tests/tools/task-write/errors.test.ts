import { describe, it, expect } from "vitest";
import type { Task } from "../../../types";
import {
	duplicateCodeMessage,
	invalidIdFormatMessage,
	looksLikeTaskCode,
	missingCreateFields,
	missingCreateFieldsMessage,
	noUpdatableFieldsMessage,
	scopeBulkItemError
} from "../../../tools/task-write/errors";
import { describeBulkItem } from "../../../tools/task-write/bulk-infer";
import { toErrorResponse } from "../../../utils/mcp-error";

// FIX-027 — unit coverage for the caller-actionable task-write error builders.
// Mirrors src/mcp/tools/task-write/errors.ts per .agents/documents/testing.md §2.1.
// Every message keeps the leading directive token that classifyExpectedError
// (utils/mcp-error.ts) maps to a stable VALIDATION_ERROR/CONFLICT code.

const UUID = "d8597488-f19c-4958-96b9-1dee148f2e91";

describe("task-write errors — looksLikeTaskCode", () => {
	it("positive: recognises short task codes (single hyphen, letter-led)", () => {
		expect(looksLikeTaskCode("TASK-431")).toBe(true);
		expect(looksLikeTaskCode("FIX-027")).toBe(true);
		expect(looksLikeTaskCode("BULK-001")).toBe(true);
	});

	it("negative: a UUID, a placeholder token, a bare word and a non-string do NOT match", () => {
		expect(looksLikeTaskCode(UUID)).toBe(false);
		expect(looksLikeTaskCode("T01")).toBe(false);
		expect(looksLikeTaskCode("abc123")).toBe(false);
		expect(looksLikeTaskCode(431)).toBe(false);
		expect(looksLikeTaskCode(undefined)).toBe(false);
	});
});

describe("task-write errors — missingCreateFields", () => {
	it("positive: returns [] when phase/title/description are all present", () => {
		expect(missingCreateFields({ phase: "p", title: "t", description: "d" })).toEqual([]);
	});

	it("negative: lists exactly the absent fields, in canonical order", () => {
		expect(missingCreateFields({ phase: "p" })).toEqual(["title", "description"]);
		expect(missingCreateFields({ title: "t" })).toEqual(["phase", "description"]);
		expect(missingCreateFields({})).toEqual(["phase", "title", "description"]);
	});
});

describe("task-write errors — missingCreateFieldsMessage", () => {
	it("positive: bulk message names the exact absent fields and the tasks[] retry shape", () => {
		const msg = missingCreateFieldsMessage(["title", "description"], "bulk");
		expect(msg).toContain("Missing required fields for create — missing: title, description.");
		expect(msg).toContain('retry with tasks: [{ phase: "...", title: "...", description: "..." }]');
	});

	it("negative: single message names the absent field and the single-write retry shape", () => {
		const msg = missingCreateFieldsMessage(["title"], "single");
		expect(msg).toContain("Missing required fields for single task creation — missing: title.");
		expect(msg).toContain('task-write(phase: "...", title: "...", description: "...")');
	});
});

describe("task-write errors — noUpdatableFieldsMessage", () => {
	it("positive: lists the fields an update item may carry", () => {
		const msg = noUpdatableFieldsMessage(["phase", "title", "status"]);
		expect(msg).toContain("No updatable fields provided for update item.");
		expect(msg).toContain("Provide at least one of: phase, title, status.");
	});

	it("negative: does NOT claim a field list when none are offered", () => {
		const msg = noUpdatableFieldsMessage([]);
		expect(msg).toContain("No updatable fields provided for update item.");
		expect(msg).not.toContain("Provide at least one of: .");
	});
});

describe("task-write errors — invalidIdFormatMessage (id-vs-code hint)", () => {
	it("positive: a short code in the id slot yields the use-'code' hint", () => {
		const msg = invalidIdFormatMessage("TASK-431");
		expect(msg).toContain("'TASK-431' looks like a task code; use 'code' instead of 'id'.");
		expect(msg).toContain('task-write(code: "TASK-431", ...)');
	});

	it("negative: a non-code value keeps the generic invalid-id guidance (no false hint)", () => {
		const msg = invalidIdFormatMessage("abc123");
		expect(msg).toContain("Invalid id format: 'abc123'.");
		expect(msg).not.toContain("looks like a task code");
	});

	it("both branches classify as VALIDATION_ERROR", () => {
		for (const value of ["TASK-431", "abc123"]) {
			const env = toErrorResponse(new Error(invalidIdFormatMessage(value)));
			expect(env.structuredContent).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
		}
	});
});

describe("task-write errors — duplicateCodeMessage", () => {
	it("positive: names the existing task id + status and the update-instead-of-create retry", () => {
		const existing = { id: UUID, status: "backlog" } as Task;
		const msg = duplicateCodeMessage("TASK-463", existing);
		expect(msg).toContain("Task code 'TASK-463' already exists");
		expect(msg).toContain(`(existing task id "${UUID}", status "backlog")`);
		expect(msg).toContain('update instead of create: task-write(code: "TASK-463", ...)');
	});

	it("negative: without an existing task it still names the code and the retry shape", () => {
		const msg = duplicateCodeMessage("TASK-463", null);
		expect(msg).toContain("Task code 'TASK-463' already exists.");
		expect(msg).toContain('task-write(code: "TASK-463", ...)');
		expect(msg).not.toContain("existing task id");
	});

	it("classifies as CONFLICT", () => {
		const env = toErrorResponse(new Error(duplicateCodeMessage("TASK-463", null)));
		expect(env.structuredContent).toMatchObject({ code: "CONFLICT" });
	});
});

describe("task-write errors — describeBulkItem + scopeBulkItemError", () => {
	it("positive: prefers the item code, then id, then a positional fallback", () => {
		expect(describeBulkItem({ code: "TASK-431" }, 2)).toBe("[TASK-431]");
		expect(describeBulkItem({ task_code: "TASK-432" }, 3)).toBe("[TASK-432]");
		expect(describeBulkItem({ id: UUID }, 1)).toBe(`[id ${UUID}]`);
		expect(describeBulkItem({}, 4)).toBe("#4");
	});

	it("negative: scoping appends the item label and preserves the leading directive", () => {
		const scoped = scopeBulkItemError("Missing required fields for create — missing: title.", "[BAD-1]");
		expect(scoped).toBe("Missing required fields for create — missing: title. — item [BAD-1]");
		expect(scoped.startsWith("Missing")).toBe(true);
	});
});
