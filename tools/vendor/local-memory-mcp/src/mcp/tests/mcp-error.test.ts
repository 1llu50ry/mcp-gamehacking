import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMcpErrorResponse, formatZodError, parseArgs, ToolError, toErrorResponse } from "../utils/mcp-error";

const ScopeSchema = z.object({
	owner: z.string().min(1, "owner is required — provide it explicitly or configure MCP workspace roots"),
	repo: z.string().min(1)
});
const SimpleSchema = z.object({ name: z.string().min(3) });

describe("mcp-error — canonical error envelope (OPT-CODE-01)", () => {
	it("creates a machine-readable error envelope", () => {
		const res = createMcpErrorResponse({
			code: "PATH_NOT_FOUND",
			message: "Repository path not found",
			retryable: false,
			details: { field: "repoPath" }
		});

		expect(res.isError).toBe(true);
		expect(res.content).toEqual([{ type: "text", text: "Repository path not found" }]);
		expect(res.structuredContent).toEqual({
			field: "repoPath",
			schema: "tool-error",
			code: "PATH_NOT_FOUND",
			message: "Repository path not found",
			retryable: false,
			error: "Repository path not found",
			details: { field: "repoPath" }
		});
	});

	it("preserves typed expected failures", () => {
		const res = toErrorResponse(
			new ToolError("TASK_NOT_FOUND", "Task not found: abc", { retryable: false, details: { task: "abc" } })
		);
		expect(res.isError).toBe(true);
		expect(res.content?.[0]).toEqual({ type: "text", text: "Task not found: abc" });
		expect(res.structuredContent).toMatchObject({
			schema: "tool-error",
			code: "TASK_NOT_FOUND",
			retryable: false,
			details: { task: "abc" }
		});
	});

	it("sanitizes unknown Error messages", () => {
		const res = toErrorResponse(new Error("SQLITE failure at /private/secret.db"));
		expect(res.isError).toBe(true);
		expect(res.content?.[0]).toEqual({ type: "text", text: "Internal tool error" });
		expect(res.structuredContent).toEqual({
			schema: "tool-error",
			code: "INTERNAL_ERROR",
			message: "Internal tool error",
			retryable: false,
			error: "Internal tool error"
		});
		expect(JSON.stringify(res)).not.toContain("secret.db");
	});

	it("sanitizes non-Error values", () => {
		const res = toErrorResponse("boom /private/path");
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ code: "INTERNAL_ERROR" });
		expect(JSON.stringify(res)).not.toContain("private/path");
	});

	describe("classifyExpectedError — per-condition codes (FIX-ERRCLASS)", () => {
		it("positive: task state-machine transition violation maps to VALIDATION_ERROR with the real message", () => {
			const message = "Cannot transition from 'backlog' directly to 'completed'. Must go through 'in_progress' first.";
			const res = toErrorResponse(new Error(message));
			expect(res.isError).toBe(true);
			expect(res.content?.[0]).toEqual({ type: "text", text: message });
			expect(res.structuredContent).toMatchObject({
				schema: "tool-error",
				code: "VALIDATION_ERROR",
				retryable: false,
				message
			});
		});

		it("positive: incomplete-children completion gate maps to VALIDATION_ERROR with the real message", () => {
			const message =
				'Cannot complete task [TASK-1] "Parent" — it has 1 incomplete child task(s). Complete the following child task(s) first: [TASK-2] Child (pending)';
			const res = toErrorResponse(new Error(message));
			expect(res.structuredContent).toMatchObject({
				schema: "tool-error",
				code: "VALIDATION_ERROR",
				retryable: false,
				message
			});
		});

		it("positive: transient SQLite lock contention keeps the real message and is retryable", () => {
			const res = toErrorResponse(new Error("database is locked"));
			expect(res.isError).toBe(true);
			expect(res.content?.[0]).toEqual({ type: "text", text: "database is locked" });
			expect(res.structuredContent).toMatchObject({
				schema: "tool-error",
				code: "INTERNAL_ERROR",
				retryable: true,
				message: "database is locked"
			});
		});

		it("positive: SQLITE_BUSY code text is treated as transient", () => {
			const res = toErrorResponse(new Error("SqliteError: SQLITE_BUSY"));
			expect(res.structuredContent).toMatchObject({ code: "INTERNAL_ERROR", retryable: true });
		});

		// FIX-020: a SQLite constraint violation is a caller-actionable
		// request-shape failure — it must surface the real message + the raw
		// constraint code, not the opaque "Internal tool error".
		it("positive: SQLITE_CONSTRAINT_NOTNULL maps to VALIDATION_ERROR with the real message + constraint code", () => {
			const err = new Error("NOT NULL constraint failed: memories.importance") as Error & { code: string };
			err.code = "SQLITE_CONSTRAINT_NOTNULL";
			const res = toErrorResponse(err);
			expect(res.isError).toBe(true);
			expect(res.content?.[0]).toEqual({ type: "text", text: "NOT NULL constraint failed: memories.importance" });
			expect(res.structuredContent).toMatchObject({
				schema: "tool-error",
				code: "VALIDATION_ERROR",
				retryable: false,
				message: "NOT NULL constraint failed: memories.importance",
				details: { constraint: "SQLITE_CONSTRAINT_NOTNULL" }
			});
		});

		it("positive: SQLITE_CONSTRAINT_CHECK maps to VALIDATION_ERROR with the constraint code", () => {
			const err = new Error("CHECK constraint failed: importance BETWEEN 1 AND 5") as Error & { code: string };
			err.code = "SQLITE_CONSTRAINT_CHECK";
			const res = toErrorResponse(err);
			expect(res.structuredContent).toMatchObject({
				code: "VALIDATION_ERROR",
				retryable: false,
				details: { constraint: "SQLITE_CONSTRAINT_CHECK" }
			});
		});

		it("positive: a 'constraint failed' message without a code is still surfaced as VALIDATION_ERROR", () => {
			const res = toErrorResponse(new Error("UNIQUE constraint failed: memories.code"));
			expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR", retryable: false });
			expect((res.structuredContent as Record<string, unknown>).details).toBeUndefined();
		});

		it("negative: an unrelated unexpected error still maps to the generic non-retryable INTERNAL_ERROR", () => {
			const res = toErrorResponse(new Error("segmentation fault in widget parser"));
			expect(res.isError).toBe(true);
			expect(res.content?.[0]).toEqual({ type: "text", text: "Internal tool error" });
			expect(res.structuredContent).toEqual({
				schema: "tool-error",
				code: "INTERNAL_ERROR",
				message: "Internal tool error",
				retryable: false,
				error: "Internal tool error"
			});
		});

		// issue #108 (bug 5 — similar-pattern audit): request-shape and
		// capability failures that previously fell through to the opaque
		// INTERNAL_ERROR now surface their real message under a stable code.
		it("positive: 'Could not infer operation' maps to VALIDATION_ERROR with the real message", () => {
			const message = "Could not infer operation. Provide:\n  - `phase` + `title` + `description` for CREATE";
			const res = toErrorResponse(new Error(message));
			expect(res.structuredContent).toMatchObject({
				code: "VALIDATION_ERROR",
				message,
				retryable: false
			});
		});

		it("positive: 'CLAIM requires agent' maps to VALIDATION_ERROR", () => {
			const message =
				"CLAIM requires agent. Combine task_id/task_code with agent for CLAIM, or add release:true for RELEASE";
			const res = toErrorResponse(new Error(message));
			expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR", message });
		});

		// FIX-CLAIM-AGENT-INJECT: claim-manage RELEASE raises
		// "No active claim found for task X" when the UPDATE matches no row.
		// The reversed word order missed the `\bnot found\b` test and fell
		// through to the opaque "Internal tool error".
		it("positive: 'No active claim found' maps to NOT_FOUND with the real message", () => {
			const message = "No active claim found for task FEAT-PO-QTY-BE";
			const res = toErrorResponse(new Error(message));
			expect(res.isError).toBe(true);
			expect(res.content?.[0]).toEqual({ type: "text", text: message });
			expect(res.structuredContent).toMatchObject({
				schema: "tool-error",
				code: "NOT_FOUND",
				message,
				retryable: false
			});
		});

		it("negative: a genuine server fault still maps to the generic INTERNAL_ERROR", () => {
			const res = toErrorResponse(new Error("segmentation fault in widget parser"));
			expect(res.structuredContent).toMatchObject({ code: "INTERNAL_ERROR", message: "Internal tool error" });
		});

		it("positive: 'status is not valid for CREATE' maps to VALIDATION_ERROR", () => {
			const res = toErrorResponse(new Error("status is not valid for CREATE — use id + status for UPDATE"));
			expect(res.structuredContent).toMatchObject({
				code: "VALIDATION_ERROR",
				message: "status is not valid for CREATE — use id + status for UPDATE"
			});
		});

		it("positive: 'Repository mismatch' maps to VALIDATION_ERROR", () => {
			const res = toErrorResponse(new Error('Repository mismatch: provided repo "a" does not match memory repo "b"'));
			expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR" });
		});

		it("positive: plural 'owner and repo are required' maps to VALIDATION_ERROR", () => {
			const res = toErrorResponse(
				new Error("owner and repo are required for listing — provide them explicitly or configure MCP workspace roots")
			);
			expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR" });
		});

		it("positive: \"neither 'id' nor 'code' resolved\" maps to VALIDATION_ERROR", () => {
			const res = toErrorResponse(new Error("Cannot update: neither 'id' nor 'code' resolved to an existing task"));
			expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR" });
		});

		it("positive: 'Handoffs must identify' maps to VALIDATION_ERROR", () => {
			const res = toErrorResponse(
				new Error(
					"Handoffs must identify a target agent, linked task, next_steps, blockers, or remaining_work. Do not create pending handoffs for completed-work summaries."
				)
			);
			expect(res.structuredContent).toMatchObject({ code: "VALIDATION_ERROR" });
		});

		it("positive: client capability gap maps to CAPABILITY_UNAVAILABLE with the real message", () => {
			const message =
				"Client does not advertise MCP elicitation form support. Provide all required fields directly: phase, title, description.";
			const res = toErrorResponse(new Error(message));
			expect(res.structuredContent).toMatchObject({ code: "CAPABILITY_UNAVAILABLE", message, retryable: false });
		});

		it("positive: sampling non-answer is retryable and keeps the real message", () => {
			const res = toErrorResponse(new Error("Sampling did not return a final text answer"));
			expect(res.structuredContent).toMatchObject({
				code: "INTERNAL_ERROR",
				retryable: true,
				message: "Sampling did not return a final text answer"
			});
		});
	});

	it("formats Zod failures with the friendly Missing required fields text for owner/repo", () => {
		const result = ScopeSchema.safeParse({});
		expect(result.success).toBe(false);
		if (!result.success) {
			const text = formatZodError(result.error);
			expect(text).toContain("Missing required fields");
			// FIX-110-A: the message must ENUMERATE concrete options for
			// roots-less clients, not just "configure MCP workspace roots".
			expect(text).toContain("pass owner/repo explicitly");
			expect(text).toContain("configure MCP workspace roots");
			expect(text).toContain("LOCAL_MEMORY_DEFAULT_OWNER and LOCAL_MEMORY_DEFAULT_REPO");
			expect(text).toContain('GITHUB_REPOSITORY="owner/repo"');
			expect(text).toContain("WorkingDirectory");
		}
	});

	it("falls back to generic Validation error text for non-owner/repo issues", () => {
		const result = SimpleSchema.safeParse({ name: "" });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(formatZodError(result.error)).toContain("Validation error");
		}
	});

	it("toErrorResponse wraps a ZodError with the validation code", () => {
		const result = ScopeSchema.safeParse({});
		if (!result.success) {
			const res = toErrorResponse(result.error);
			expect(res.isError).toBe(true);
			expect(res.content?.[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining("Missing required fields") as unknown
			});
			expect(res.structuredContent).toMatchObject({
				schema: "tool-error",
				code: "VALIDATION_ERROR",
				retryable: false
			});
		}
	});

	it("parseArgs returns typed data on success", () => {
		const data = parseArgs(SimpleSchema, { name: "okay" });
		expect(data.name).toBe("okay");
	});

	it("parseArgs throws on failure (transport catch turns it into an envelope)", () => {
		expect(() => parseArgs(SimpleSchema, { name: "" })).toThrowError(/Validation error/);
	});
});
