import type { RenderCtx } from "./utils";
import { rr, lighten, strHash } from "./utils";
import type { VisualTask } from "../arenaTypes";

// ── Monitor activity (code editor simulation on workstation screen) ───────
export function drawMonitorActivity(
	rc: RenderCtx,
	task: VisualTask,
	sx: number,
	sy: number,
	sw: number,
	sh: number,
	color: string
) {
	const { ctx, isDark, ts } = rc;
	const active = !!task.claimedByAgentId;
	const seed = strHash(task.id);
	const phase = ts * 0.001 + (seed % 100) * 0.01;
	const contentBottom = sy + sh - 6;

	ctx.save();
	rr(ctx, sx, sy, sw, sh, 3);
	ctx.clip();

	if (task.status === "blocked") {
		ctx.fillStyle = isDark ? "#2a0f18" : "#3f111d";
		ctx.fillRect(sx, sy, sw, sh);
		ctx.fillStyle = "rgba(239,68,68,0.45)";
		for (let i = 0; i < 4; i++) {
			const yy = sy + 4 + i * 4;
			ctx.fillRect(sx + 4, yy, sw - 8 - ((i + seed) % 9), 1.6);
		}
		ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.sin(phase * 5) * 0.12})`;
		ctx.fillRect(sx + 4, contentBottom - 3, 7, 2);
		ctx.restore();
		return;
	}

	if (active) {
		ctx.fillStyle = isDark ? "rgba(2,6,23,0.35)" : "rgba(15,23,42,0.22)";
		rr(ctx, sx + 3, sy + 3, sw - 6, contentBottom - sy - 4, 2);
		ctx.fill();

		ctx.fillStyle = "rgba(255,255,255,0.22)";
		ctx.fillRect(sx + 5, sy + 5, sw - 10, 1.4);
		ctx.fillStyle = "rgba(15,23,42,0.25)";
		ctx.fillRect(sx + 5, sy + 8, 7, contentBottom - sy - 10);
		ctx.fillStyle = "rgba(255,255,255,0.16)";
		ctx.fillRect(sx + 15, sy + 8, sw - 20, contentBottom - sy - 10);

		const scroll = Math.floor(ts / 180) % 6;
		for (let li = 0; li < 4; li++) {
			const yy = sy + 9 + li * 3;
			const widthSeed = ((seed >> li) % 9) / 10;
			const pulse = Math.sin(phase * 2 + li) * 0.5 + 0.5;
			const lineW = 7 + (sw - 25) * (0.35 + widthSeed * 0.35 + pulse * 0.18);
			ctx.fillStyle = li === scroll % 4 ? "rgba(255,255,255,0.78)" : `rgba(255,255,255,${0.22 + li * 0.08})`;
			ctx.fillRect(sx + 17, yy, Math.min(sw - 22, lineW), 1.4);
		}

		const cursorX = sx + 18 + ((Math.floor(ts / 120) + seed) % Math.max(1, sw - 25));
		if (Math.floor(ts / 300) % 2 === 0) {
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(cursorX, sy + 17, 1, 4);
		}

		ctx.fillStyle = "rgba(255,255,255,0.2)";
		ctx.fillRect(sx + 5, contentBottom - 3, sw - 10, 1.5);
		ctx.fillStyle = lighten(color, 55);
		ctx.fillRect(sx + 5, contentBottom - 3, ((Math.sin(phase) * 0.5 + 0.5) * (sw - 10)) | 0, 1.5);
		ctx.restore();
		return;
	}

	if (task.status === "pending") {
		ctx.fillStyle = isDark ? "rgba(15,23,42,0.45)" : "rgba(255,255,255,0.16)";
		rr(ctx, sx + 4, sy + 4, sw - 8, contentBottom - sy - 5, 2);
		ctx.fill();
		ctx.fillStyle = "rgba(255,255,255,0.25)";
		ctx.fillRect(sx + 6, sy + 6, sw - 12, 2);
		for (let i = 0; i < 3; i++) {
			ctx.fillStyle = `rgba(255,255,255,${0.14 + i * 0.06})`;
			ctx.fillRect(sx + 7, sy + 11 + i * 3, sw - 15 - i * 5, 1.2);
		}
		const scanY = sy + 9 + ((ts * 0.018 + seed) % Math.max(1, contentBottom - sy - 12));
		ctx.fillStyle = "rgba(56,189,248,0.28)";
		ctx.fillRect(sx + 5, scanY, sw - 10, 1.2);
		ctx.restore();
		return;
	}

	ctx.strokeStyle = isDark ? "rgba(148,163,184,0.1)" : "rgba(255,255,255,0.08)";
	ctx.lineWidth = 0.5;
	for (let gx = sx + 5; gx < sx + sw - 4; gx += 5) {
		ctx.beginPath();
		ctx.moveTo(gx, sy + 4);
		ctx.lineTo(gx, contentBottom - 2);
		ctx.stroke();
	}
	ctx.restore();
}
