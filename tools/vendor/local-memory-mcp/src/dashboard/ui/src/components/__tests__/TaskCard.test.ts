// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import TaskCard from "../TaskCard.svelte";
import type { Task } from "../../lib/stores";

/**
 * Creates a mock Task fixture for testing TaskCard component.
 *
 * @param overrides - Optional partial properties to override default fixture values.
 * @returns Fully populated Task object.
 */
function createMockTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-123",
		repo: "repo-a",
		task_code: "TASK-123",
		phase: "Implementation",
		title: "Refactor Kanban Board",
		description: "Improve overflow and move selection checkbox",
		status: "in_progress",
		priority: 3,
		agent: "frontend",
		created_at: "2026-09-11T10:00:00Z",
		updated_at: "2026-09-11T10:30:00Z",
		...overrides
	};
}

describe("TaskCard", () => {
	it("renders task code and title without checkbox when onToggleSelect is omitted", () => {
		const target = document.createElement("div");
		const task = createMockTask();
		const component = mount(TaskCard, {
			target,
			props: { task }
		});

		expect(target.querySelector(".task-code-text")?.textContent).toBe("TASK-123");
		expect(target.querySelector(".task-title")?.textContent).toBe("Refactor Kanban Board");
		expect(target.querySelector(".task-card-checkbox")).toBeNull();

		unmount(component);
	});

	it("renders selection checkbox when onToggleSelect is provided", () => {
		const target = document.createElement("div");
		const task = createMockTask();
		const onToggleSelect = vi.fn();
		const component = mount(TaskCard, {
			target,
			props: {
				task,
				selected: false,
				onToggleSelect
			}
		});

		const checkbox = target.querySelector<HTMLInputElement>(".task-card-checkbox");
		expect(checkbox).not.toBeNull();
		expect(checkbox?.checked).toBe(false);
		expect(checkbox?.getAttribute("aria-label")).toBe("Select task Refactor Kanban Board");
		expect(target.querySelector(".task-card")?.classList.contains("selected")).toBe(false);

		unmount(component);
	});

	it("applies selected class and checks checkbox when selected prop is true", () => {
		const target = document.createElement("div");
		const task = createMockTask();
		const component = mount(TaskCard, {
			target,
			props: {
				task,
				selected: true,
				onToggleSelect: vi.fn()
			}
		});

		const checkbox = target.querySelector<HTMLInputElement>(".task-card-checkbox");
		expect(checkbox?.checked).toBe(true);
		expect(target.querySelector(".task-card")?.classList.contains("selected")).toBe(true);

		unmount(component);
	});

	it("calls onToggleSelect and stops propagation when checkbox changes", () => {
		const target = document.createElement("div");
		const task = createMockTask();
		const onToggleSelect = vi.fn();

		const component = mount(TaskCard, {
			target,
			props: {
				task,
				selected: false,
				onToggleSelect
			}
		});

		const checkbox = target.querySelector<HTMLInputElement>(".task-card-checkbox");
		expect(checkbox).not.toBeNull();

		checkbox?.dispatchEvent(new Event("change", { bubbles: true }));
		expect(onToggleSelect).toHaveBeenCalledTimes(1);

		unmount(component);
	});

	it("stops click propagation so clicking the checkbox does not bubble to card click", () => {
		const target = document.createElement("div");
		const task = createMockTask();
		const onToggleSelect = vi.fn();

		const component = mount(TaskCard, {
			target,
			props: {
				task,
				selected: false,
				onToggleSelect
			}
		});

		const card = target.querySelector(".task-card");
		const cardClickHandler = vi.fn();
		card?.addEventListener("click", cardClickHandler);

		const checkbox = target.querySelector<HTMLInputElement>(".task-card-checkbox");
		checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(cardClickHandler).not.toHaveBeenCalled();

		unmount(component);
	});

	it("stops keydown propagation so pressing keys on the checkbox does not bubble to card keydown", () => {
		const target = document.createElement("div");
		const task = createMockTask();
		const onToggleSelect = vi.fn();

		const component = mount(TaskCard, {
			target,
			props: {
				task,
				selected: false,
				onToggleSelect
			}
		});

		const card = target.querySelector(".task-card");
		const cardKeydownHandler = vi.fn();
		card?.addEventListener("keydown", cardKeydownHandler);

		const checkbox = target.querySelector<HTMLInputElement>(".task-card-checkbox");
		checkbox?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

		expect(cardKeydownHandler).not.toHaveBeenCalled();

		unmount(component);
	});

	it("renders owner badge when owner is present", () => {
		const target = document.createElement("div");
		const task = createMockTask({ owner: "alice" });

		const component = mount(TaskCard, {
			target,
			props: { task }
		});

		const ownerBadge = target.querySelector(".owner-badge");
		expect(ownerBadge).not.toBeNull();
		expect(ownerBadge?.textContent?.trim()).toBe("alice");
		expect(ownerBadge?.getAttribute("title")).toBe("Owner: alice");
		expect(ownerBadge?.classList.contains("owner-unknown")).toBe(false);

		unmount(component);
	});

	it("renders unknown owner badge when owner is empty", () => {
		const target = document.createElement("div");
		const task = createMockTask({ owner: "" });

		const component = mount(TaskCard, {
			target,
			props: { task }
		});

		const ownerBadge = target.querySelector(".owner-badge");
		expect(ownerBadge).not.toBeNull();
		expect(ownerBadge?.textContent?.trim()).toBe("unknown");
		expect(ownerBadge?.getAttribute("title")).toBe("owner unknown (repo-only view)");
		expect(ownerBadge?.classList.contains("owner-unknown")).toBe(true);

		unmount(component);
	});

	it("renders distinct owner badges for two different tasks", () => {
		const target1 = document.createElement("div");
		const target2 = document.createElement("div");
		const task1 = createMockTask({ id: "t1", owner: "alice", task_code: "TASK-1" });
		const task2 = createMockTask({ id: "t2", owner: "bob", task_code: "TASK-2" });

		const component1 = mount(TaskCard, {
			target: target1,
			props: { task: task1 }
		});
		const component2 = mount(TaskCard, {
			target: target2,
			props: { task: task2 }
		});

		const badge1 = target1.querySelector(".owner-badge");
		const badge2 = target2.querySelector(".owner-badge");

		expect(badge1?.textContent?.trim()).toBe("alice");
		expect(badge2?.textContent?.trim()).toBe("bob");

		unmount(component1);
		unmount(component2);
	});
});
