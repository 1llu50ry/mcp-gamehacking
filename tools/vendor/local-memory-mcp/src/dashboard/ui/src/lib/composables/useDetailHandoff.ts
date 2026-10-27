import { get } from "svelte/store";
import { api } from "../api";
import { copyToClipboard } from "../utils";
import type { Handoff } from "../stores";
import type { DetailState, DetailUpdate } from "./useDetailTypes";
import { INITIAL_HANDOFF_FORM } from "./useDetailTypes";

export function createDetailHandoff(subscribe: (run: (s: DetailState) => void) => () => void, update: DetailUpdate) {
	function setHandoff(handoff: Handoff | null) {
		if (handoff) {
			update((s) => ({
				...s,
				handoff,
				task: null,
				memory: null,
				standard: null,
				handoffForm: {
					from_agent: handoff.from_agent,
					to_agent: handoff.to_agent || "",
					task_code: handoff.task_code || "",
					summary: handoff.summary,
					context: JSON.stringify(handoff.context, null, 2)
				},
				handoffError: ""
			}));
		} else {
			update((s) => ({ ...s, handoff: null, handoffForm: { ...INITIAL_HANDOFF_FORM }, handoffError: "" }));
		}
	}

	function initNewHandoff(repoName: string) {
		update((s) => ({
			...s,
			handoff: {
				id: "__new__",
				repo: repoName,
				from_agent: "",
				to_agent: null,
				task_id: null,
				summary: "",
				context: {},
				status: "pending",
				created_at: "",
				updated_at: "",
				expires_at: null
			},
			task: null,
			memory: null,
			standard: null,
			handoffForm: { ...INITIAL_HANDOFF_FORM },
			handoffError: ""
		}));
	}

	function parseHandoffContext(value: string): Record<string, unknown> {
		if (!value.trim()) return {};
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("JSON must be an object.");
		}
		return parsed as Record<string, unknown>;
	}

	async function createHandoff(onCreated: () => void, repo: string) {
		const state = get({ subscribe });
		const form = state.handoffForm;
		if (!form.from_agent.trim() || !form.summary.trim()) return;

		update((s) => ({ ...s, handoffCreating: true, handoffError: "" }));
		try {
			await api.createHandoff({
				repo,
				from_agent: form.from_agent.trim(),
				to_agent: form.to_agent.trim() || undefined,
				task_code: form.task_code.trim() || undefined,
				summary: form.summary.trim(),
				context: parseHandoffContext(form.context)
			});
			onCreated();
		} catch (e) {
			update((s) => ({
				...s,
				handoffError: e instanceof Error ? e.message : "Failed to create handoff."
			}));
		} finally {
			update((s) => ({ ...s, handoffCreating: false }));
		}
	}

	async function updateHandoffStatus(status: string, onUpdated: () => void) {
		const state = get({ subscribe });
		if (!state.handoff || state.handoff.id === "__new__") return;

		update((s) => ({ ...s, handoffUpdating: true, handoffError: "" }));
		try {
			await api.updateHandoffStatus({
				id: state.handoff.id,
				status
			});
			onUpdated();
		} catch (e) {
			update((s) => ({
				...s,
				handoffError: e instanceof Error ? e.message : "Failed to update handoff."
			}));
		} finally {
			update((s) => ({ ...s, handoffUpdating: false }));
		}
	}

	async function handleCopyHandoffContext(context: Record<string, unknown>) {
		const success = await copyToClipboard(JSON.stringify(context, null, 2));
		if (success) {
			update((s) => ({ ...s, contentCopied: true }));
			setTimeout(() => update((s) => ({ ...s, contentCopied: false })), 2000);
		}
	}

	return {
		setHandoff,
		initNewHandoff,
		createHandoff,
		updateHandoffStatus,
		handleCopyHandoffContext
	};
}
