import type { RenderCtx } from "./utils";
import { arenaFont, ARENA_TEXT_LABEL, rgba, lighten, darken, strHash } from "./utils";
import type { VisualAgent } from "../arenaTypes";
import { drawHealthRing } from "./agents";

// ── LOD_SIMPLIFIED: colored circle with health ring ─────────────────────────
export function drawCharacterSimplified(rc: RenderCtx, agent: VisualAgent) {
	const { ctx, isDark, ts, reducedMotion, hoveredId } = rc;
	const { x, y, state, name, id } = agent;
	const agentColor = agent.color || "#64748b";
	const hovered = id === hoveredId;
	const spd = Math.hypot(agent.vx, agent.vy);
	const moving = spd > 5;
	const working = state === "processing" && !moving;

	let yOff = 0;
	if (!reducedMotion) {
		if (working) {
			yOff = Math.sin(ts * 0.018) * 0.8;
		} else if (state === "idle" && !moving) {
			yOff = Math.sin(ts * 0.003 + strHash(name)) * 1;
		} else if (state === "blocked") {
			yOff = Math.sin(ts * 0.05) * 1.5;
		}
	}

	const drawY = y + yOff;

	// Ground shadow
	ctx.fillStyle = "rgba(0,0,0,0.18)";
	ctx.beginPath();
	ctx.ellipse(x, drawY + 3, 9, 4, 0, 0, Math.PI * 2);
	ctx.fill();

	// Hover ring
	if (hovered) {
		ctx.strokeStyle = agentColor;
		ctx.lineWidth = 1.5;
		ctx.setLineDash([3, 2]);
		ctx.beginPath();
		ctx.arc(x, drawY - 4, 12, 0, Math.PI * 2);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Health ring
	drawHealthRing(rc, x, drawY, agent.healthRing, agent.health);

	// Simple body
	const bodyR = 10;
	const bGrd = ctx.createRadialGradient(x - 2, drawY - 6, 1, x, drawY - 4, bodyR);
	bGrd.addColorStop(0, lighten(agentColor, 30));
	bGrd.addColorStop(1, agentColor);
	ctx.fillStyle = bGrd;
	ctx.beginPath();
	ctx.arc(x, drawY - 4, bodyR, 0, Math.PI * 2);
	ctx.fill();

	ctx.strokeStyle = darken(agentColor, 20);
	ctx.lineWidth = 0.75;
	ctx.beginPath();
	ctx.arc(x, drawY - 4, bodyR, 0, Math.PI * 2);
	ctx.stroke();

	// State dot
	if (state !== "idle") {
		const dotColor =
			state === "blocked"
				? "#ef4444"
				: state === "processing"
					? "#a855f7"
					: state === "claiming"
						? "#0ea5e9"
						: state === "burnout"
							? "#f59e0b"
							: agentColor;
		ctx.fillStyle = dotColor;
		ctx.beginPath();
		ctx.arc(x + 7, drawY - 10, 3, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(x + 7, drawY - 10, 3, 0, Math.PI * 2);
		ctx.stroke();
	}

	// Name
	ctx.fillStyle = isDark ? "rgba(226,232,240,0.82)" : "rgba(15,23,42,0.7)";
	ctx.font = arenaFont(ARENA_TEXT_LABEL);
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.fillText(name.length > 12 ? name.slice(0, 12) + "…" : name, x, drawY + 10);
}

// ── LOD_AGGREGATE: tiny colored dot ─────────────────────────────────────────
export function drawCharacterAggregate(rc: RenderCtx, agent: VisualAgent) {
	const { ctx, hoveredId } = rc;
	const { x, y, health, healthRing } = agent;
	const color = agent.color || "#64748b";
	const hovered = agent.id === hoveredId;

	const dotR = 3.5;
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(x, y, dotR, 0, Math.PI * 2);
	ctx.fill();

	const colorMap: Record<string, string> = {
		healthy: "#22C55E",
		degraded: "#EAB308",
		critical: "#EF4444",
		offline: "#9CA3AF"
	};
	const ringColor = colorMap[health] || "#9CA3AF";
	const clamped = Math.max(0, Math.min(100, healthRing));
	const startAngle = -Math.PI / 2;
	const endAngle = startAngle + (clamped / 100) * Math.PI * 2;

	ctx.strokeStyle = rgba(ringColor, 0.2);
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.arc(x, y, dotR + 1.5, 0, Math.PI * 2);
	ctx.stroke();

	ctx.strokeStyle = ringColor;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.arc(x, y, dotR + 1.5, startAngle, endAngle);
	ctx.stroke();

	if (hovered) {
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 1.5;
		ctx.setLineDash([2, 2]);
		ctx.beginPath();
		ctx.arc(x, y, dotR + 4, 0, Math.PI * 2);
		ctx.stroke();
		ctx.setLineDash([]);
	}
}
