import { describe, it, expect } from "vitest";
import { createMcpResponse, getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Spec Compliance", () => {
	it("should return content, structuredContent, and not data", () => {
		const mockData = { id: "mem_1", title: "Test" };
		const response = createMcpResponse(mockData, "Summary", { includeJson: true });

		expect(response).toHaveProperty("content");
		expect(getPrimaryTextContent(response)).toBe("Summary Read structuredContent for machine-readable results.");
		expect(response).toHaveProperty("structuredContent");
		expect(response).not.toHaveProperty("data");
		expect(response.isError).toBe(false);
	});

	it("should prune metadata in structuredContent", () => {
		const mockData = {
			id: "mem_1",
			title: "Test",
			agent: "test-agent",
			model: "test-model",
			hit_count: 10
		};
		const response = createMcpResponse(mockData, "Summary", { includeJson: true });
		const sc = response.structuredContent as any;

		expect(sc.id).toBe("mem_1");
		expect(sc.title).toBe("Test");
		expect(sc.agent).toBe("test-agent");
		expect(sc.model).toBeUndefined();
		expect(sc.hit_count).toBeUndefined();
		expect(sc._summary).toBeUndefined();
	});

	it("should handle nested arrays in structuredContent", () => {
		const mockData = {
			results: [
				{ id: "1", agent: "a" },
				{ id: "2", model: "m" }
			]
		};
		const response = createMcpResponse(mockData, "Summary", { includeJson: true });
		const sc = response.structuredContent as any;

		expect(sc.results[0].id).toBe("1");
		expect(sc.results[0].agent).toBe("a");
		expect(sc.results[1].id).toBe("2");
		expect(sc.results[1].model).toBeUndefined();
	});

	it("should include a text content entry for text-only responses", () => {
		const response = createMcpResponse({ ok: true }, "Completed", {
			includeJson: true
		});

		expect(getPrimaryTextContent(response)).toBe("Completed Read structuredContent for machine-readable results.");
	});

	it("should support structured content path hints in summary text", () => {
		const response = createMcpResponse({ results: [{ id: "1" }] }, "Found 1 memory.", {
			structuredContentPathHint: "results",
			includeJson: true
		});

		expect(getPrimaryTextContent(response)).toBe("Found 1 memory. Read structuredContent.results for details.");
	});

	it("should NOT include redundant JSON string in content - agent must read structuredContent", () => {
		const response = createMcpResponse({ id: "mem_1", title: "Test" }, "Summary", {
			includeJson: true
		});
		const textItems = response.content?.filter((item) => item.type === "text") ?? [];

		expect(textItems).toHaveLength(1);
		expect((textItems[0] as Record<string, unknown>).text).toBe(
			"Summary Read structuredContent for machine-readable results."
		);
		expect(response.structuredContent).toEqual({ id: "mem_1", title: "Test" });
	});
});
