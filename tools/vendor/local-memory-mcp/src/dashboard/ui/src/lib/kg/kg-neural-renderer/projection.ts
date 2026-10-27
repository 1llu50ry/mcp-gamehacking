/**
 * 3D → 2D projection pass with pooled record reuse.
 *
 * Records are reused from module-level pools (zero allocations per frame,
 * TASK-271): `projectedPool` holds one ProjectedNode per Node3D, the working
 * view is a re-sliced window over it, and `projByIndex` is a reused Map
 * (clear+set each frame) mapping original node index → projected record.
 */
import type { Node3D, ProjectedNode, RotationTrig } from "./layout";
import { project3D } from "./layout";

const projectedPool: ProjectedNode[] = [];
const projectedWorking: ProjectedNode[] = [];
const projByIndex = new Map<number, ProjectedNode>();

export interface CameraProjectionInput {
	rotY: number;
	rotX: number;
	effectiveFocalLength: number;
}

/**
 * Projects every node (sphere breathing applied around the canvas center) and
 * writes the screen coordinates back onto the original LayoutNode objects.
 * Returns the depth-UNSORTED working view; call `sortProjected()` afterwards.
 */
export function projectAllNodes(
	nodes3d: Node3D[],
	cx: number,
	cy: number,
	width: number,
	height: number,
	breathe: number,
	cam: CameraProjectionInput,
	frameTrig: RotationTrig
): ProjectedNode[] {
	for (let i = 0; i < nodes3d.length; i++) {
		const n3d = nodes3d[i];
		let rec = projectedPool[i];
		if (!rec) {
			rec = {} as ProjectedNode;
			projectedPool[i] = rec;
		}
		const bx = (n3d.x - cx) * breathe + cx;
		const by = (n3d.y - cy) * breathe + cy;
		const bz = n3d.z * breathe;
		const proj = project3D(
			bx - cx,
			by - cy,
			bz,
			width,
			height,
			cam.rotY,
			cam.rotX,
			cam.effectiveFocalLength,
			frameTrig
		);
		rec.sx = proj.sx;
		rec.sy = proj.sy;
		rec.z = proj.z;
		rec.scale = proj.scale;
		rec.depth = proj.depth;
		rec.node3d = n3d;
	}

	// View over the pool (no allocation).
	projectedWorking.length = nodes3d.length;
	for (let i = 0; i < nodes3d.length; i++) projectedWorking[i] = projectedPool[i];

	// Write projected screen coordinates back to the original LayoutNode objects
	for (const p of projectedWorking) {
		p.node3d.node.x = p.sx;
		p.node3d.node.y = p.sy;
	}

	return projectedWorking;
}

/** Depth sort (far to near) — in place over the pooled view. */
export function sortProjected(projected: ProjectedNode[]): void {
	projected.sort((a, b) => b.depth - a.depth);
}

/**
 * Builds the projected lookup by original node index. Map is REUSED across
 * frames (clear+set) instead of allocating a new Map every frame (TASK-271).
 */
export function rebuildProjIndex(projected: ProjectedNode[], nodeIndexById: Map<string, number>): void {
	projByIndex.clear();
	for (const p of projected) {
		const idx =
			(p.node3d.node.id ? nodeIndexById.get(p.node3d.node.id) : undefined) ?? nodeIndexById.get(p.node3d.node.name);
		if (idx !== undefined && idx >= 0) projByIndex.set(idx, p);
	}
}

/** Accessor for the per-frame projected lookup (filled by rebuildProjIndex). */
export function getProjByIndex(): Map<number, ProjectedNode> {
	return projByIndex;
}
