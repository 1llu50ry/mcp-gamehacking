// ── Shared agent rendering utilities + re-exports from sub-modules ────────
import type { RenderCtx } from "./utils";
import { arenaFont, ARENA_TEXT_BODY, ARENA_TEXT_MICRO, rr, rgba, lighten, darken } from "./utils";

// ── Re-export full & simplified LOD ───────────────────────────────────────
export { drawCharacter } from "./agents-full";
export { drawCharacterSimplified, drawCharacterAggregate } from "./agents-simple";

// ── Health ring ─────────────────────────────────────────────────────────────
export function drawHealthRing(rc: RenderCtx, x: number, y: number, healthRing: number, health: string) {
	const { ctx } = rc;
	const radius = 20;
	const ringY = y + 7;
	const strokeWidth = 3;

	const colorMap: Record<string, string> = {
		healthy: "#22C55E",
		degraded: "#EAB308",
		critical: "#EF4444",
		offline: "#9CA3AF"
	};
	const ringColor = colorMap[health] || "#9CA3AF";

	ctx.strokeStyle = rgba(ringColor, 0.15);
	ctx.lineWidth = strokeWidth;
	ctx.beginPath();
	ctx.arc(x, ringY, radius, 0, Math.PI * 2);
	ctx.stroke();

	const clamped = Math.max(0, Math.min(100, healthRing));
	const startAngle = -Math.PI / 2;
	const endAngle = startAngle + (clamped / 100) * Math.PI * 2;

	if (health === "critical" && !rc.reducedMotion) {
		const pulse = 0.5 + 0.5 * Math.sin(rc.ts * 0.006);
		ctx.save();
		ctx.shadowColor = "#EF4444";
		ctx.shadowBlur = 8 + pulse * 6;
		ctx.strokeStyle = ringColor;
		ctx.lineWidth = strokeWidth;
		ctx.beginPath();
		ctx.arc(x, ringY, radius, startAngle, endAngle);
		ctx.stroke();
		ctx.restore();
	} else {
		ctx.strokeStyle = ringColor;
		ctx.lineWidth = strokeWidth;
		ctx.beginPath();
		ctx.arc(x, ringY, radius, startAngle, endAngle);
		ctx.stroke();
	}

	ctx.fillStyle = ringColor;
	ctx.globalAlpha = 0.85;
	ctx.font = arenaFont(ARENA_TEXT_MICRO, "bold", true);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(`${Math.round(clamped)}`, x, ringY);
	ctx.globalAlpha = 1;
}

// ── Status icon ─────────────────────────────────────────────────────────────
export function drawStatusIcon(
	rc: RenderCtx,
	x: number,
	y: number,
	headBob: number,
	statusIcon: string,
	currentAction: string
) {
	const { ctx } = rc;
	const iconY = y - 42 + headBob;

	const actionIcons: Record<string, string> = {
		coding: "⚡",
		testing: "🧪",
		reviewing: "👁",
		searching: "🔍",
		"memory-syncing": "🧠",
		thinking: "💭",
		retrying: "🔄",
		waiting: "●",
		idle: "●"
	};

	let icon = statusIcon;
	if (!icon || icon === "" || icon === "default") {
		icon = actionIcons[currentAction] || "";
	}
	if (!icon) return;

	const metrics = ctx.measureText(icon);
	ctx.fillStyle = "rgba(0,0,0,0.25)";
	ctx.beginPath();
	const pw = Math.max(12, metrics.width + 8);
	rr(ctx, x - pw / 2, iconY - 4, pw, 10, 4);
	ctx.fill();

	ctx.font = arenaFont(ARENA_TEXT_BODY);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(icon, x, iconY + 1);
}

// ── Speech bubble ───────────────────────────────────────────────────────────
export function drawSpeechBubble(
	rc: RenderCtx,
	x: number,
	y: number,
	text: string,
	color: string,
	speechBubbleTs: number
): void {
	const { ctx, isDark, reducedMotion } = rc;
	const SPEECH_DURATION_MS = 3000;
	const now = Date.now();

	if (!speechBubbleTs || now - speechBubbleTs > SPEECH_DURATION_MS) return;

	const age = now - speechBubbleTs;
	const remaining = Math.max(0, SPEECH_DURATION_MS - age);
	const fadeOutAlpha = reducedMotion ? 1 : Math.min(1, remaining / 300);

	const maxCharsPerLine = 20;
	const lines: string[] = [];
	let remaining2 = text;
	while (remaining2.length > 0) {
		lines.push(remaining2.slice(0, maxCharsPerLine));
		remaining2 = remaining2.slice(maxCharsPerLine);
	}

	const fontSize = ARENA_TEXT_BODY;
	ctx.font = arenaFont(fontSize);

	const lineHeight = fontSize + 3;
	const paddingX = 8;
	const paddingY = 5;
	const tailHeight = 6;
	const tailWidth = 6;
	const borderRadius = 6;

	let maxLineW = 0;
	for (const line of lines) {
		const m = ctx.measureText(line).width;
		if (m > maxLineW) maxLineW = m;
	}

	const bubbleW = Math.max(maxLineW + paddingX * 2, 30);
	const bubbleH = lines.length * lineHeight + paddingY * 2;
	const bubbleX = x - bubbleW / 2;
	const bubbleY = y - bubbleH - tailHeight - 52;

	ctx.save();
	ctx.globalAlpha = 0.9 * fadeOutAlpha;

	ctx.fillStyle = isDark ? "#1e293b" : "#ffffff";
	rr(ctx, bubbleX, bubbleY, bubbleW, bubbleH, borderRadius);
	ctx.fill();

	ctx.strokeStyle = color;
	ctx.lineWidth = 1.5;
	rr(ctx, bubbleX, bubbleY, bubbleW, bubbleH, borderRadius);
	ctx.stroke();

	const tailX = x;
	const tailY = bubbleY + bubbleH;
	ctx.fillStyle = isDark ? "#1e293b" : "#ffffff";
	ctx.beginPath();
	ctx.moveTo(tailX - tailWidth / 2, tailY);
	ctx.lineTo(tailX + tailWidth / 2, tailY);
	ctx.lineTo(tailX, tailY + tailHeight);
	ctx.closePath();
	ctx.fill();

	ctx.strokeStyle = color;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(tailX - tailWidth / 2, tailY);
	ctx.lineTo(tailX, tailY + tailHeight);
	ctx.lineTo(tailX + tailWidth / 2, tailY);
	ctx.stroke();

	ctx.fillStyle = isDark ? "#e2e8f0" : "#1e293b";
	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	for (let i = 0; i < lines.length; i++) {
		ctx.fillText(lines[i], bubbleX + paddingX, bubbleY + paddingY + i * lineHeight);
	}

	ctx.restore();
}

// ── Hair styles ─────────────────────────────────────────────────────────────
export function drawHair(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, style: number) {
	ctx.fillStyle = color;
	switch (style) {
		case 0: {
			ctx.beginPath();
			ctx.ellipse(x, y, 9, 10, 0, Math.PI, 0);
			ctx.fill();
			ctx.fillRect(x - 9, y - 2, 3, 5);
			ctx.fillRect(x + 6, y - 2, 3, 5);
			break;
		}
		case 1: {
			for (let i = -2; i <= 2; i++) {
				ctx.beginPath();
				ctx.moveTo(x + i * 4 - 2, y - 7);
				ctx.lineTo(x + i * 4, y - 14);
				ctx.lineTo(x + i * 4 + 2, y - 7);
				ctx.closePath();
				ctx.fill();
			}
			ctx.beginPath();
			ctx.ellipse(x, y - 5, 9, 4, 0, 0, Math.PI * 2);
			ctx.fill();
			break;
		}
		case 2: {
			ctx.save();
			ctx.translate(x, y);
			ctx.beginPath();
			ctx.moveTo(-9, -2);
			ctx.bezierCurveTo(-11, -12, 10, -16, 11, -6);
			ctx.lineTo(9, 0);
			ctx.bezierCurveTo(4, -8, -4, -10, -9, -2);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
			break;
		}
		case 3: {
			ctx.beginPath();
			ctx.arc(x, y, 9.5, Math.PI, 0);
			ctx.fill();
			rr(ctx, x - 10, y, 4, 12, 2);
			ctx.fill();
			rr(ctx, x + 6, y, 4, 12, 2);
			ctx.fill();
			break;
		}
		case 4: {
			ctx.fillStyle = darken(color, 20);
			rr(ctx, x - 12, y - 6, 24, 5, 2);
			ctx.fill();
			ctx.fillStyle = color;
			rr(ctx, x - 9, y - 16, 18, 12, 3);
			ctx.fill();
			ctx.fillStyle = lighten(color, 40);
			rr(ctx, x - 3, y - 11, 6, 4, 1);
			ctx.fill();
			break;
		}
	}
}

// ── Face details ────────────────────────────────────────────────────────────
export function drawFace(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	_skinTone: string,
	facing: string,
	moving: boolean,
	walkPhase: number,
	state?: string,
	ts?: number,
	seed?: number
) {
	if (facing === "right") {
		ctx.fillStyle = "rgba(0,0,0,0.7)";
		ctx.beginPath();
		ctx.ellipse(x + 5, y - 2, 1.5, 1.5, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,0.2)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(x + 9, y, 3, -0.5, 0.5);
		ctx.stroke();
	} else {
		if (state === "burnout") {
			const isSwirling = (seed || 0) % 2 === 0;
			if (isSwirling) {
				ctx.strokeStyle = "rgba(0,0,0,0.7)";
				ctx.lineWidth = 1;
				const spin = ((ts || 0) * 0.005) % (Math.PI * 2);
				ctx.save();
				ctx.translate(x - 3, y - 2);
				ctx.rotate(spin);
				ctx.beginPath();
				ctx.moveTo(0, 0);
				for (let i = 0; i < 15; i++) {
					const angle = i * 0.5;
					const radius = i * 0.15;
					ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
				}
				ctx.stroke();
				ctx.restore();
				ctx.save();
				ctx.translate(x + 3, y - 2);
				ctx.rotate(spin);
				ctx.beginPath();
				ctx.moveTo(0, 0);
				for (let i = 0; i < 15; i++) {
					const angle = i * 0.5;
					const radius = i * 0.15;
					ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
				}
				ctx.stroke();
				ctx.restore();
			} else {
				ctx.strokeStyle = "rgba(0,0,0,0.7)";
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.arc(x - 3, y - 2, 2.5, 0, Math.PI);
				ctx.stroke();
				ctx.beginPath();
				ctx.arc(x + 3, y - 2, 2.5, 0, Math.PI);
				ctx.stroke();
			}
			ctx.strokeStyle = "rgba(0,0,0,0.5)";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(x, y + 3, 2, Math.PI, Math.PI * 2);
			ctx.stroke();
		} else {
			ctx.fillStyle = "white";
			ctx.beginPath();
			ctx.ellipse(x - 3, y - 2, 2.5, 2, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.beginPath();
			ctx.ellipse(x + 3, y - 2, 2.5, 2, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "rgba(20,20,80,0.85)";
			ctx.beginPath();
			ctx.arc(x - 3, y - 2, 1.3, 0, Math.PI * 2);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(x + 3, y - 2, 1.3, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "white";
			ctx.beginPath();
			ctx.arc(x - 3.5, y - 2.5, 0.5, 0, Math.PI * 2);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(x + 2.5, y - 2.5, 0.5, 0, Math.PI * 2);
			ctx.fill();
			const mouthOpen = moving && Math.sin(walkPhase) > 0.5;
			ctx.strokeStyle = "rgba(0,0,0,0.5)";
			ctx.lineWidth = 1;
			if (mouthOpen) {
				ctx.beginPath();
				ctx.arc(x, y + 2, 2, 0, Math.PI);
				ctx.stroke();
			} else {
				ctx.beginPath();
				ctx.moveTo(x - 2.5, y + 2.5);
				ctx.quadraticCurveTo(x, y + 4, x + 2.5, y + 2.5);
				ctx.stroke();
			}
		}
	}
}

// ── Self-healing spinner ────────────────────────────────────────────────────
export function drawSelfHealingSpinner(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	ts: number,
	reducedTransparency: boolean
) {
	const radius = 7;
	const strokeWidth = 2.5;
	const color = "#06B6D4";
	const rotation = (ts * 0.005) % (Math.PI * 2);
	const startAngle = rotation;
	const endAngle = rotation + Math.PI * 1.5;

	ctx.save();
	ctx.lineCap = "round";
	if (!reducedTransparency) {
		ctx.shadowColor = color;
		ctx.shadowBlur = 6;
	}
	ctx.strokeStyle = color;
	ctx.lineWidth = strokeWidth;
	ctx.beginPath();
	ctx.arc(x, y, radius, startAngle, endAngle);
	ctx.stroke();
	ctx.restore();
}
