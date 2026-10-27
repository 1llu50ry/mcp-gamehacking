import type { RenderCtx } from "./utils";
import { arenaFont, ARENA_TEXT_LABEL, ARENA_TEXT_MICRO, rr, rgba, lighten } from "./utils";
import type { VisualTask } from "../arenaTypes";
import { drawMonitorActivity } from "./effects";
export { drawZoneAggregate } from "./workstation-overlay";

// ── Full LOD workstation ──────────────────────────────────────────────────
export function drawWorkstation(
	rc: RenderCtx,
	task: VisualTask,
	reducedMotion: boolean,
	reducedTransparency: boolean,
	sceneAgents?: Map<string, { currentTool: string }> | null,
	zoneColor?: string
) {
	const { ctx, isDark, ts } = rc;
	const x = task.x,
		y = task.y;
	// Zone accent comes from the shared layout manager (passed by the
	// renderer) — the workstation monitor matches its room's tint.
	const color = zoneColor ?? "#64748b";
	const active = !!task.claimedByAgentId;
	const blocked = !!task.blockedReason;
	// Desk/monitor scaled up with the grid cell (MIN_CELL_W 58 -> 96). The old
	// 50x14 desk only ever housed 4.5-6px text; at the legible type scale the
	// monitor has to be big enough for a task code and a title to sit inside it
	// rather than spilling over the desk edge.
	const DW = 78,
		DH = 20,
		SW = 56,
		SH = 32;
	const drawX = x + (!reducedMotion && blocked ? Math.sin(ts * 0.003) * 2 : 0);

	// Chair
	const chairY = y + DH / 2 + 4;
	ctx.fillStyle = isDark ? "#1e2d3a" : "#7a98b5";
	ctx.beginPath();
	ctx.arc(drawX, chairY + 3, 8, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = isDark ? "#162435" : "#6888a8";
	ctx.fillRect(drawX - 6, chairY - 2, 12, 8);
	rr(ctx, drawX - 5, chairY - 9, 10, 9, 2);
	ctx.fill();

	// Retry stack
	if (task.retryCount > 0) {
		for (let ri = task.retryCount; ri > 0; ri--) {
			const offX = ri * 3,
				offY = ri * 3,
				a = Math.max(0, 0.15 - ri * 0.025);
			ctx.fillStyle = rgba(isDark ? "#1e2840" : "#b0bcc8", a);
			rr(ctx, drawX - DW / 2 + offX, y - DH / 2 + offY, DW, DH, 4);
			ctx.fill();
			ctx.strokeStyle = rgba(color, 0.2 - ri * 0.03);
			ctx.lineWidth = 0.75;
			rr(ctx, drawX - DW / 2 + offX, y - DH / 2 + offY, DW, DH, 4);
			ctx.stroke();
		}
	}

	// Desk shadow
	ctx.fillStyle = "rgba(0,0,0,0.18)";
	rr(ctx, drawX - DW / 2 + 3, y - DH / 2 + 5, DW, DH + 2, 4);
	ctx.fill();

	// Desk surface
	const deskGrd = ctx.createLinearGradient(drawX - DW / 2, y - DH / 2, drawX + DW / 2, y + DH / 2);
	deskGrd.addColorStop(0, isDark ? "#1e2840" : "#d4dce8");
	deskGrd.addColorStop(1, isDark ? "#18202e" : "#c0ccd8");
	ctx.fillStyle = deskGrd;
	rr(ctx, drawX - DW / 2, y - DH / 2, DW, DH, 4);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#2d3a50" : "#a0b0c0";
	ctx.lineWidth = 1;
	rr(ctx, drawX - DW / 2, y - DH / 2, DW, DH, 4);
	ctx.stroke();

	// Keyboard
	ctx.fillStyle = isDark ? "#0d1520" : "#8090a8";
	rr(ctx, drawX - 10, y - 2, 20, 5, 2);
	ctx.fill();
	ctx.fillStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.3)";
	[
		[drawX - 9, y - 1, 18, 1.5],
		[drawX - 8, y + 1.5, 16, 1.5]
	].forEach(([kx, ky, kw, kh]) => {
		for (let ki = 0; ki < 5; ki++) {
			rr(ctx, kx + ki * (kw / 5) + 0.5, ky, kw / 5 - 1, kh, 0.5);
			ctx.fill();
		}
	});

	// Mouse
	ctx.fillStyle = isDark ? "#0d1520" : "#8090a8";
	ctx.beginPath();
	ctx.ellipse(drawX + 14, y, 3, 4, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)";
	ctx.lineWidth = 0.5;
	ctx.beginPath();
	ctx.moveTo(drawX + 14, y - 2);
	ctx.lineTo(drawX + 14, y + 2);
	ctx.stroke();

	// Monitor stand
	ctx.fillStyle = isDark ? "#2d3a50" : "#8090a8";
	ctx.fillRect(drawX - 1.5, y - DH / 2 - 7, 3, 8);

	// Monitor frame
	const mY = y - DH / 2 - SH - 6;
	ctx.fillStyle = isDark ? "#111827" : "#1f2937";
	rr(ctx, drawX - SW / 2 - 3, mY - 3, SW + 6, SH + 6, 5);
	ctx.fill();

	// Screen
	if (active) {
		const sGrd2 = ctx.createLinearGradient(drawX - SW / 2, mY, drawX + SW / 2, mY + SH);
		sGrd2.addColorStop(0, lighten(color, 50));
		sGrd2.addColorStop(1, color);
		ctx.fillStyle = sGrd2;
		if (active && !reducedTransparency) {
			ctx.shadowColor = color + "99";
			ctx.shadowBlur = 10;
		}
	} else ctx.fillStyle = isDark ? "#0f1929" : "#1e2d3a";
	rr(ctx, drawX - SW / 2, mY, SW, SH, 3);
	ctx.fill();
	ctx.shadowBlur = 0;

	// Blocked tint
	if (blocked) {
		const bc = blockedReasonColor(task.blockedReason!);
		const pa = reducedMotion ? 0.08 : 0.06 + 0.03 * Math.sin(ts * 0.002);
		ctx.fillStyle = rgba(bc, pa);
		rr(ctx, drawX - DW / 2, y - DH / 2, DW, DH, 4);
		ctx.fill();
	}

	// Screen shine
	ctx.fillStyle = "rgba(255,255,255,0.12)";
	rr(ctx, drawX - SW / 2, mY, SW, SH / 2.5, 3);
	ctx.fill();

	drawMonitorActivity(rc, task, drawX - SW / 2, mY, SW, SH, color);

	// Blocked badge
	if (blocked) drawBlockedBadge(rc, task, drawX, mY, SW, ts);

	// Retry badge
	if (task.retryCount > 0) {
		const rt = `🔄 ${task.retryCount}`;
		const bw = ctx.measureText(rt).width + 8;
		ctx.save();
		ctx.fillStyle = rgba("#06B6D4", 0.9);
		rr(ctx, drawX - SW / 2 - bw + 2, mY + 5, bw, 9, 4);
		ctx.fill();
		ctx.fillStyle = "#ffffff";
		ctx.font = arenaFont(ARENA_TEXT_MICRO, undefined, true);
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(rt, drawX - SW / 2 - bw / 2 + 2, mY + 9.5);
		ctx.restore();
	}

	// Human review badge
	if (task.blockedReason === "human") {
		const pulse = reducedMotion ? 0.8 : 0.6 + 0.4 * Math.sin(ts * 0.005);
		const dotR = reducedMotion ? 5 : 4 + pulse * 1.5;
		const dotX = drawX + SW / 2 + 6,
			dotY = mY - 2;
		ctx.save();
		if (!reducedTransparency) {
			ctx.shadowColor = "#f97316";
			ctx.shadowBlur = 8 + pulse * 6;
		}
		ctx.fillStyle = `rgba(249,115,22,${0.6 + pulse * 0.4})`;
		ctx.beginPath();
		ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.fillStyle = "#ef4444";
		ctx.beginPath();
		ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#ffffff";
		ctx.font = arenaFont(ARENA_TEXT_MICRO);
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillText("👤", dotX + 5, dotY + 0.5);
		ctx.restore();
	}

	// Task code
	ctx.fillStyle = active ? "rgba(255,255,255,0.9)" : isDark ? "#374151" : "#6b7280";
	ctx.font = arenaFont(ARENA_TEXT_LABEL, "bold", true);
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";
	ctx.fillText(`${task.repo.split("/").pop()?.slice(0, 5)}·${task.taskCode}`.slice(0, 12), drawX, mY + SH - 1);

	// Title
	ctx.fillStyle = isDark ? "rgba(148,163,184,0.65)" : "rgba(71,85,105,0.65)";
	ctx.font = arenaFont(ARENA_TEXT_MICRO);
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.fillText(task.title.slice(0, 12), drawX, y + DH / 2 + 2);

	// Progress bar
	if (active && task.progress !== undefined && task.progress > 0) {
		const barX = drawX - 22,
			barY = y + DH / 2 + 10,
			prog = Math.min(1, Math.max(0, task.progress));
		ctx.fillStyle = isDark ? "#1e293b" : "#cbd5e1";
		rr(ctx, barX, barY, 44, 3, 1.5);
		ctx.fill();
		ctx.fillStyle = prog > 0.7 ? "#22C55E" : prog >= 0.3 ? "#EAB308" : "#EF4444";
		rr(ctx, barX, barY, 44 * prog, 3, 1.5);
		ctx.fill();
	}

	// Token usage
	if (active) {
		const tokens = task.tokenCost ?? task.estimatedCost;
		if (tokens && tokens > 0) {
			const tokText = tokens >= 1000 ? `💰 ${(tokens / 1000).toFixed(1)}k` : `💰 ${tokens}`;
			ctx.fillStyle = isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.55)";
			ctx.font = arenaFont(ARENA_TEXT_MICRO, undefined, true);
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			ctx.fillText(tokText, drawX, y + DH / 2 + 16);
		}
	}

	// Tool name
	if (active && sceneAgents) {
		const agent = sceneAgents.get(task.claimedByAgentId!);
		if (agent?.currentTool) {
			const toolY = y + DH / 2 + ((task.tokenCost ?? task.estimatedCost) ? 22 : 16);
			ctx.fillStyle = isDark ? "#94a3b8" : "#64748b";
			ctx.font = arenaFont(ARENA_TEXT_MICRO, undefined, true);
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			ctx.fillText(`🔧 ${agent.currentTool}`, drawX, toolY);
		}
	}

	// Duration badge
	if (active) {
		const started = task.startedAt ?? task.createdAt;
		if (started) {
			const elapsed = Date.now() - started * 1000;
			const mins = Math.floor(elapsed / 60000),
				secs = Math.floor((elapsed % 60000) / 1000);
			const durText = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
			const bw2 = ctx.measureText(durText).width + 6;
			ctx.fillStyle = isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.85)";
			rr(ctx, drawX + SW / 2 - 1 - bw2, mY - 3.5, bw2, 7, 2);
			ctx.fill();
			ctx.strokeStyle = isDark ? "rgba(148,163,184,0.3)" : "rgba(0,0,0,0.15)";
			ctx.lineWidth = 0.5;
			rr(ctx, drawX + SW / 2 - 1 - bw2, mY - 3.5, bw2, 7, 2);
			ctx.stroke();
			ctx.fillStyle = isDark ? "#cbd5e1" : "#334155";
			ctx.font = arenaFont(ARENA_TEXT_MICRO, undefined, true);
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(durText, drawX + SW / 2 - 1 - bw2 / 2, mY);
		}
	}

	// Handoff badge
	if (task.hasPendingHandoff) {
		const bx = drawX + SW / 2,
			by = mY - 1;
		ctx.fillStyle = "#f59e0b";
		if (!reducedTransparency) {
			ctx.shadowColor = "#f59e0b";
			ctx.shadowBlur = 8;
		}
		ctx.beginPath();
		ctx.arc(bx, by, 5, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.strokeStyle = "#ffffff";
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(bx, by, 5, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = "#1a1a1a";
		ctx.font = arenaFont(ARENA_TEXT_LABEL, "bold");
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("!", bx, by);
	}
}

// ── Simplified workstation (LOD_SIMPLIFIED) ───────────────────────────────
export function drawWorkstationSimplified(rc: RenderCtx, task: VisualTask) {
	const { ctx, isDark } = rc;
	const x = task.x,
		y = task.y;
	const active = !!task.claimedByAgentId;
	const DW = 50,
		DH = 14;

	ctx.fillStyle = "rgba(0,0,0,0.12)";
	rr(ctx, x - DW / 2 + 2, y - DH / 2 + 3, DW, DH, 4);
	ctx.fill();
	const deskGrd = ctx.createLinearGradient(x - DW / 2, y - DH / 2, x + DW / 2, y + DH / 2);
	deskGrd.addColorStop(0, isDark ? "#1e2840" : "#d4dce8");
	deskGrd.addColorStop(1, isDark ? "#18202e" : "#c0ccd8");
	ctx.fillStyle = deskGrd;
	rr(ctx, x - DW / 2, y - DH / 2, DW, DH, 4);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#2d3a50" : "#a0b0c0";
	ctx.lineWidth = 0.75;
	rr(ctx, x - DW / 2, y - DH / 2, DW, DH, 4);
	ctx.stroke();

	const stripeColor =
		task.priorityLevel === "p0"
			? "#ef4444"
			: task.priorityLevel === "p1"
				? "#f59e0b"
				: task.priorityLevel === "p2"
					? "#3b82f6"
					: "#64748b";
	ctx.fillStyle = stripeColor;
	rr(ctx, x - DW / 2, y - DH / 2, 3, DH, 4);
	ctx.fill();
	ctx.fillRect(x - DW / 2, y - DH / 2 + 2, 3, DH - 4);

	ctx.fillStyle = active ? "rgba(255,255,255,0.9)" : isDark ? "#374151" : "#6b7280";
	ctx.font = arenaFont(ARENA_TEXT_LABEL, "bold", true);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(`${task.repo.split("/").pop()?.slice(0, 5)}·${task.taskCode}`.slice(0, 12), x, y);

	if (task.retryCount > 0) {
		const bt = `${task.retryCount + 1}`;
		ctx.fillStyle = rgba("#06B6D4", 0.9);
		ctx.beginPath();
		ctx.arc(x + DW / 2 - 2, y - DH / 2 - 2, 5, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#ffffff";
		ctx.font = arenaFont(ARENA_TEXT_MICRO, "bold", true);
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(bt, x + DW / 2 - 2, y - DH / 2 - 2);
	}

	ctx.fillStyle = isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.55)";
	ctx.font = arenaFont(ARENA_TEXT_MICRO);
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.fillText(task.title.slice(0, 12), x, y + DH / 2 + 2);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function drawBlockedBadge(rc: RenderCtx, task: VisualTask, drawX: number, mY: number, SW: number, ts: number) {
	const { ctx } = rc;
	const bc = blockedReasonColor(task.blockedReason!);
	const icon = blockedReasonIcon(task.blockedReason!);
	const text = task.blockedReason!.length > 10 ? task.blockedReason!.slice(0, 9) + "…" : task.blockedReason!;
	const badgeText = `${icon} ${text}`;
	const bw = Math.max(ctx.measureText(badgeText).width + 8, 10);
	const pulse = 0.8 + 0.2 * Math.sin(ts * 0.004);
	ctx.save();
	ctx.globalAlpha = pulse;
	ctx.fillStyle = bc;
	rr(ctx, drawX + SW / 2 - bw + 3, mY, bw, 8, 4);
	ctx.fill();
	if (!rc.reducedTransparency) {
		ctx.shadowColor = bc;
		ctx.shadowBlur = 4 + 2 * Math.sin(ts * 0.005);
	}
	rr(ctx, drawX + SW / 2 - bw + 3, mY, bw, 8, 4);
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.strokeStyle = rgba(bc, 0.6);
	ctx.lineWidth = 0.5;
	rr(ctx, drawX + SW / 2 - bw + 3, mY, bw, 8, 4);
	ctx.stroke();
	ctx.fillStyle = "#ffffff";
	ctx.font = arenaFont(ARENA_TEXT_MICRO, undefined, true);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(badgeText, drawX + SW / 2 - bw / 2 + 3, mY + 4);
	ctx.restore();
}

function blockedReasonColor(reason: string): string {
	const colors: Record<string, string> = {
		dependency: "#F59E0B",
		"rate-limit": "#F97316",
		human: "#3B82F6",
		conflict: "#EF4444",
		token: "#A855F7",
		memory: "#EC4899",
		tool: "#6B7280"
	};
	return colors[reason] ?? "#EF4444";
}

function blockedReasonIcon(reason: string): string {
	const icons: Record<string, string> = {
		dependency: "🔗",
		"rate-limit": "⏱",
		human: "👤",
		conflict: "🔀",
		token: "💰",
		memory: "🧠",
		tool: "⚙"
	};
	return icons[reason] ?? "⛔";
}
