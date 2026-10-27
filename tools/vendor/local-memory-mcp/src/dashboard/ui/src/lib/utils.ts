// ─── Formatting utilities ─────────────────────────────────────────────────────

import { marked } from "marked";
import DOMPurify from "dompurify";
import { api } from "./api";
import { chatRefreshSignal } from "./stores";

export function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
	if (diff < 60) return `${diff}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
	return date.toLocaleDateString();
}

export function formatTokens(num: number | undefined): string {
	if (!num) return "0";
	if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
	if (num >= 1000) return (num / 1000).toFixed(1) + "k";
	return num.toString();
}

export function formatDuration(seconds: number | undefined): string {
	if (!seconds || seconds <= 0) return "0m";
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const minutes = seconds / 60;
	if (minutes < 60) return `${Math.round(minutes)}m`;
	const hours = minutes / 60;
	if (hours < 24) return `${Math.round(hours)}h`;
	return `${Math.round(hours / 24)}d`;
}

export function getRepoInitials(repo: string): string {
	return (
		repo
			.split(/[/ \-_.]/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() || "")
			.join("")
			.slice(0, 2) || "RP"
	);
}

export function getStatusColor(status: string): string {
	const colorMap: Record<string, string> = {
		backlog: "status-backlog",
		pending: "status-pending",
		in_progress: "status-inprogress",
		completed: "status-completed",
		blocked: "status-blocked",
		canceled: "status-canceled"
	};
	return colorMap[status] || "status-default";
}

export function getStatusLabel(status: string): string {
	const labels: Record<string, string> = {
		backlog: "Backlog",
		pending: "To Do",
		in_progress: "In Progress",
		completed: "Completed",
		blocked: "Blocked",
		canceled: "Canceled"
	};
	return labels[status] || status;
}

export function getPriorityLabel(priority: number): string {
	const labels: Record<number, string> = { 1: "Low", 2: "Normal", 3: "Medium", 4: "High", 5: "Critical" };
	return labels[priority] || String(priority);
}

export function getPriorityColor(priority: number): string {
	const colors: Record<number, string> = {
		1: "text-slate-500",
		2: "text-blue-500",
		3: "text-amber-500",
		4: "text-orange-500",
		5: "text-red-500"
	};
	return colors[priority] || "text-slate-500";
}

export function renderMarkdown(text: string): string {
	try {
		const html = marked.parse(text || "") as string;
		return DOMPurify.sanitize(html);
	} catch (err) {
		console.error("Markdown render error:", err);
		return text || "";
	}
}

export function exportToJSON(data: unknown, filename: string) {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export function exportToCSV(data: Record<string, unknown>[], filename: string) {
	if (!data.length) return;
	const keys = Object.keys(data[0]);
	const csv = [keys.join(","), ...data.map((row) => keys.map((k) => JSON.stringify(row[k] ?? "")).join(","))].join(
		"\n"
	);
	const blob = new Blob([csv], { type: "text/csv" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
	let timer: ReturnType<typeof setTimeout>;
	return ((...args: unknown[]) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	}) as unknown as T;
}

export async function copyToClipboard(text: string): Promise<boolean> {
	if (!text) return false;
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (err) {
		console.error("Failed to copy text: ", err);
		return false;
	}
}

/** Deduplicate a string array (e.g. tags) while preserving order. */
export function dedupeTags(tags: string[] | undefined): string[] {
	if (!tags || tags.length === 0) return [];
	return [...new Set(tags)];
}

export function chatTitle(): string {
	const now = new Date();
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	return `Chat · ${hh}:${mm}`;
}

export async function createChatTask(msg: string, repo: string): Promise<void> {
	const taskCode = "CHAT-" + Date.now().toString(36).toUpperCase();
	await api.createTask({
		repo,
		task_code: taskCode,
		title: chatTitle(),
		description: msg,
		status: "backlog",
		priority: 3,
		phase: "Inbox"
	});
	chatRefreshSignal.update((n) => n + 1);
}
