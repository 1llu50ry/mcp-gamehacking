export function getHealthColor(health: string): string {
	switch (health) {
		case "healthy":
			return "#22C55E";
		case "degraded":
			return "#EAB308";
		case "critical":
			return "#EF4444";
		default:
			return "#9CA3AF";
	}
}

export function getHealthText(health: string): string {
	switch (health) {
		case "healthy":
			return "Healthy";
		case "degraded":
			return "Degraded";
		case "critical":
			return "Critical";
		default:
			return "Unknown";
	}
}

export function formatDuration(seconds: number): string {
	if (!seconds || seconds <= 0) return "N/A";
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const mins = Math.floor(seconds / 60);
	const secs = Math.round(seconds % 60);
	return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
