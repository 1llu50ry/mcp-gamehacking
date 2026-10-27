import type { EventLogEntry } from "./arena/arenaEvents";

export function getEventColor(entry: EventLogEntry): string {
	switch (entry.type) {
		case "task-completed":
			return "#22C55E";
		case "task-failed":
			return "#EF4444";
		case "task-blocked":
			return "#F59E0B";
		case "agent-connected":
			return "#10B981";
		case "agent-disconnected":
			return "#6B7280";
		case "memory-created":
		case "memory-updated":
			return "#A855F7";
		case "task-started":
			return "#3B82F6";
		case "task-created":
			return "#06B6D4";
		default:
			return "#64748B";
	}
}

export function getEventIcon(entry: EventLogEntry): string {
	switch (entry.type) {
		case "task-completed":
			return "circle-check";
		case "task-failed":
			return "circle-x";
		case "task-blocked":
			return "triangle-alert";
		case "task-started":
			return "clock";
		case "task-created":
			return "circle-dot";
		case "task-assigned":
			return "clipboard-list";
		case "agent-connected":
		case "agent-disconnected":
			return "zap";
		case "memory-created":
		case "memory-updated":
			return "brain";
		case "repository-locked":
		case "repository-unlocked":
			return "git-branch";
		default:
			return "activity";
	}
}

export function getEventLabel(entry: EventLogEntry): string {
	const ev = entry.event;
	if (!ev) return entry.detail;
	switch (ev.type) {
		case "task-completed":
			return `Task Completed ${ev.taskId} · by ${ev.agentId}`;
		case "task-failed":
			return `Task Failed ${ev.taskId} · by ${ev.agentId}`;
		case "task-blocked":
			return `Task Blocked ${ev.taskId} · ${ev.reason}`;
		case "task-started":
			return `Task Started ${ev.taskId} · by ${ev.agentId}`;
		case "task-created":
			return `Task Created ${ev.taskId} · ${ev.title}`;
		case "task-assigned":
			return `Task Assigned ${ev.taskId} · to ${ev.agentId}`;
		case "task-progressed":
			return `Task Progress ${ev.taskId} · ${Math.round(ev.progress * 100)}%`;
		case "task-unblocked":
			return `Task Unblocked ${ev.taskId}`;
		case "task-retry-scheduled":
			return `Task Retry ${ev.taskId} · attempt ${ev.attempt}/${ev.maxRetries}`;
		case "agent-connected":
			return `Agent Connected ${ev.name} (${ev.role})`;
		case "agent-disconnected":
			return `Agent Disconnected ${ev.agentId}`;
		case "memory-created":
			return `Memory Created · by ${ev.agentId}`;
		case "memory-updated":
			return `Memory Updated · by ${ev.agentId}`;
		case "repository-locked":
			return `Repo Locked ${ev.repositoryId} · file: ${ev.file}`;
		case "repository-unlocked":
			return `Repo Unlocked ${ev.repositoryId}`;
		default:
			return entry.detail;
	}
}

export function formatTime(timestamp: number): string {
	const d = new Date(timestamp);
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
