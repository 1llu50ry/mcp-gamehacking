import { describe, it, expect } from "vitest";
import {
	renderGroupedSummary,
	enumOrderComparator,
	formatOutputLegend,
	type GroupedSummaryOptions
} from "../../utils/summary";

interface SampleItem {
	group: string;
	text: string;
}

function renderSample(items: SampleItem[], cap: number | ((key: string) => number) = 5): string {
	const options: GroupedSummaryOptions<SampleItem> = {
		items,
		getGroup: (item) => item.group,
		groupOrder: (a, b) => a.localeCompare(b),
		cap,
		formatGroupLabel: (key) => key.toUpperCase(),
		formatLine: (item, rank) => `${rank}. ${item.text}`,
		footer: "done"
	};
	return renderGroupedSummary(options);
}

describe("renderGroupedSummary", () => {
	it("groups items, sorts groups, renders headers, lines, blanks and footer", () => {
		// Rank is the GLOBAL 1-based item index, not a per-group index.
		const out = renderSample([
			{ group: "a", text: "one" },
			{ group: "b", text: "two" },
			{ group: "a", text: "three" }
		]);
		expect(out).toBe(["**A (2)**", "1. one", "3. three", "", "**B (1)**", "2. two", "", "done"].join("\n"));
	});

	it("caps visible lines per group and reports hidden count", () => {
		const out = renderSample(
			[
				{ group: "a", text: "one" },
				{ group: "a", text: "two" },
				{ group: "a", text: "three" }
			],
			2
		);
		expect(out).toContain("**A (3)**");
		expect(out).toContain("1. one");
		expect(out).toContain("2. two");
		expect(out).toContain("... +1 more in this group");
		expect(out).not.toContain("3. three");
	});

	it("supports a per-group cap function", () => {
		const out = renderSample(
			[
				{ group: "a", text: "1" },
				{ group: "a", text: "2" },
				{ group: "b", text: "3" },
				{ group: "b", text: "4" },
				{ group: "b", text: "5" }
			],
			(key) => (key === "a" ? 1 : 2)
		);
		expect(out).toContain("... +1 more in this group");
		expect(out).toContain("... +1 more in this group"); // a hides 1, b hides 1
		expect([...out.matchAll(/\.\.\. \+1 more in this group/g)].length).toBe(2);
	});

	it("renders only the footer for empty items", () => {
		expect(renderSample([])).toBe("done");
	});

	it("uses the raw key as label when no formatter is provided", () => {
		const out = renderGroupedSummary({
			items: [{ g: "x", t: "1" }],
			getGroup: (item: { g: string; t: string }) => item.g,
			groupOrder: (a, b) => a.localeCompare(b),
			formatLine: (item: { g: string; t: string }) => item.t,
			footer: "f"
		});
		expect(out).toContain("**x (1)**");
	});

	it("never renders more lines than the cap (boundary)", () => {
		const out = renderSample(
			Array.from({ length: 20 }, (_, i) => ({ group: "g", text: String(i) })),
			5
		);
		const visibleLines = [...out.matchAll(/^\d+\. \d+$/gm)].length;
		expect(visibleLines).toBe(5);
		expect(out).toContain("... +15 more in this group");
	});
});

describe("enumOrderComparator", () => {
	it("orders known keys by their position in the order list", () => {
		const cmp = enumOrderComparator(["active", "done"]);
		expect(cmp("active", "done")).toBeLessThan(0);
		expect(cmp("done", "active")).toBeGreaterThan(0);
		expect(cmp("active", "active")).toBe(0);
	});

	it("sorts unknown keys last, alphabetically among themselves", () => {
		const cmp = enumOrderComparator(["active", "done"]);
		expect(cmp("aa", "cc")).toBeLessThan(0); // both unknown → alphabetical
		expect(cmp("cc", "aa")).toBeGreaterThan(0);
	});

	it("orders a known key before an unknown key", () => {
		const cmp = enumOrderComparator(["active", "done"]);
		expect(cmp("done", "zzz")).toBeLessThan(0);
		expect(cmp("zzz", "done")).toBeGreaterThan(0);
	});
});

describe("formatOutputLegend (TASK-424)", () => {
	it("documents relevance-score semantics with a numeric cap", () => {
		expect(
			formatOutputLegend({ scoreLabel: "relevance score", scoreRange: "0.00–1.00", groupBy: "status", perGroupCap: 5 })
		).toBe("> [N] = relevance score (0.00–1.00) · grouped by status, ≤5 shown per group (+N more)");
	});

	it("documents importance semantics with an exception-describing cap", () => {
		expect(
			formatOutputLegend({
				scoreLabel: "importance",
				scoreRange: "1–5",
				groupBy: "type",
				perGroupCap: "5 (task_archive 2)"
			})
		).toBe("> [N] = importance (1–5) · grouped by type, ≤5 (task_archive 2) shown per group (+N more)");
	});

	it("uses the same template for both tools so [N] semantics stay consistent", () => {
		const taskLegend = formatOutputLegend({
			scoreLabel: "relevance score",
			scoreRange: "0.00–1.00",
			groupBy: "status",
			perGroupCap: 5
		});
		const memLegend = formatOutputLegend({
			scoreLabel: "importance",
			scoreRange: "1–5",
			groupBy: "type",
			perGroupCap: "5 (task_archive 2)"
		});
		// Both start with the documented [N] marker and end with the same
		// per-group cap + overflow-marker phrasing — the contract consumers rely on.
		expect(taskLegend.startsWith("> [N] =")).toBe(true);
		expect(memLegend.startsWith("> [N] =")).toBe(true);
		expect(taskLegend.endsWith("shown per group (+N more)")).toBe(true);
		expect(memLegend.endsWith("shown per group (+N more)")).toBe(true);
	});
});
