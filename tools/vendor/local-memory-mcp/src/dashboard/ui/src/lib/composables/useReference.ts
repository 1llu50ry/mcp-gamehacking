import { writable, get, derived } from "svelte/store";
import { api } from "../api";
import { copyToClipboard } from "../utils";
import type { ReferenceItem } from "../stores";

export interface ReferenceState {
	item: ReferenceItem | null;
	toolArgs: Record<string, string>;
	toolRunning: boolean;
	toolResult: string | null;
	toolError: string | null;
	copied: boolean;
}

export function createReferenceHandler() {
	const state = writable<ReferenceState>({
		item: null,
		toolArgs: {},
		toolRunning: false,
		toolResult: null,
		toolError: null,
		copied: false
	});

	const { subscribe, update } = state;

	const typeLabel = derived(state, ($s) => {
		if (!$s.item?.type) return "";
		return $s.item.type.charAt(0).toUpperCase() + $s.item.type.slice(1);
	});

	function setItem(item: ReferenceItem | null, currentRepo: string | null) {
		const current = get(state).item;
		if (current === item) return;

		update((s) => {
			const toolArgs: Record<string, string> = {};
			if (item && item.type === "tool" && item.data?.inputSchema?.properties?.repo && currentRepo) {
				toolArgs["repo"] = currentRepo;
			}
			return {
				...s,
				item,
				toolArgs,
				toolResult: null,
				toolError: null,
				toolRunning: false
			};
		});
	}

	function setToolArg(key: string, value: string) {
		update((s) => ({ ...s, toolArgs: { ...s.toolArgs, [key]: value } }));
	}

	async function runTool() {
		const stateVal = get(state);
		const item = stateVal.item;
		if (!item || item.type !== "tool") return;

		update((s) => ({ ...s, toolRunning: true, toolResult: null, toolError: null }));

		try {
			const parsedArgs: Record<string, unknown> = {};

			if (item.data.inputSchema?.properties) {
				for (const [k, v] of Object.entries(stateVal.toolArgs)) {
					if (v === undefined || v === "") continue;
					try {
						parsedArgs[k] = JSON.parse(v);
					} catch {
						parsedArgs[k] = v;
					}
				}
			}

			const result = await api.callTool(item.data.name, parsedArgs);
			update((s) => ({ ...s, toolResult: JSON.stringify(result, null, 2) }));
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			update((s) => ({ ...s, toolError: message }));
		} finally {
			update((s) => ({ ...s, toolRunning: false }));
		}
	}

	async function copyToClipboardWrapper(text: string) {
		const success = await copyToClipboard(text);
		if (success) {
			update((s) => ({ ...s, copied: true }));
			setTimeout(() => update((s) => ({ ...s, copied: false })), 2000);
		}
	}

	function handleOverlayClick(e: MouseEvent, onClose: () => void) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handlePanelClick(e: MouseEvent) {
		e.stopPropagation();
	}

	function reset() {
		update((s) => ({
			...s,
			item: null,
			toolArgs: {},
			toolRunning: false,
			toolResult: null,
			toolError: null,
			copied: false
		}));
	}

	return {
		subscribe,
		typeLabel,
		setItem,
		setToolArg,
		runTool,
		copyToClipboardWrapper,
		handleOverlayClick,
		handlePanelClick,
		reset
	};
}
