/**
 * Trail and effects drawing for handoff animations.
 */

import type { HandoffVehicle } from "../arenaTypes";

// ── Rolling wheel SFX ────────────────────────────────────────────────────
export function drawRollingSFX(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	wheelAngle: number,
	vehicle: HandoffVehicle,
	isDark: boolean,
	ts: number
) {
	ctx.save();
	const alpha = 0.15 + 0.1 * Math.sin(ts * 0.01);
	ctx.strokeStyle = isDark ? `rgba(148,163,184,${alpha})` : `rgba(71,85,105,${alpha})`;
	ctx.lineWidth = 1;

	const wheelPositions =
		vehicle === "wheelchair"
			? [
					[-9, y + 4],
					[9, y + 4]
				]
			: [
					[-15, y + 5],
					[15, y + 5],
					[-15, y - 11],
					[15, y - 11]
				];

	wheelPositions.forEach(([wx, wy]) => {
		for (let i = 0; i < 2; i++) {
			const offset = (wheelAngle + i * Math.PI) % (Math.PI * 2);
			const lineX = x + wx - 3 - i * 2;
			const lineY = wy + Math.sin(offset) * 2;
			ctx.beginPath();
			ctx.moveTo(lineX, lineY - 1);
			ctx.lineTo(lineX - 3, lineY);
			ctx.stroke();
		}
	});

	ctx.restore();
}
