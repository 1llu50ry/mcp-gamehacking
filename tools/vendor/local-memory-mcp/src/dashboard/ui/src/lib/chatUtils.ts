import { get } from "svelte/store";
import { currentRepo, recentActions, recentActionsPage, recentActionsTotalItems } from "./stores";
import { api } from "./api";
import { createChatTask } from "./utils";

export async function loadPage(page: number, append?: boolean) {
	const repo = get(currentRepo);
	if (!repo) return;
	try {
		const data = await api.recentActions(repo, page, 25);
		if (append) {
			recentActions.update((a) => [...a, ...(data.actions || [])]);
		} else {
			recentActions.set(data.actions || []);
		}
		recentActionsPage.set(data.pagination?.page ?? page);
		recentActionsTotalItems.set(data.pagination?.totalItems ?? 0);
	} catch (e) {
		console.error("Failed to load recent actions:", e);
	}
}

export async function sendChatMessage(msg: string, onRefresh: () => void): Promise<void> {
	const repo = get(currentRepo);
	if (!repo) return;
	await createChatTask(msg, repo);
	await loadPage(1);
	onRefresh();
}
