// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import MemoryDrawer from "../MemoryDrawer.svelte";

vi.mock("../../lib/stores", () => ({}));

vi.mock("../../lib/Icon.svelte", () => ({ default: () => ({}) }));
vi.mock("../Markdown.svelte", () => ({ default: () => ({}) }));
vi.mock("../MemoryDrawerHeader.svelte", () => ({ default: () => ({}) }));
vi.mock("../MemoryViewMode.svelte", () => ({ default: () => ({}) }));

vi.mock("../../lib/composables/useMemory", () => ({
	createMemoryHandler: () => ({
		form: {
			subscribe: (fn: any) => {
				fn({
					type: "code_fact",
					content: "",
					title: "",
					importance: 3,
					tags: "",
					agent: "",
					model: ""
				});
				return () => {};
			}
		},
		editing: {
			subscribe: (fn: any) => {
				fn(false);
				return () => {};
			}
		},
		saving: {
			subscribe: (fn: any) => {
				fn(false);
				return () => {};
			}
		},
		deleting: {
			subscribe: (fn: any) => {
				fn(false);
				return () => {};
			}
		},
		error: {
			subscribe: (fn: any) => {
				fn("");
				return () => {};
			}
		},
		previewMode: {
			subscribe: (fn: any) => {
				fn(false);
				return () => {};
			}
		},
		reset: vi.fn(),
		startEditing: vi.fn(),
		deleteMemory: vi.fn(),
		cancelEdit: vi.fn(),
		save: vi.fn(),
		togglePreview: vi.fn()
	})
}));

vi.mock("../../lib/memoryConfig", () => ({
	TYPES: ["code_fact", "decision", "mistake", "pattern", "task_archive"],
	TYPE_LABELS: {
		code_fact: "Code Fact",
		decision: "Decision",
		mistake: "Mistake",
		pattern: "Pattern",
		task_archive: "Task Archive"
	},
	importanceColor: {
		1: "#94a3b8",
		2: "#3b82f6",
		3: "#f59e0b",
		4: "#f97316",
		5: "#ef4444"
	},
	importanceBg: {
		1: "rgba(148,163,184,0.12)",
		2: "rgba(59,130,246,0.12)",
		3: "rgba(245,158,11,0.12)",
		4: "rgba(249,115,22,0.12)",
		5: "rgba(239,68,68,0.12)"
	}
}));

vi.mock("../../lib/memoryDrawerUtils", () => ({
	buildMetaFields: () => [],
	hasMetadata: () => false
}));

describe("MemoryDrawer", () => {
	it("exports a valid Svelte component", () => {
		expect(MemoryDrawer).toBeDefined();
		expect(typeof MemoryDrawer).toBe("function");
	});

	it("renders nothing when open=false", () => {
		const target = document.createElement("div");
		const component = mount(MemoryDrawer, {
			target,
			props: {
				memory: null,
				open: false,
				onClose: () => {},
				onSaved: () => {},
				onDeleted: () => {}
			}
		});
		expect(target.querySelector(".modal-backdrop")).toBeNull();
		unmount(component);
	});

	it("renders when open=true", () => {
		const target = document.createElement("div");
		const component = mount(MemoryDrawer, {
			target,
			props: {
				memory: {
					id: "test-id",
					type: "code_fact",
					title: "Test Memory",
					content: "Test content",
					importance: 3,
					agent: "test-agent",
					model: "test-model",
					tags: [],
					scope: { repo: "test" },
					created_at: "2024-01-01",
					updated_at: "2024-01-01"
				},
				open: true,
				onClose: () => {},
				onSaved: () => {},
				onDeleted: () => {}
			}
		});
		expect(target.querySelector(".modal-backdrop")).not.toBeNull();
		expect(target.querySelector(".modal-panel")).not.toBeNull();
		unmount(component);
	});
});
