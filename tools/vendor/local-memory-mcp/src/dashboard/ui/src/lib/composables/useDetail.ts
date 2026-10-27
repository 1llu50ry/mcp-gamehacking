import { writable, get, derived } from "svelte/store";
import { api } from "../api";
import { copyToClipboard } from "../utils";
import { confirmDelete, alertError } from "../confirm";
import type { Memory, Task, TaskComment, CodingStandard } from "../stores";
import type { DetailState } from "./useDetailTypes";
import { INITIAL_STANDARD_FORM, INITIAL_HANDOFF_FORM } from "./useDetailTypes";
import { createDetailStandard } from "./useDetailStandard";
import { createDetailHandoff } from "./useDetailHandoff";

export const STATUS_FLOW: Record<string, { next: string; label: string; color: string }[]> = {
	backlog: [{ next: "pending", label: "Move to To Do", color: "#0ea5e9" }],
	pending: [{ next: "in_progress", label: "Start Progress", color: "#a855f7" }],
	in_progress: [
		{ next: "completed", label: "Mark Complete", color: "#10b981" },
		{ next: "blocked", label: "Mark Blocked", color: "#ef4444" }
	],
	blocked: [{ next: "in_progress", label: "Resume Progress", color: "#a855f7" }],
	completed: [],
	canceled: []
};

export function createDetailHandler() {
	const initialState: DetailState = {
		memory: null,
		task: null,
		standard: null,
		handoff: null,
		editingTitle: false,
		editingDescription: false,
		editTitle: "",
		editDescription: "",
		newComment: "",
		postingComment: false,
		editingCommentId: null,
		editCommentText: "",
		savingComment: false,
		contentCopied: false,
		descCopied: false,
		standardEditing: false,
		standardForm: { ...INITIAL_STANDARD_FORM },
		standardSaving: false,
		standardDeleting: false,
		standardError: "",
		handoffCreating: false,
		handoffUpdating: false,
		handoffForm: { ...INITIAL_HANDOFF_FORM },
		handoffError: ""
	};

	const { subscribe, update } = writable<DetailState>(initialState);
	const standardApi = createDetailStandard(subscribe, update);
	const handoffApi = createDetailHandoff(subscribe, update);

	const mode = derived({ subscribe }, ($s) => {
		return $s.task ? "task" : $s.memory ? "memory" : $s.handoff ? "handoff" : $s.standard ? "standard" : null;
	});

	async function handleCopyContent(text: string) {
		const success = await copyToClipboard(text);
		if (success) {
			update((s) => ({ ...s, contentCopied: true }));
			setTimeout(() => update((s) => ({ ...s, contentCopied: false })), 2000);
		}
	}

	async function handleCopyDesc(text: string) {
		const success = await copyToClipboard(text);
		if (success) {
			update((s) => ({ ...s, descCopied: true }));
			setTimeout(() => update((s) => ({ ...s, descCopied: false })), 2000);
		}
	}

	async function saveField<K extends keyof Task>(field: K, value: Task[K], onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		if (!state.task) return;

		try {
			const updatedTask = await api.updateTask(state.task.id, { [field]: value });
			update((s) => ({ ...s, task: updatedTask }));
			onUpdated(updatedTask);
		} catch (e) {
			console.error(`Failed to update task field ${String(field)}:`, e);
			throw e;
		}
	}

	async function saveTitle(onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		const title = state.editTitle.trim();
		if (!title) return;

		await saveField("title", title, onUpdated);
		update((s) => ({ ...s, editingTitle: false }));
	}

	async function saveDescription(onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		await saveField("description", state.editDescription, onUpdated);
		update((s) => ({ ...s, editingDescription: false }));
	}

	async function advanceStatus(next: string, onUpdated: (task: Task) => void) {
		await saveField("status", next, onUpdated);
	}

	async function postComment(onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		if (!state.task || !state.newComment.trim()) return;

		update((s) => ({ ...s, postingComment: true }));
		try {
			const refreshed = await api.updateTask(state.task.id, { comment: state.newComment.trim() });
			update((s) => ({ ...s, task: refreshed, newComment: "" }));
			onUpdated(refreshed);
		} catch (e) {
			console.error("Failed to post comment:", e);
		} finally {
			update((s) => ({ ...s, postingComment: false }));
		}
	}

	async function saveEditComment(onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		if (!state.editingCommentId || !state.editCommentText.trim()) return;

		update((s) => ({ ...s, savingComment: true }));
		try {
			await api.updateTaskComment(state.editingCommentId, state.editCommentText.trim());
			if (state.task) {
				const refreshed = await api.taskById(state.task.id);
				if (refreshed) {
					update((s) => ({ ...s, task: refreshed }));
					onUpdated(refreshed);
				}
			}
			update((s) => ({ ...s, editingCommentId: null, editCommentText: "" }));
		} catch (e) {
			console.error("Failed to update comment:", e);
		} finally {
			update((s) => ({ ...s, savingComment: false }));
		}
	}

	async function deleteComment(commentId: string, onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		if (!(await confirmDelete("Delete this comment?"))) return;

		try {
			await api.deleteTaskComment(commentId);
			if (state.task) {
				const refreshed = await api.taskById(state.task.id);
				if (refreshed) {
					update((s) => ({ ...s, task: refreshed }));
					onUpdated(refreshed);
				}
			}
		} catch (e) {
			console.error("Failed to delete comment:", e);
		}
	}

	async function deleteTask(onDeleted: (id: string) => void, onClose: () => void) {
		const state = get({ subscribe });
		if (!state.task) return;

		if (await confirmDelete("Are you sure you want to delete this task?")) {
			try {
				await api.deleteTask(state.task.id);
				onDeleted(state.task.id);
				onClose();
			} catch (e: unknown) {
				alertError("Error deleting task: " + (e instanceof Error ? e.message : String(e)));
			}
		}
	}

	return {
		subscribe,
		mode,
		setMemory: (memory: Memory | null) => update((s) => ({ ...s, memory, task: null, standard: null, handoff: null })),
		setTask: (task: Task | null) => {
			if (task) {
				update((s) => ({
					...s,
					task,
					memory: null,
					standard: null,
					handoff: null,
					editTitle: task.title,
					editDescription: task.description || "",
					editingTitle: false,
					editingDescription: false,
					newComment: "",
					editingCommentId: null
				}));
			} else {
				update((s) => ({ ...s, task: null }));
			}
		},
		toggleEditTitle: (val: boolean) => update((s) => ({ ...s, editingTitle: val })),
		toggleEditDescription: (val: boolean) => update((s) => ({ ...s, editingDescription: val })),
		setEditTitle: (val: string) => update((s) => ({ ...s, editTitle: val })),
		setEditDescription: (val: string) => update((s) => ({ ...s, editDescription: val })),
		setNewComment: (val: string) => update((s) => ({ ...s, newComment: val })),
		startEditComment: (comment: TaskComment) =>
			update((s) => ({
				...s,
				editingCommentId: comment.id,
				editCommentText: comment.comment
			})),
		cancelEditComment: () =>
			update((s) => ({
				...s,
				editingCommentId: null,
				editCommentText: ""
			})),
		setEditCommentText: (val: string) => update((s) => ({ ...s, editCommentText: val })),
		handleCopyContent,
		handleCopyDesc,
		saveTitle,
		saveDescription,
		advanceStatus,
		postComment,
		saveEditComment,
		deleteComment,
		deleteTask,
		handleCommentKeydown: (e: KeyboardEvent, onUpdated: (task: Task) => void) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) postComment(onUpdated);
		},
		reset: () => {
			update((s) => ({
				...s,
				memory: null,
				task: null,
				standard: null,
				handoff: null,
				editingTitle: false,
				editingDescription: false,
				editTitle: "",
				editDescription: "",
				newComment: "",
				editingCommentId: null,
				editCommentText: "",
				postingComment: false,
				savingComment: false,
				contentCopied: false,
				descCopied: false,
				standardEditing: false,
				standardForm: { ...INITIAL_STANDARD_FORM },
				standardSaving: false,
				standardDeleting: false,
				standardError: "",
				handoffCreating: false,
				handoffUpdating: false,
				handoffForm: { ...INITIAL_HANDOFF_FORM },
				handoffError: ""
			}));
		},
		handleTitleKeydown: (e: KeyboardEvent, onUpdated: (task: Task) => void) => {
			if (e.key === "Enter") saveTitle(onUpdated);
			if (e.key === "Escape") update((s) => ({ ...s, editingTitle: false }));
		},
		...standardApi,
		...handoffApi
	};
}

export interface DetailHandler {
	subscribe: (run: (state: DetailState) => void) => () => void;
	mode: { subscribe: (run: (mode: string | null) => void) => () => void };
	setMemory: (memory: import("../stores").Memory | null) => void;
	setTask: (task: import("../stores").Task | null) => void;
	toggleEditTitle: (val: boolean) => void;
	toggleEditDescription: (val: boolean) => void;
	setEditTitle: (val: string) => void;
	setEditDescription: (val: string) => void;
	setNewComment: (val: string) => void;
	startEditComment: (comment: import("../stores").TaskComment) => void;
	cancelEditComment: () => void;
	setEditCommentText: (val: string) => void;
	handleCopyContent: (text: string) => Promise<void>;
	handleCopyDesc: (text: string) => Promise<void>;
	saveTitle: (onUpdated: (task: import("../stores").Task) => void) => Promise<void>;
	saveDescription: (onUpdated: (task: import("../stores").Task) => void) => Promise<void>;
	advanceStatus: (next: string, onUpdated: (task: import("../stores").Task) => void) => Promise<void>;
	postComment: (onUpdated: (task: import("../stores").Task) => void) => Promise<void>;
	saveEditComment: (onUpdated: (task: import("../stores").Task) => void) => Promise<void>;
	deleteComment: (commentId: string, onUpdated: (task: import("../stores").Task) => void) => Promise<void>;
	deleteTask: (onDeleted: (id: string) => void, onClose: () => void) => Promise<void>;
	handleCommentKeydown: (e: KeyboardEvent, onUpdated: (task: import("../stores").Task) => void) => void;
	reset: () => void;
	handleTitleKeydown: (e: KeyboardEvent, onUpdated: (task: import("../stores").Task) => void) => void;
	setStandard: (standard: import("../stores").CodingStandard | null) => void;
	startStandardEdit: () => void;
	cancelStandardEdit: () => void;
	saveStandard: (
		onUpdated: (standard: import("../stores").CodingStandard) => void,
		onClose: () => void,
		repo: string | null
	) => Promise<void>;
	deleteStandard: (onDeleted: (id: string) => void, onClose: () => void) => Promise<void>;
	handleCopyStandardContent: (text: string) => Promise<void>;
	setHandoff: (handoff: import("../stores").Handoff | null) => void;
	initNewHandoff: (repoName: string) => void;
	createHandoff: (onCreated: () => void, repo: string) => Promise<void>;
	updateHandoffStatus: (status: string, onUpdated: () => void) => Promise<void>;
	handleCopyHandoffContext: (context: Record<string, unknown>) => Promise<void>;
}
