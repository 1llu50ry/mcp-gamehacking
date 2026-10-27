import type { RenderCtx } from "./utils";
import {
	arenaFont,
	ARENA_TEXT_LABEL,
	ARENA_TEXT_MICRO,
	rr,
	rgba,
	lighten,
	darken,
	strHash,
	HAIR_COLORS,
	SKIN_TONES,
	PANT_COLORS
} from "./utils";
import type { VisualAgent } from "../arenaTypes";
import { drawHealthRing, drawStatusIcon, drawSpeechBubble, drawHair, drawFace, drawSelfHealingSpinner } from "./agents";

// ── RPG Character (full LOD) ────────────────────────────────────────────────
export function drawCharacter(rc: RenderCtx, agent: VisualAgent) {
	const { ctx, isDark, ts, reducedMotion, hoveredId } = rc;
	const { walkPhase, facing, state, name, id } = agent;
	let { x, y } = agent;
	const agentColor = agent.color || "#64748b";
	const hovered = id === hoveredId;
	const spd = Math.hypot(agent.vx, agent.vy);
	const moving = spd > 5;

	const nh = strHash(name || "");
	const hairColor = HAIR_COLORS[nh % HAIR_COLORS.length] || "#000";
	const pantColor = PANT_COLORS[(nh >>> 3) % PANT_COLORS.length] || "#1e3a5f";
	const skinTone = SKIN_TONES[(nh >>> 6) % SKIN_TONES.length] || "#f5c89a";
	const hairStyle = nh % 5;
	const shirtHighlight = lighten(agentColor, 30);

	const working = state === "processing" && !moving;
	const workPhase = ts * 0.018 + (nh % 20);
	let legSwing = moving ? Math.sin(walkPhase) * 5 : 0;
	let armSwing = moving ? Math.sin(walkPhase + Math.PI) * 4 : 0;
	let headBob = moving ? Math.sin(walkPhase * 2) * 1.2 : 0;

	if (working) {
		armSwing = Math.sin(workPhase) * 5;
		headBob = Math.sin(workPhase * 0.55) * 0.8;
		y += Math.sin(workPhase * 0.35) * 0.7;
	}

	if (state === "blocked") {
		x += Math.sin(ts * 0.05) * 1.5;
	} else if (state === "idle" && !moving) {
		y += Math.sin(ts * 0.003 + nh) * 1;
	}

	if (reducedMotion) {
		legSwing = 0;
		armSwing = 0;
		headBob = 0;
	}

	// Ground shadow
	ctx.fillStyle = "rgba(0,0,0,0.22)";
	ctx.beginPath();
	ctx.ellipse(x, y + 3, 11, 5, 0, 0, Math.PI * 2);
	ctx.fill();

	// Hover selection ring
	if (hovered) {
		ctx.strokeStyle = agentColor;
		ctx.lineWidth = 2;
		ctx.setLineDash([4, 3]);
		ctx.beginPath();
		ctx.arc(x, y - 24 + headBob, 16, 0, Math.PI * 2);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Health ring
	drawHealthRing(rc, x, y, agent.healthRing, agent.health);

	ctx.save();
	ctx.translate(x, y);
	if (state === "burnout") {
		ctx.rotate(Math.PI / 2);
		ctx.translate(0, 15);
	} else if (working) {
		ctx.rotate(Math.sin(workPhase * 0.45) * 0.03);
		ctx.translate(0, 1);
	} else if (facing === "left") {
		ctx.scale(-1, 1);
	}

	// Legs
	ctx.fillStyle = pantColor;
	ctx.save();
	ctx.translate(-3.5, 0);
	ctx.rotate(legSwing * 0.1);
	rr(ctx, -2.5, -4, 5, 9, 2);
	ctx.fill();
	ctx.restore();
	ctx.save();
	ctx.translate(3.5, 0);
	ctx.rotate(-legSwing * 0.1);
	rr(ctx, -2.5, -4, 5, 9, 2);
	ctx.fill();
	ctx.restore();

	// Shoes
	ctx.fillStyle = darken(pantColor, 30);
	ctx.save();
	ctx.translate(-3.5, legSwing * 0.5);
	rr(ctx, -3, 4, 7, 4, 2);
	ctx.fill();
	ctx.restore();
	ctx.save();
	ctx.translate(3.5, -legSwing * 0.5);
	rr(ctx, -3, 4, 7, 4, 2);
	ctx.fill();
	ctx.restore();

	// Body / shirt
	const bGrd = ctx.createLinearGradient(-7, -26, 7, -13);
	bGrd.addColorStop(0, shirtHighlight);
	bGrd.addColorStop(1, agentColor);
	ctx.fillStyle = bGrd;
	rr(ctx, -7, -26, 14, 14, 3);
	ctx.fill();
	ctx.fillStyle = lighten(agentColor, 45);
	rr(ctx, -3.5, -26, 7, 5, 2);
	ctx.fill();
	ctx.strokeStyle = "rgba(0,0,0,0.12)";
	ctx.lineWidth = 0.75;
	ctx.beginPath();
	ctx.moveTo(0, -26);
	ctx.lineTo(0, -13);
	ctx.stroke();

	// Left arm
	ctx.save();
	ctx.translate(-9, -24);
	ctx.rotate(working ? 0.55 + Math.max(0, Math.sin(workPhase)) * 0.28 : armSwing * 0.12);
	const laGrd = ctx.createLinearGradient(-2, 0, 2, 10);
	laGrd.addColorStop(0, shirtHighlight);
	laGrd.addColorStop(1, agentColor);
	ctx.fillStyle = laGrd;
	rr(ctx, -2, 0, 4, 9, 2);
	ctx.fill();
	ctx.fillStyle = skinTone;
	ctx.beginPath();
	ctx.ellipse(0, 10, 2.5, 2, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	// Right arm
	ctx.save();
	ctx.translate(9, -24);
	ctx.rotate(working ? -0.55 - Math.max(0, Math.sin(workPhase + Math.PI)) * 0.28 : -armSwing * 0.12);
	ctx.fillStyle = laGrd;
	rr(ctx, -2, 0, 4, 9, 2);
	ctx.fill();
	ctx.fillStyle = skinTone;
	ctx.beginPath();
	ctx.ellipse(0, 10, 2.5, 2, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	// Neck — rounded, not a hard 5x4 rectangle wedged between an elliptical
	// head and a rounded torso. At the DPR-native resolution the sharp corners
	// were the most visible remaining hard edge on the character.
	ctx.fillStyle = skinTone;
	rr(ctx, -2.5, -28, 5, 4, 1.5);
	ctx.fill();

	// Head
	const headY = -38 + headBob;
	ctx.fillStyle = "rgba(0,0,0,0.15)";
	ctx.beginPath();
	ctx.ellipse(1, headY + 2, 9, 5, 0, 0, Math.PI * 2);
	ctx.fill();
	const hGrd = ctx.createRadialGradient(-3, headY - 3, 2, 0, headY, 10);
	hGrd.addColorStop(0, lighten(skinTone, 15));
	hGrd.addColorStop(1, skinTone);
	ctx.fillStyle = hGrd;
	ctx.beginPath();
	ctx.ellipse(0, headY, 9, 10, 0, 0, Math.PI * 2);
	ctx.fill();

	drawHair(ctx, 0, headY, hairColor, hairStyle);

	if (facing !== "up") {
		drawFace(ctx, 0, headY, skinTone, facing, moving, walkPhase, state, ts, nh);
	}

	ctx.restore();

	// Colored outline
	if (agent.coloredOutline) {
		const outlineAlpha = hovered ? 0.9 : agent.health === "critical" ? 0.6 : 0.45;
		ctx.save();
		ctx.globalAlpha = outlineAlpha;
		ctx.strokeStyle = agent.coloredOutline;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.ellipse(x, y - 20 + headBob, 12, 20, 0, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}

	// Status icon
	if (agent.statusIcon && agent.statusIcon !== "default") {
		drawStatusIcon(rc, x, y, headBob, agent.statusIcon, agent.currentAction);
	}

	// Speech bubble
	if (agent.speechBubble) {
		drawSpeechBubble(rc, x, y, agent.speechBubble, agentColor, agent.speechBubbleTs);
	}

	// State badges
	if (state !== "idle" && state !== "burnout") {
		const dotColor =
			state === "blocked"
				? "#ef4444"
				: state === "processing"
					? "#a855f7"
					: state === "claiming"
						? "#0ea5e9"
						: "#f59e0b";
		const badgeX = x + (facing === "left" ? -10 : 10);
		const badgeY = y - 48 + headBob;
		ctx.fillStyle = dotColor;
		ctx.shadowColor = dotColor;
		ctx.shadowBlur = 10;
		ctx.beginPath();
		ctx.arc(badgeX, badgeY, 5, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(badgeX, badgeY, 5, 0, Math.PI * 2);
		ctx.stroke();
		ctx.strokeStyle = "rgba(0,0,0,0.5)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(badgeX, badgeY, 6, 0, Math.PI * 2);
		ctx.stroke();
	}

	// Working effect: pulse ring + thought dots
	if (state === "processing") {
		if (!reducedMotion) {
			const pulse = 0.4 + 0.6 * Math.sin(ts * 0.0028);
			ctx.strokeStyle = rgba(agentColor, 0.18 + pulse * 0.14);
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(x, y - 38 + headBob, 17 + pulse * 4, 0, Math.PI * 2);
			ctx.stroke();
		}
		if (working && !reducedMotion) {
			for (let ti = 0; ti < 4; ti++) {
				const tapPhase = (workPhase + ti * 0.9) % (Math.PI * 2);
				const alpha = Math.max(0, Math.sin(tapPhase));
				if (alpha < 0.25) continue;
				ctx.fillStyle = rgba(agentColor, alpha * 0.75);
				ctx.beginPath();
				ctx.arc(x - 9 + ti * 6, y - 11 - alpha * 3, 1.1 + alpha * 0.9, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		for (let bi = 0; bi < 3; bi++) {
			const boff = 0.3 + 0.7 * Math.sin(ts * 0.004 + bi * 1.1);
			ctx.fillStyle = rgba(agentColor, 0.5 + boff * 0.5);
			ctx.beginPath();
			ctx.arc(x + (facing === "left" ? -5 + bi * 5 : -5 + bi * 5), y - 54 + headBob, 1.5 + boff, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// Burnout effect
	if (state === "burnout" && !reducedMotion) {
		const zPhase = (ts * 0.002) % (Math.PI * 2);
		for (let i = 0; i < 3; i++) {
			const zt = (zPhase + i * ((Math.PI * 2) / 3)) % (Math.PI * 2);
			const alpha = Math.max(0, Math.sin(zt));
			const zx = x + 5 + Math.cos(zt) * 5 + zt * 2;
			const zy = y - 10 - zt * 8;
			ctx.fillStyle = `rgba(150, 150, 200, ${alpha})`;
			ctx.font = arenaFont(ARENA_TEXT_MICRO + zt * 1.5, "bold", true);
			ctx.fillText("Z", zx, zy);
		}
	}

	// Self-healing spinner
	if (state === "self_healing" && !reducedMotion) {
		drawSelfHealingSpinner(ctx, x + 14, y - 34, ts, rc.reducedTransparency);
	}

	// Name label
	ctx.fillStyle = isDark ? "rgba(226,232,240,0.82)" : "rgba(15,23,42,0.7)";
	ctx.font = arenaFont(ARENA_TEXT_LABEL);
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	const lbl = name.length > 12 ? name.slice(0, 12) + "…" : name;
	ctx.fillText(lbl, x, y + 12);

	// Tool name label
	if (agent.currentTool) {
		ctx.fillStyle = isDark ? "#94a3b8" : "#64748b";
		ctx.font = arenaFont(ARENA_TEXT_LABEL, undefined, true);
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.fillText(`🔧 ${agent.currentTool}`, x, y + 20);
	}
}
