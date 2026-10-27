/**
 * Coarse uniform spatial grid for canvas hit-testing.
 *
 * Node screen positions mutate every frame (camera auto-rotation/breathing),
 * so the grid is rebuilt right after each projection pass and matches the
 * last rendered frame. UI hit-test handlers query candidates from the grid
 * instead of linearly scanning every node on each mousemove/click.
 *
 * Pooled grid buckets — the Map and bucket arrays are reused across frames so
 * the per-frame hit-test rebuild allocates zero objects (TASK-271).
 */
import type { LayoutNode } from "../KGForceLayout";
import { NODE_RADIUS } from "../KGForceLayout";

const HIT_GRID_CELL_SIZE = Math.ceil((NODE_RADIUS + 4) * 2); // ~2x max hit radius
const HIT_GRID_KEY_OFFSET = 32768;
const HIT_GRID_KEY_MULT = 65536;
let spatialGrid = new Map<number, LayoutNode[]>();
let spatialGridBuilt = false;

const gridBucketPool: LayoutNode[][] = [];
let gridBucketCount = 0;

export function rebuildSpatialGrid(nodes: LayoutNode[]): void {
	const grid = spatialGrid;
	grid.clear();
	gridBucketCount = 0;
	for (const n of nodes) {
		const cx = Math.floor(n.x / HIT_GRID_CELL_SIZE);
		const cy = Math.floor(n.y / HIT_GRID_CELL_SIZE);
		const key = (cx + HIT_GRID_KEY_OFFSET) * HIT_GRID_KEY_MULT + (cy + HIT_GRID_KEY_OFFSET);
		let bucket = grid.get(key);
		if (!bucket) {
			bucket = gridBucketPool[gridBucketCount];
			if (!bucket) {
				bucket = [];
				gridBucketPool[gridBucketCount] = bucket;
			}
			bucket.length = 0;
			grid.set(key, bucket);
			gridBucketCount++;
		}
		bucket.push(n);
	}
	spatialGrid = grid;
	spatialGridBuilt = true;
}

/**
 * Returns every node whose grid cell could contain it within `radius` of (x, y).
 * Callers must still perform the exact distance check (this is a candidate
 * pre-selection, not a hit test).
 */
export function queryNodeCandidates(x: number, y: number, radius: number): LayoutNode[] {
	const minCX = Math.floor((x - radius) / HIT_GRID_CELL_SIZE);
	const maxCX = Math.floor((x + radius) / HIT_GRID_CELL_SIZE);
	const minCY = Math.floor((y - radius) / HIT_GRID_CELL_SIZE);
	const maxCY = Math.floor((y + radius) / HIT_GRID_CELL_SIZE);
	const out: LayoutNode[] = [];
	for (let cy = minCY; cy <= maxCY; cy++) {
		for (let cx = minCX; cx <= maxCX; cx++) {
			const key = (cx + HIT_GRID_KEY_OFFSET) * HIT_GRID_KEY_MULT + (cy + HIT_GRID_KEY_OFFSET);
			const bucket = spatialGrid.get(key);
			if (bucket) {
				for (const n of bucket) out.push(n);
			}
		}
	}
	return out;
}

/** True once the spatial grid has been built at least once (animation running). */
export function isSpatialGridReady(): boolean {
	return spatialGridBuilt;
}
