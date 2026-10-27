import type { VisualAgent, ZoneRect } from "../arenaTypes";
import {
	SPEED_WALK,
	SPEED_WANDER,
	ARRIVE_DIST,
	WANDER_INT,
	WANDER_PAUSE,
	HANDOFF_SPEED,
	PICKUP_DURATION,
	ARRIVE_DURATION
} from "./utils";

// ── Agent physics update (movement, wander, handoff) ──────────────────────
export function updateAgents(
	agents: Map<string, VisualAgent>,
	wander: Map<string, { nextPickAt: number }>,
	idleZone: ZoneRect,
	dt: number,
	ts: number,
	reducedMotion: boolean,
	updateHandoffAnim: (a: VisualAgent, dt: number, ts: number) => void
) {
	for (const a of agents.values()) {
		if (reducedMotion) {
			a.x = a.targetX;
			a.y = a.targetY;
			a.vx = 0;
			a.vy = 0;
			a.walkPhase = 0;
			if (a.handoffAnim) {
				a.handoffAnim.phase = "resting";
				a.handoffAnim.progress = 1;
				a.x = a.handoffAnim.endX;
				a.y = a.handoffAnim.endY;
			}
			continue;
		}
		if (a.handoffAnim) {
			updateHandoffAnim(a, dt, ts);
			continue;
		}

		if (a.state === "idle") {
			let ws = wander.get(a.id);
			if (!ws) {
				ws = { nextPickAt: ts };
				wander.set(a.id, ws);
			}
			if (ts >= ws.nextPickAt) {
				const pad = 22,
					lh = 26;
				a.targetX = idleZone.x + pad + Math.random() * (idleZone.w - pad * 2);
				a.targetY = idleZone.y + lh + pad + Math.random() * (idleZone.h - lh - pad * 2);
				const pause = WANDER_PAUSE[0] + Math.random() * (WANDER_PAUSE[1] - WANDER_PAUSE[0]);
				const travel = WANDER_INT[0] + Math.random() * (WANDER_INT[1] - WANDER_INT[0]);
				ws.nextPickAt = ts + pause + travel;
			}
			if (Math.random() < 0.005) {
				const facings = ["up", "down", "left", "right"] as const;
				a.facing = facings[Math.floor(Math.random() * facings.length)];
			}
		} else {
			wander.delete(a.id);
		}

		const dx = a.targetX - a.x,
			dy = a.targetY - a.y;
		const dist = Math.hypot(dx, dy);
		if (dist < ARRIVE_DIST) {
			a.vx *= 0.75;
			a.vy *= 0.75;
			if (Math.abs(a.vx) < 0.5) a.vx = 0;
			if (Math.abs(a.vy) < 0.5) a.vy = 0;
		} else {
			const spd = a.state === "idle" ? SPEED_WANDER : SPEED_WALK;
			const ease = dist < 50 ? spd * (dist / 50) + 8 : spd;
			a.vx += ((dx / dist) * ease - a.vx) * 0.1;
			a.vy += ((dy / dist) * ease - a.vy) * 0.1;
		}
		a.x += a.vx * dt;
		a.y += a.vy * dt;
		const spd2 = Math.hypot(a.vx, a.vy);
		if (spd2 > 5) {
			a.walkPhase = (a.walkPhase + dt * spd2 * 0.07) % (Math.PI * 2);
			a.facing = Math.abs(a.vx) > Math.abs(a.vy) ? (a.vx > 0 ? "right" : "left") : a.vy > 0 ? "down" : "up";
		} else {
			a.walkPhase = a.walkPhase > 0.05 ? a.walkPhase * 0.85 : 0;
		}
	}
}

// ── Handoff animation state machine ──────────────────────────────────────
export function updateHandoffAnim(a: VisualAgent, dt: number, ts: number) {
	const h = a.handoffAnim!;
	const elapsed = ts - h.phaseStartTs;
	switch (h.phase) {
		case "pickup": {
			a.vx = 0;
			a.vy = 0;
			a.walkPhase = 0;
			if (elapsed >= PICKUP_DURATION) {
				h.phase = "moving";
				h.phaseStartTs = ts;
				h.progress = 0;
			}
			break;
		}
		case "moving": {
			const totalDist = Math.hypot(h.endX - h.startX, h.endY - h.startY);
			const travelTime = totalDist / HANDOFF_SPEED;
			h.progress = Math.min(1, h.progress + dt / travelTime);
			const t = h.progress,
				ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
			a.x = h.startX + (h.endX - h.startX) * ease;
			a.y = h.startY + (h.endY - h.startY) * ease;
			a.vx = 0;
			a.vy = 0;
			h.wheelAngle = (h.wheelAngle + totalDist * (dt / travelTime) * 0.15) % (Math.PI * 2);
			h.helperWalkPhase = (h.helperWalkPhase + dt * HANDOFF_SPEED * 0.08) % (Math.PI * 2);
			h.stepBounce = Math.sin(h.helperWalkPhase * 2) * 1.5;
			const mdx = h.endX - h.startX,
				mdy = h.endY - h.startY;
			h.helperFacing = Math.abs(mdx) > Math.abs(mdy) ? (mdx > 0 ? "right" : "left") : mdy > 0 ? "down" : "up";
			if (h.progress >= 1) {
				h.phase = "arrive";
				h.phaseStartTs = ts;
				a.x = h.endX;
				a.y = h.endY;
			}
			break;
		}
		case "arrive": {
			a.x = h.endX;
			a.y = h.endY;
			a.vx = 0;
			a.vy = 0;
			a.walkPhase = 0;
			h.helperWalkPhase = h.helperWalkPhase > 0.05 ? h.helperWalkPhase * 0.92 : 0;
			if (elapsed >= ARRIVE_DURATION) {
				h.phase = "resting";
				h.phaseStartTs = ts;
				a.targetX = h.endX;
				a.targetY = h.endY;
			}
			break;
		}
		case "resting": {
			a.x = h.endX;
			a.y = h.endY;
			a.vx = 0;
			a.vy = 0;
			a.walkPhase = 0;
			break;
		}
	}
}
