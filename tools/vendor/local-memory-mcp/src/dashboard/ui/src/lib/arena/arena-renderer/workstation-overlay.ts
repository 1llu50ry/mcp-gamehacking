import type { RenderCtx } from "./utils";
import { arenaFont, ARENA_TEXT_BODY, ARENA_TEXT_LABEL, ARENA_TEXT_TITLE, rr, rgba, pointInRect } from "./utils";
import type { ZoneRect, ArenaScene } from "../arenaTypes";

// ── Zone aggregate overlay (LOD_AGGREGATE) ─────────────────────────────────
export function drawZoneAggregate(rc: RenderCtx, zone: ZoneRect, scene: ArenaScene) {
	const { ctx, isDark } = rc;
	const { x, y, w, color, label } = zone;
	let agentCount = 0,
		healthyCount = 0,
		degradedCount = 0,
		criticalCount = 0;

	for (const a of scene.agents.values()) {
		// Geometric membership shares the same helper as the zone stats strip.
		if (pointInRect(a.targetX, a.targetY, zone)) {
			agentCount++;
			if (a.health === "healthy") healthyCount++;
			else if (a.health === "degraded") degradedCount++;
			else if (a.health === "critical") criticalCount++;
		}
	}

	let taskCount = 0;
	for (const t of scene.tasks.values()) {
		if (pointInRect(t.x, t.y, zone)) taskCount++;
	}

	const totalCount = agentCount + taskCount;
	if (totalCount === 0) return;

	const headerH = 20,
		headerY = y + 3;
	ctx.fillStyle = rgba(color, isDark ? 0.35 : 0.25);
	rr(ctx, x + 4, headerY, w - 8, headerH, 6);
	ctx.fill();
	ctx.strokeStyle = rgba(color, 0.6);
	ctx.lineWidth = 1;
	rr(ctx, x + 4, headerY, w - 8, headerH, 6);
	ctx.stroke();

	ctx.fillStyle = color;
	ctx.font = arenaFont(ARENA_TEXT_TITLE, "bold");
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillText(label.toUpperCase(), x + 10, headerY + headerH / 2);

	const countText = `${totalCount}`;
	const countW = Math.max(ctx.measureText(countText).width + 8, 16);
	ctx.fillStyle = rgba(color, 0.8);
	rr(ctx, x + w - 12 - countW, headerY + (headerH - 12) / 2, countW, 12, 6);
	ctx.fill();
	ctx.fillStyle = "#ffffff";
	ctx.font = arenaFont(ARENA_TEXT_BODY, "bold", true);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(countText, x + w - 12 - countW / 2, headerY + headerH / 2);

	if (agentCount > 0) {
		const barH = 4;
		const barX = x + 8,
			barY = headerY + headerH + 4,
			barW = w - 16;
		ctx.fillStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
		rr(ctx, barX, barY, barW, barH, 2);
		ctx.fill();
		let segX = barX;
		if (healthyCount > 0) {
			ctx.fillStyle = "#22C55E";
			rr(ctx, segX, barY, (healthyCount / agentCount) * barW, barH, 2);
			ctx.fill();
			segX += (healthyCount / agentCount) * barW;
		}
		if (degradedCount > 0) {
			ctx.fillStyle = "#EAB308";
			rr(ctx, segX, barY, (degradedCount / agentCount) * barW, barH, 2);
			ctx.fill();
			segX += (degradedCount / agentCount) * barW;
		}
		if (criticalCount > 0) {
			ctx.fillStyle = "#EF4444";
			rr(ctx, segX, barY, (criticalCount / agentCount) * barW, barH, 2);
			ctx.fill();
		}
		ctx.fillStyle = isDark ? "rgba(148,163,184,0.7)" : "rgba(71,85,105,0.7)";
		ctx.font = arenaFont(ARENA_TEXT_LABEL);
		ctx.textBaseline = "top";
		ctx.textAlign = "left";
		ctx.fillText(`${agentCount} agents`, barX, barY + barH + 2);
		ctx.textAlign = "right";
		ctx.fillText(`${taskCount} tasks`, barX + barW, barY + barH + 2);
	} else if (taskCount > 0) {
		ctx.fillStyle = isDark ? "rgba(148,163,184,0.7)" : "rgba(71,85,105,0.7)";
		ctx.font = arenaFont(ARENA_TEXT_LABEL);
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.fillText(`${taskCount} tasks`, x + w / 2, headerY + headerH + 4);
	}
}
