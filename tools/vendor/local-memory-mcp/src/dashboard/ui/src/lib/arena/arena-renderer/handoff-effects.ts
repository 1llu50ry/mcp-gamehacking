/**
 * Canvas drawing functions for handoff animations.
 *
 * Composite handoff drawing functions that dispatch to specialized modules.
 */

import type { RenderCtx } from "./utils";
import type { VisualAgent } from "../arenaTypes";
import { drawWheelchair, drawStretcher } from "./vehicles";
import { drawHelperCharacter, drawPassiveAgent } from "./characters";
import { drawRollingSFX } from "./trail-effects";
import { arenaFont, ARENA_TEXT_LABEL } from "./utils";

// ── Handoff dotted trail path ──────────────────────────────────────────
export function drawHandoffTrail(rc: RenderCtx, agent: VisualAgent) {
	const { ctx, isDark, ts, reducedTransparency } = rc;
	const h = agent.handoffAnim!;

	ctx.save();
	ctx.strokeStyle = isDark ? "rgba(20, 184, 166, 0.35)" : "rgba(20, 184, 166, 0.45)";
	ctx.lineWidth = 2;
	ctx.setLineDash([6, 5]);
	ctx.lineDashOffset = -(ts * 0.03) % 11;
	ctx.beginPath();
	ctx.moveTo(h.startX, h.startY);
	ctx.lineTo(h.endX, h.endY);
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.lineDashOffset = 0;

	if (h.phase === "moving") {
		const dotProgress = (ts % 2000) / 2000;
		const dx = h.startX + (h.endX - h.startX) * dotProgress;
		const dy = h.startY + (h.endY - h.startY) * dotProgress;
		ctx.fillStyle = "#14b8a6";
		if (!reducedTransparency) {
			ctx.shadowColor = "#14b8a6";
			ctx.shadowBlur = 6;
		}
		ctx.beginPath();
		ctx.arc(dx, dy, 3, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;
	}

	if (h.phase !== "arrive") {
		const pulse = 0.4 + 0.3 * Math.sin(ts * 0.004);
		ctx.strokeStyle = `rgba(20, 184, 166, ${pulse})`;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(h.endX, h.endY, 8, 0, Math.PI * 2);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(h.endX - 4, h.endY);
		ctx.lineTo(h.endX + 4, h.endY);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(h.endX, h.endY - 4);
		ctx.lineTo(h.endX, h.endY + 4);
		ctx.stroke();
	}

	ctx.restore();
}

// ── Handoff group: vehicle + helper + passive agent ──────────────────────
export function drawHandoffGroup(rc: RenderCtx, agent: VisualAgent) {
	const { ctx, isDark, ts } = rc;
	const h = agent.handoffAnim!;
	const { x, y } = agent;

	const dx = h.endX - h.startX;
	const dy = h.endY - h.startY;
	const dist = Math.hypot(dx, dy) || 1;
	const nx = -dx / dist;
	const ny = -dy / dist;
	const helperDist = h.vehicle === "wheelchair" ? 18 : 22;
	const helperX = x + nx * helperDist;
	const helperY = y + ny * helperDist + h.stepBounce;

	let helperAlpha = 1;
	if (h.phase === "pickup") {
		const pickupElapsed = ts - h.phaseStartTs;
		helperAlpha = Math.min(1, pickupElapsed / 400);
	} else if (h.phase === "arrive") {
		const arriveElapsed = ts - h.phaseStartTs;
		helperAlpha = Math.max(0, 1 - arriveElapsed / 600);
	} else if (h.phase === "resting") {
		helperAlpha = 0;
	}

	if (h.vehicle === "wheelchair") {
		drawWheelchair(ctx, x, y, h.wheelAngle, isDark);
	} else {
		const breathPhase = ts * 0.002;
		drawStretcher(ctx, x, y, h.wheelAngle, breathPhase, isDark);
	}

	drawPassiveAgent(rc, agent);

	if (helperAlpha > 0.01) {
		ctx.save();
		ctx.globalAlpha = helperAlpha;
		drawHelperCharacter(
			ctx,
			helperX,
			helperY,
			h.helperVariant,
			h.helperFacing,
			h.phase === "moving" ? h.helperWalkPhase : 0,
			isDark
		);
		ctx.restore();
	}

	// Name label
	ctx.fillStyle = isDark ? "rgba(226,232,240,0.82)" : "rgba(15,23,42,0.7)";
	ctx.font = arenaFont(ARENA_TEXT_LABEL);
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	const lbl = agent.name.length > 12 ? agent.name.slice(0, 12) + "…" : agent.name;
	const nameY = y + (h.vehicle === "stretcher" ? 14 : 12);
	ctx.fillText(lbl, x, nameY);

	if (agent.currentTool) {
		ctx.fillStyle = isDark ? "#94a3b8" : "#64748b";
		ctx.font = arenaFont(ARENA_TEXT_LABEL, undefined, true);
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.fillText(`🔧 ${agent.currentTool}`, x, nameY + 8);
	}

	if (h.phase === "moving") {
		drawRollingSFX(ctx, x, y, h.wheelAngle, h.vehicle, isDark, ts);
	}
}
