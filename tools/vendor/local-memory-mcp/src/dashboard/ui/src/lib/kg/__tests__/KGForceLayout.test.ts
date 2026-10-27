import { describe, expect, it } from "vitest";
import {
	DEFAULT_ZERO_EDGE_VISIBLE_NODE_LIMIT,
	initializeZeroEdgeOverviewLayout,
	runForceLayout,
	type LayoutNode
} from "../KGForceLayout";

function buildNodes(count: number): LayoutNode[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `node-${index}`,
		name: `Node ${index}`,
		type: "concept",
		x: 0,
		y: 0,
		z: 0,
		vx: 0,
		vy: 0,
		pinned: false
	}));
}

describe("initializeZeroEdgeOverviewLayout", () => {
	it("returns visible positioned nodes when graph has nodes and no edges", () => {
		const layoutNodes = initializeZeroEdgeOverviewLayout(buildNodes(12), 640, 360);

		expect(layoutNodes).toHaveLength(12);
		expect(layoutNodes.every((node) => node.x > 0 && node.y > 0)).toBe(true);
		expect(new Set(layoutNodes.map((node) => `${node.x}:${node.y}`)).size).toBeGreaterThan(1);
	});

	it("caps zero-edge overview nodes and keeps overflow deterministic", () => {
		const totalNodes = DEFAULT_ZERO_EDGE_VISIBLE_NODE_LIMIT + 7;
		const layoutNodes = initializeZeroEdgeOverviewLayout(buildNodes(totalNodes), 640, 360);

		expect(layoutNodes).toHaveLength(DEFAULT_ZERO_EDGE_VISIBLE_NODE_LIMIT);
		expect(totalNodes - layoutNodes.length).toBe(7);
		expect(layoutNodes.at(-1)?.id).toBe(`node-${DEFAULT_ZERO_EDGE_VISIBLE_NODE_LIMIT - 1}`);
	});

	it("falls back to safe deterministic coordinates for narrow or short canvas sizes", () => {
		const layoutNodes = initializeZeroEdgeOverviewLayout(buildNodes(3), 0, 1);

		expect(layoutNodes).toHaveLength(3);
		expect(layoutNodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
		expect(layoutNodes.every((node) => node.x >= 18 && node.y >= 18)).toBe(true);
	});

	it("still supports connected force layouts", () => {
		const nodes = buildNodes(2);
		nodes[0].x = 100;
		nodes[0].y = 100;
		nodes[1].x = 300;
		nodes[1].y = 300;

		const result = runForceLayout(nodes, [{ source: "node-0", target: "node-1", relation_type: "related" }], 500, 400, {
			iterations: 1
		});

		expect(result).toHaveLength(2);
		expect(result.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
	});
});
