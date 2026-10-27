import { get } from "svelte/store";
import { api } from "../api";
import { copyToClipboard } from "../utils";
import { confirmDelete, alertError } from "../confirm";
import type { CodingStandard } from "../stores";
import type { DetailState, DetailUpdate } from "./useDetailTypes";
import { INITIAL_STANDARD_FORM as INIT_STD } from "./useDetailTypes";

function splitList(value: string) {
	return [
		...new Set(
			value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean)
		)
	];
}

function parseMetadata(value: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0
			? parsed
			: null;
	} catch {
		return null;
	}
}

function stringifyMetadata(value: Record<string, unknown>) {
	return JSON.stringify(value, null, 2);
}

export function createDetailStandard(subscribe: (run: (s: DetailState) => void) => () => void, update: DetailUpdate) {
	function setStandard(standard: CodingStandard | null) {
		if (standard) {
			update((s) => ({
				...s,
				standard,
				memory: null,
				task: null,
				handoff: null,
				standardEditing: false,
				standardForm: {
					name: standard.title,
					context: standard.context,
					version: standard.version,
					language: standard.language || "",
					stack: standard.stack.join(", "),
					tags: standard.tags.join(", "),
					metadata: stringifyMetadata(standard.metadata),
					content: standard.content,
					parent_id: standard.parent_id || ""
				},
				standardError: ""
			}));
		} else {
			update((s) => ({
				...s,
				standard: {
					id: "__new__",
					title: "",
					content: "",
					context: "general",
					version: "1.0.0",
					language: null,
					stack: [],
					tags: [],
					is_global: true,
					repo: null,
					parent_id: null,
					metadata: {},
					created_at: "",
					updated_at: "",
					hit_count: 0,
					last_used_at: null,
					agent: "",
					model: ""
				} as CodingStandard,
				memory: null,
				task: null,
				handoff: null,
				standardEditing: false,
				standardForm: { ...INIT_STD },
				standardError: ""
			}));
		}
	}

	function startStandardEdit() {
		update((s) => ({ ...s, standardEditing: true }));
	}

	function cancelStandardEdit() {
		const state = get({ subscribe });
		if (state.standard) {
			update((s) => ({
				...s,
				standardEditing: false,
				standardForm: {
					name: state.standard!.title,
					context: state.standard!.context,
					version: state.standard!.version,
					language: state.standard!.language || "",
					stack: state.standard!.stack.join(", "),
					tags: state.standard!.tags.join(", "),
					metadata: stringifyMetadata(state.standard!.metadata),
					content: state.standard!.content,
					parent_id: state.standard!.parent_id || ""
				}
			}));
		}
	}

	async function saveStandard(onUpdated: (standard: CodingStandard) => void, onClose: () => void, repo: string | null) {
		const state = get({ subscribe });
		const form = state.standardForm;
		const metadata = parseMetadata(form.metadata);
		if (!form.name.trim() || !form.content.trim() || splitList(form.tags).length === 0 || !metadata) return;

		update((s) => ({ ...s, standardSaving: true, standardError: "" }));
		try {
			if (!state.standard) {
				const result = await api.createStandard({
					title: form.name.trim(),
					content: form.content.trim(),
					parent_id: form.parent_id.trim() || undefined,
					context: form.context.trim() || "general",
					version: form.version.trim() || "1.0.0",
					language: form.language.trim() || undefined,
					stack: splitList(form.stack),
					tags: splitList(form.tags),
					metadata,
					repo: repo,
					is_global: false
				});
				onUpdated(result);
			} else {
				await api.updateStandard(state.standard.id, {
					title: form.name.trim(),
					content: form.content.trim(),
					parent_id: form.parent_id.trim() || null,
					context: form.context.trim() || "general",
					version: form.version.trim() || "1.0.0",
					language: form.language.trim() || undefined,
					stack: splitList(form.stack),
					tags: splitList(form.tags),
					metadata,
					repo: state.standard.repo || repo,
					is_global: state.standard.is_global
				});
				const updated = {
					...state.standard,
					title: form.name.trim(),
					content: form.content.trim(),
					updated_at: new Date().toISOString()
				};
				onUpdated(updated as CodingStandard);
			}
			onClose();
		} catch (e) {
			update((s) => ({
				...s,
				standardError: e instanceof Error ? e.message : "Failed to save standard."
			}));
		} finally {
			update((s) => ({ ...s, standardSaving: false }));
		}
	}

	async function deleteStandard(onDeleted: (id: string) => void, onClose: () => void) {
		const state = get({ subscribe });
		if (!state.standard) return;
		if (!(await confirmDelete(`Delete coding standard "${state.standard.title}"?`))) return;

		update((s) => ({ ...s, standardDeleting: true }));
		try {
			await api.deleteStandard(state.standard.id);
			onDeleted(state.standard.id);
			onClose();
		} catch (e: unknown) {
			alertError("Error deleting standard: " + (e instanceof Error ? e.message : String(e)));
		} finally {
			update((s) => ({ ...s, standardDeleting: false }));
		}
	}

	async function handleCopyStandardContent(text: string) {
		const success = await copyToClipboard(text);
		if (success) {
			update((s) => ({ ...s, contentCopied: true }));
			setTimeout(() => update((s) => ({ ...s, contentCopied: false })), 2000);
		}
	}

	return {
		setStandard,
		startStandardEdit,
		cancelStandardEdit,
		saveStandard,
		deleteStandard,
		handleCopyStandardContent
	};
}
