/**
 * Character drawing functions for handoff animations.
 */

import { rr, lighten, strHash, HAIR_COLORS, SKIN_TONES, HELPER_SHIRT_COLORS, HELPER_HAIR, HELPER_SKIN } from "./utils";
import type { RenderCtx } from "./utils";
import type { VisualAgent, AgentFacing, HelperVariant } from "../arenaTypes";

// ── Helper character (small nurse/staff sprite) ─────────────────────────
export function drawHelperCharacter(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	variant: HelperVariant,
	facing: AgentFacing,
	walkPhase: number,
	isDark: boolean
) {
	ctx.save();
	ctx.translate(x, y);
	if (facing === "left") ctx.scale(-1, 1);

	const shirtColor = HELPER_SHIRT_COLORS[variant];
	const hairColor = HELPER_HAIR[variant];
	const skinColor = HELPER_SKIN[variant];
	const moving = walkPhase > 0.1;
	const legSwing = moving ? Math.sin(walkPhase) * 4 : 0;
	const armSwing = moving ? Math.sin(walkPhase + Math.PI) * 3 : 0;
	const headBob = moving ? Math.sin(walkPhase * 2) * 0.8 : 0;

	ctx.fillStyle = "rgba(0,0,0,0.18)";
	ctx.beginPath();
	ctx.ellipse(0, 2, 8, 3.5, 0, 0, Math.PI * 2);
	ctx.fill();

	ctx.fillStyle = isDark ? "#1a2535" : "#334155";
	ctx.save();
	ctx.translate(-2.5, 0);
	ctx.rotate(legSwing * 0.08);
	rr(ctx, -2, -3, 4, 7, 1.5);
	ctx.fill();
	ctx.restore();
	ctx.save();
	ctx.translate(2.5, 0);
	ctx.rotate(-legSwing * 0.08);
	rr(ctx, -2, -3, 4, 7, 1.5);
	ctx.fill();
	ctx.restore();

	ctx.fillStyle = isDark ? "#0f172a" : "#1e293b";
	ctx.save();
	ctx.translate(-2.5, legSwing * 0.4);
	rr(ctx, -2.5, 3, 5, 3, 1.5);
	ctx.fill();
	ctx.restore();
	ctx.save();
	ctx.translate(2.5, -legSwing * 0.4);
	rr(ctx, -2.5, 3, 5, 3, 1.5);
	ctx.fill();
	ctx.restore();

	const bGrd = ctx.createLinearGradient(-5, -20, 5, -10);
	bGrd.addColorStop(0, lighten(shirtColor, 20));
	bGrd.addColorStop(1, shirtColor);
	ctx.fillStyle = bGrd;
	rr(ctx, -5, -20, 10, 11, 2);
	ctx.fill();

	if (variant === "male_nurse" || variant === "female_nurse") {
		ctx.fillStyle = "rgba(255,255,255,0.5)";
		rr(ctx, -1, -17, 2, 5, 0.75);
		ctx.fill();
		rr(ctx, -2.5, -15.5, 5, 2, 0.75);
		ctx.fill();
	}

	ctx.save();
	ctx.translate(-6.5, -19);
	ctx.rotate(armSwing * 0.1);
	ctx.fillStyle = bGrd;
	rr(ctx, -1.5, 0, 3, 7, 1.5);
	ctx.fill();
	ctx.fillStyle = skinColor;
	ctx.beginPath();
	ctx.ellipse(0, 8, 2, 1.5, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
	ctx.save();
	ctx.translate(6.5, -19);
	ctx.rotate(-armSwing * 0.1);
	ctx.fillStyle = bGrd;
	rr(ctx, -1.5, 0, 3, 7, 1.5);
	ctx.fill();
	ctx.fillStyle = skinColor;
	ctx.beginPath();
	ctx.ellipse(0, 8, 2, 1.5, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	ctx.fillStyle = skinColor;
	rr(ctx, -2, -22, 4, 3, 1.25);
	ctx.fill();

	const headY = -29 + headBob;
	ctx.fillStyle = skinColor;
	ctx.beginPath();
	ctx.ellipse(0, headY, 6.5, 7.5, 0, 0, Math.PI * 2);
	ctx.fill();

	ctx.fillStyle = hairColor;
	ctx.beginPath();
	ctx.ellipse(0, headY, 6.5, 7.5, 0, Math.PI, 0);
	ctx.fill();

	if (variant === "male_nurse" || variant === "female_nurse") {
		ctx.fillStyle = "#f0f0f0";
		rr(ctx, -5, headY - 8, 10, 5, 2);
		ctx.fill();
		ctx.fillStyle = "#ef4444";
		rr(ctx, -1, headY - 7, 2, 3, 0.5);
		ctx.fill();
		rr(ctx, -2, headY - 6, 4, 1, 0.5);
		ctx.fill();
	}

	if (facing !== "up") {
		ctx.fillStyle = "rgba(0,0,0,0.7)";
		ctx.beginPath();
		ctx.arc(-2, headY - 1, 1, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(2, headY - 1, 1, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,0.4)";
		ctx.lineWidth = 0.75;
		ctx.beginPath();
		ctx.arc(0, headY + 1.5, 2, 0.1, Math.PI - 0.1);
		ctx.stroke();
	}

	ctx.restore();
}

// ── Passive agent (seated or lying in vehicle) ──────────────────────────
export function drawPassiveAgent(rc: RenderCtx, agent: VisualAgent) {
	const { ctx, ts } = rc;
	const h = agent.handoffAnim!;
	const { x, y, name, color } = agent;
	const nh = strHash(name || "");
	const hairColor = HAIR_COLORS[nh % HAIR_COLORS.length] || "#000";
	const skinTone = SKIN_TONES[(nh >>> 6) % SKIN_TONES.length] || "#f5c89a";

	if (h.vehicle === "wheelchair") {
		ctx.save();
		ctx.translate(x, y);
		ctx.fillStyle = color || "#64748b";
		rr(ctx, -5, -16, 10, 8, 2);
		ctx.fill();
		ctx.fillStyle = skinTone;
		ctx.beginPath();
		ctx.ellipse(0, -24, 6, 7, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = hairColor;
		ctx.beginPath();
		ctx.ellipse(0, -24, 6, 7, 0, Math.PI, 0);
		ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,0.5)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(-2, -24, 1.5, 0, Math.PI);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(2, -24, 1.5, 0, Math.PI);
		ctx.stroke();
		ctx.fillStyle = skinTone;
		ctx.beginPath();
		ctx.ellipse(-10, -10, 2, 1.5, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.ellipse(10, -10, 2, 1.5, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	} else {
		ctx.save();
		ctx.translate(x, y);
		const breathe = Math.sin(ts * 0.002) * 0.5;
		ctx.fillStyle = skinTone;
		ctx.beginPath();
		ctx.ellipse(10, -1 + breathe, 5, 6, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = hairColor;
		ctx.beginPath();
		ctx.ellipse(10, -1 + breathe, 5, 6, 0, Math.PI * 0.8, Math.PI * 2.2);
		ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,0.5)";
		ctx.lineWidth = 0.75;
		ctx.beginPath();
		ctx.arc(9, -2 + breathe, 1, 0, Math.PI);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(12, -2 + breathe, 1, 0, Math.PI);
		ctx.stroke();
		ctx.restore();
	}
}
