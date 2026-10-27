import { writable, get } from "svelte/store";
import { api } from "../api";
import { currentRepo } from "../stores";
import { confirmDelete } from "../confirm";
import type { Memory } from "../stores";

export interface MemoryForm {
	title: string;
	type: string;
	content: string;
	importance: number;
	tags: string;
	agent: string;
	model: string;
}

export interface UseMemoryProps {
	onSaved: (mem: Memory) => void;
	onDeleted: (id: string) => void;
	onClose: () => void;
}

export function createMemoryHandler(props: UseMemoryProps) {
	const form = writable<MemoryForm>({
		title: "",
		type: "code_fact",
		content: "",
		importance: 3,
		tags: "",
		agent: "",
		model: ""
	});

	const editing = writable(false);
	const saving = writable(false);
	const deleting = writable(false);
	const error = writable("");
	const previewMode = writable(false);

	let currentMemory: Memory | null = null;

	function reset(memory: Memory | null) {
		currentMemory = memory;
		if (memory) {
			form.set({
				title: memory.title,
				type: memory.type,
				content: memory.content,
				importance: memory.importance,
				tags: (memory.tags || []).join(", "),
				agent: memory.agent || "",
				model: memory.model || ""
			});
			editing.set(false);
		} else {
			form.set({
				title: "",
				type: "code_fact",
				content: "",
				importance: 3,
				tags: "",
				agent: "",
				model: ""
			});
			editing.set(true);
		}
		previewMode.set(false);
		error.set("");
		saving.set(false);
		deleting.set(false);
	}

	function parseTags(raw: string): string[] {
		return [
			...new Set(
				raw
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			)
		];
	}

	async function save() {
		const currentForm = get(form);
		if (!currentForm.title.trim() || !currentForm.content.trim()) {
			error.set("Title and Content are required.");
			return;
		}

		saving.set(true);
		error.set("");

		try {
			const repo = get(currentRepo);
			const payload: Partial<Memory> & { repo: string | null } = {
				title: currentForm.title.trim(),
				type: currentForm.type,
				content: currentForm.content.trim(),
				importance: Number(currentForm.importance),
				tags: parseTags(currentForm.tags),
				agent: currentForm.agent.trim() || undefined,
				model: currentForm.model.trim() || undefined,
				repo: repo,
				scope: { repo: repo || "" }
			};

			let result: Memory;
			if (!currentMemory) {
				const res = await api.createMemory(payload);
				result = {
					...payload,
					id: res.id,
					hit_count: 0,
					recall_count: 0,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString()
				} as Memory;
			} else {
				await api.updateMemory(currentMemory.id, payload);
				result = {
					...currentMemory,
					...payload,
					updated_at: new Date().toISOString()
				} as Memory;
			}

			props.onSaved(result);
			props.onClose();
		} catch (e) {
			error.set(e instanceof Error ? e.message : "Failed to save memory.");
		} finally {
			saving.set(false);
		}
	}

	async function deleteMemory() {
		if (!currentMemory) return;
		if (!(await confirmDelete("Permanently delete this memory? This cannot be undone."))) return;

		deleting.set(true);
		error.set("");

		try {
			await api.deleteMemory(currentMemory.id);
			props.onDeleted(currentMemory.id);
			props.onClose();
		} catch (e) {
			error.set(e instanceof Error ? e.message : "Failed to delete memory.");
		} finally {
			deleting.set(false);
		}
	}

	return {
		form,
		editing,
		saving,
		deleting,
		error,
		previewMode,
		reset,
		save,
		deleteMemory,
		startEditing: () => {
			editing.set(true);
			previewMode.set(false);
		},
		cancelEdit: () => {
			if (!currentMemory) {
				props.onClose();
			} else {
				// Re-reset to original state
				reset(currentMemory);
				editing.set(false);
			}
		},
		togglePreview: () => previewMode.update((v) => !v)
	};
}
