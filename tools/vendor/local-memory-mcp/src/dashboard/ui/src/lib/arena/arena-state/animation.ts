// ── Visual effect builders for domain events ──────────────────────────────

export interface VisualEffectSpec {
	type: string;
	entityId: string;
	entityType: string;
	intensity: number;
	duration: number;
}

export function healthCriticalEffect(agentId: string): VisualEffectSpec {
	return { type: "error-flash", entityId: agentId, entityType: "agent", intensity: 1, duration: 500 };
}

export function blockedTaskEffect(taskId: string): VisualEffectSpec {
	return { type: "blocked-pulse", entityId: taskId, entityType: "task", intensity: 0.5, duration: 800 };
}

export function retryScheduledEffect(taskId: string, backoffSeconds: number): VisualEffectSpec {
	return { type: "cooldown", entityId: taskId, entityType: "task", intensity: 0.3, duration: backoffSeconds * 1000 };
}

export function taskCompletedEffect(taskId: string): VisualEffectSpec {
	return { type: "celebration", entityId: taskId, entityType: "task", intensity: 1, duration: 1500 };
}

export function taskFailedEffect(taskId: string): VisualEffectSpec {
	return { type: "error-flash", entityId: taskId, entityType: "task", intensity: 1, duration: 600 };
}

export function memorySyncEffect(agentId: string): VisualEffectSpec {
	return { type: "memory-sync", entityId: agentId, entityType: "agent", intensity: 0.4, duration: 2000 };
}
