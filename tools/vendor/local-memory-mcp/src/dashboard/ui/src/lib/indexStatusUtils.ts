import type { CodebaseIndexStatus } from "./api";

export type StatusColor = "green" | "yellow" | "red";

export function computeStatusColor(status: CodebaseIndexStatus | null): StatusColor {
	if (!status || !status.indexed) return "red";
	if (!status.last_indexed_at) return "red";
	const elapsed = Date.now() - new Date(status.last_indexed_at).getTime();
	const ONE_HOUR = 60 * 60 * 1000;
	const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;
	if (elapsed < ONE_HOUR) return "green";
	if (elapsed > TWENTY_FOUR_HOURS) return "yellow";
	return "green";
}

export function getStatusColorVar(color: StatusColor): string {
	if (color === "green") return "rgba(34, 197, 94, 0.8)";
	if (color === "yellow") return "rgba(234, 179, 8, 0.8)";
	return "rgba(239, 68, 68, 0.8)";
}

export function getStatusBgVar(color: StatusColor): string {
	if (color === "green") return "rgba(34, 197, 94, 0.08)";
	if (color === "yellow") return "rgba(234, 179, 8, 0.08)";
	return "rgba(239, 68, 68, 0.08)";
}

export function computeRelativeTime(lastIndexedAt: string | null | undefined): string | null {
	if (!lastIndexedAt) return null;
	const diff = Date.now() - new Date(lastIndexedAt).getTime();
	if (diff < 0) return "just now";
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return "yesterday";
	return `${days}d ago`;
}
