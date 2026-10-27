import { describe, it, expect } from "vitest";
import {
	createMcpResponse,
	createTextOnlyResponse,
	buildTableResult,
	withEnvelope,
	getPrimaryTextContent,
	isMcpResponse,
	McpContentSchema,
	type McpResponse
} from "../../utils/mcp-response";

describe("McpContentSchema", () => {
	it("accepts a valid text content item", () => {
		expect(McpContentSchema.safeParse({ type: "text", text: "hi" }).success).toBe(true);
	});

	it("accepts a valid image content item", () => {
		expect(McpContentSchema.safeParse({ type: "image", data: "base64...", mimeType: "image/png" }).success).toBe(true);
	});

	it("accepts a valid resource content item", () => {
		expect(McpContentSchema.safeParse({ type: "resource", resource: { uri: "file:///x" } }).success).toBe(true);
	});

	it("accepts valid annotations", () => {
		expect(
			McpContentSchema.safeParse({
				type: "text",
				text: "hi",
				annotations: { audience: ["user"], priority: 0.5, lastModified: "2026-01-01" }
			}).success
		).toBe(true);
	});

	it("rejects an unknown content type", () => {
		expect(McpContentSchema.safeParse({ type: "audio", data: "x" }).success).toBe(false);
	});

	it("rejects a text item missing the text field", () => {
		expect(McpContentSchema.safeParse({ type: "text" }).success).toBe(false);
	});

	it("rejects unknown annotation keys (strict schema)", () => {
		expect(McpContentSchema.safeParse({ type: "text", text: "hi", annotations: { extra: true } }).success).toBe(false);
	});

	it("rejects out-of-range annotation priority", () => {
		expect(McpContentSchema.safeParse({ type: "text", text: "hi", annotations: { priority: 1.5 } }).success).toBe(
			false
		);
	});
});

describe("createMcpResponse", () => {
	it("builds a text-only response with isError false and summary", () => {
		const response = createMcpResponse({ id: "1" }, "  summary text  ");
		expect(response.isError).toBe(false);
		expect(response.content).toEqual([{ type: "text", text: "summary text" }]);
		expect(response.structuredContent).toBeUndefined();
	});

	it("prefers contentSummary over summary", () => {
		const response = createMcpResponse({ id: "1" }, "summary", { contentSummary: "  richer  " });
		expect(response.content).toEqual([{ type: "text", text: "richer" }]);
	});

	it("includes structuredContent and a hint when includeJson is set", () => {
		const response = createMcpResponse([{ id: "1", title: "t" }], "found 1", {
			includeJson: true,
			structuredContentPathHint: "results"
		});
		expect(response.structuredContent).toEqual([{ id: "1", title: "t" }]);
		expect(response.content?.[0]).toEqual({
			type: "text",
			text: "found 1 Read structuredContent.results for details."
		});
	});

	it("omits the hint when structured data is empty", () => {
		const response = createMcpResponse([], "none", { includeJson: true });
		expect(response.content?.[0]).toEqual({ type: "text", text: "none" });
	});

	it("prunes operational metadata from array items", () => {
		const response = createMcpResponse([{ id: "1", hit_count: 5, recall_rate: 0.5, title: "t" }], "x", {
			includeJson: true
		});
		expect(response.structuredContent).toEqual([{ id: "1", title: "t" }]);
	});

	it("prunes known array keys inside object data", () => {
		const response = createMcpResponse({ query: "q", results: [{ id: "1", expires_at: "t", title: "t" }] }, "x", {
			includeJson: true
		});
		expect(response.structuredContent).toEqual({ query: "q", results: [{ id: "1", title: "t" }] });
	});

	it("prunes a plain object data value", () => {
		const response = createMcpResponse({ id: "1", model: "m", vector_version: 3, content: "c" }, "x", {
			includeJson: true
		});
		expect(response.structuredContent).toEqual({ id: "1", content: "c" });
	});

	it("does not mutate the caller's data object", () => {
		const data = { id: "1", hit_count: 9, title: "t" };
		createMcpResponse(data, "x", { includeJson: true });
		expect(data).toEqual({ id: "1", hit_count: 9, title: "t" });
	});

	it("keeps a concise non-empty text item when summaries are blank", () => {
		const response = createMcpResponse({ id: "1" }, "", { includeJson: true });
		expect(response.content).toEqual([
			{ type: "text", text: "Request completed. Read structuredContent for machine-readable results." }
		]);
	});
});

describe("createTextOnlyResponse", () => {
	it("wraps the text in content and structuredContent", () => {
		const response = createTextOnlyResponse("hello");
		expect(response.content).toEqual([{ type: "text", text: "hello" }]);
		expect(response.structuredContent).toEqual({ text: "hello" });
		expect(response.isError).toBe(false);
	});
});

describe("buildTableResult", () => {
	it("places columns/rows at the top level with a default count", () => {
		const result = buildTableResult(["id"], [["1"], ["2"]]);
		expect(result).toEqual({ columns: ["id"], rows: [["1"], ["2"]], count: 2 });
	});

	it("nests the table under key and merges schema, pagination and extra", () => {
		const result = buildTableResult(["id"], [["1"]], {
			schema: "task-read",
			mode: "list",
			key: "tasks",
			total: 10,
			offset: 5,
			limit: 5,
			count: 1,
			extra: { query: "q" }
		});
		expect(result).toEqual({
			schema: "task-read",
			mode: "list",
			query: "q",
			tasks: { columns: ["id"], rows: [["1"]] },
			count: 1,
			total: 10,
			offset: 5,
			limit: 5
		});
	});

	it("counts empty rows as 0", () => {
		const result = buildTableResult(["id"], []);
		expect(result.count).toBe(0);
	});

	it("copies the columns array but keeps rows by reference", () => {
		const columns = ["id"] as const;
		const rows = [["1"]];
		const result = buildTableResult(columns, rows);
		expect(result.columns).toEqual(["id"]);
		expect(result.columns).not.toBe(columns);
		expect(result.rows).toBe(rows);
	});
});

describe("withEnvelope", () => {
	it("adds stable discriminators without duplicating or renaming legacy fields", () => {
		const item = { id: "1", title: "kept-at-the-legacy-path" };
		const result = withEnvelope("memory-read", "detail", { memory: item, stats: { hitCount: 2 } });

		expect(result).toEqual({
			schema: "memory-read",
			mode: "detail",
			memory: item,
			stats: { hitCount: 2 }
		});
		expect(result).not.toHaveProperty("item");
	});
});

describe("getPrimaryTextContent", () => {
	it("returns the first text item's content", () => {
		const response = createMcpResponse({ id: "1" }, "primary");
		expect(getPrimaryTextContent(response)).toBe("primary");
	});

	it("returns an empty string when there is no text item", () => {
		const response: McpResponse = { content: [{ type: "image", data: "x", mimeType: "png" }] };
		expect(getPrimaryTextContent(response)).toBe("");
	});

	it("returns an empty string when content is missing", () => {
		expect(getPrimaryTextContent({ isError: false })).toBe("");
	});
});

describe("isMcpResponse", () => {
	it("recognizes a valid response shape", () => {
		expect(isMcpResponse({ content: [{ type: "text", text: "x" }], isError: false })).toBe(true);
	});

	it("recognizes an empty content array", () => {
		expect(isMcpResponse({ content: [] })).toBe(true);
	});

	it("rejects null and non-objects", () => {
		expect(isMcpResponse(null)).toBe(false);
		expect(isMcpResponse("x")).toBe(false);
		expect(isMcpResponse(42)).toBe(false);
	});

	it("rejects a response whose content is not an array", () => {
		expect(isMcpResponse({ content: "x" })).toBe(false);
	});

	it("rejects items without a string type", () => {
		expect(isMcpResponse({ content: [{ data: 1 }] })).toBe(false);
		expect(isMcpResponse({ content: [{ type: 42 }] })).toBe(false);
	});
});
