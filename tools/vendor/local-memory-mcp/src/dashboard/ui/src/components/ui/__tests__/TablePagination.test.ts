// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount, unmount } from "svelte";
import TablePagination from "../TablePagination.svelte";

describe("TablePagination", () => {
	it("exports a valid Svelte component", () => {
		expect(TablePagination).toBeDefined();
		expect(typeof TablePagination).toBe("function");
	});

	it("renders nothing when totalPages is 1 or less", () => {
		const target = document.createElement("div");
		const component = mount(TablePagination, {
			target,
			props: {
				page: 1,
				totalPages: 1
			}
		});

		expect(target.querySelector("nav.table-pagination")).toBeNull();
		unmount(component);
	});

	it("renders pagination controls when totalPages > 1", () => {
		const target = document.createElement("div");
		const component = mount(TablePagination, {
			target,
			props: {
				page: 1,
				totalPages: 5
			}
		});

		const nav = target.querySelector("nav.table-pagination");
		expect(nav).not.toBeNull();
		expect(nav?.getAttribute("aria-label")).toBe("Table pagination");

		const info = target.querySelector(".table-pagination-info");
		expect(info?.textContent?.trim()).toBe("Page 1 of 5");

		const buttons = target.querySelectorAll("button.table-pagination-btn");
		// «, ‹, 1, 2, 3, 4, 5, ›, » => 9 buttons
		expect(buttons.length).toBe(9);

		unmount(component);
	});

	it("disables first and prev buttons on the first page", () => {
		const target = document.createElement("div");
		const component = mount(TablePagination, {
			target,
			props: {
				page: 1,
				totalPages: 5
			}
		});

		const firstBtn = target.querySelector('button[aria-label="First page"]') as HTMLButtonElement;
		const prevBtn = target.querySelector('button[aria-label="Previous page"]') as HTMLButtonElement;
		const nextBtn = target.querySelector('button[aria-label="Next page"]') as HTMLButtonElement;
		const lastBtn = target.querySelector('button[aria-label="Last page"]') as HTMLButtonElement;

		expect(firstBtn.disabled).toBe(true);
		expect(prevBtn.disabled).toBe(true);
		expect(nextBtn.disabled).toBe(false);
		expect(lastBtn.disabled).toBe(false);

		unmount(component);
	});

	it("disables next and last buttons on the last page", () => {
		const target = document.createElement("div");
		const component = mount(TablePagination, {
			target,
			props: {
				page: 5,
				totalPages: 5
			}
		});

		const firstBtn = target.querySelector('button[aria-label="First page"]') as HTMLButtonElement;
		const prevBtn = target.querySelector('button[aria-label="Previous page"]') as HTMLButtonElement;
		const nextBtn = target.querySelector('button[aria-label="Next page"]') as HTMLButtonElement;
		const lastBtn = target.querySelector('button[aria-label="Last page"]') as HTMLButtonElement;

		expect(firstBtn.disabled).toBe(false);
		expect(prevBtn.disabled).toBe(false);
		expect(nextBtn.disabled).toBe(true);
		expect(lastBtn.disabled).toBe(true);

		unmount(component);
	});

	it("marks the active page with aria-current and btn-primary class", () => {
		const target = document.createElement("div");
		const component = mount(TablePagination, {
			target,
			props: {
				page: 3,
				totalPages: 5
			}
		});

		const activeBtn = target.querySelector('button[aria-label="Page 3"]') as HTMLButtonElement;
		expect(activeBtn).not.toBeNull();
		expect(activeBtn.getAttribute("aria-current")).toBe("page");
		expect(activeBtn.classList.contains("btn-primary")).toBe(true);

		const inactiveBtn = target.querySelector('button[aria-label="Page 2"]') as HTMLButtonElement;
		expect(inactiveBtn.getAttribute("aria-current")).toBeNull();
		expect(inactiveBtn.classList.contains("btn-ghost")).toBe(true);

		unmount(component);
	});

	it("calls onPageChange and onGoToPage when a page button is clicked", () => {
		const target = document.createElement("div");
		const onPageChange = vi.fn();
		const onGoToPage = vi.fn();

		const component = mount(TablePagination, {
			target,
			props: {
				page: 1,
				totalPages: 5,
				onPageChange,
				onGoToPage
			}
		});

		const page2Btn = target.querySelector('button[aria-label="Page 2"]') as HTMLButtonElement;
		page2Btn.click();

		expect(onPageChange).toHaveBeenCalledWith(2);
		expect(onGoToPage).toHaveBeenCalledWith(2);

		unmount(component);
	});

	it("computes totalPages correctly from total and pageSize", () => {
		const target = document.createElement("div");
		const component = mount(TablePagination, {
			target,
			props: {
				page: 1,
				total: 45,
				pageSize: 10
			}
		});

		const info = target.querySelector(".table-pagination-info");
		expect(info?.textContent).toContain("Page 1 of 5");
		expect(info?.textContent).toContain("(45 items)");

		unmount(component);
	});

	it("displays item count with custom itemLabel", () => {
		const target = document.createElement("div");
		const component = mount(TablePagination, {
			target,
			props: {
				page: 1,
				totalPages: 3,
				totalItems: 42,
				itemLabel: "jobs"
			}
		});

		const info = target.querySelector(".table-pagination-info");
		expect(info?.textContent).toContain("(42 jobs)");

		unmount(component);
	});

	it("disables buttons and ignores clicks when loading is true", () => {
		const target = document.createElement("div");
		const onPageChange = vi.fn();

		const component = mount(TablePagination, {
			target,
			props: {
				page: 2,
				totalPages: 5,
				loading: true,
				onPageChange
			}
		});

		const page3Btn = target.querySelector('button[aria-label="Page 3"]') as HTMLButtonElement;
		expect(page3Btn.disabled).toBe(true);
		page3Btn.click();
		expect(onPageChange).not.toHaveBeenCalled();

		unmount(component);
	});

	it("navigates prev, next, first, and last correctly", () => {
		const target = document.createElement("div");
		const onPageChange = vi.fn();

		const component = mount(TablePagination, {
			target,
			props: {
				page: 3,
				totalPages: 5,
				onPageChange
			}
		});

		const prevBtn = target.querySelector('button[aria-label="Previous page"]') as HTMLButtonElement;
		prevBtn.click();
		expect(onPageChange).toHaveBeenLastCalledWith(2);

		const nextBtn = target.querySelector('button[aria-label="Next page"]') as HTMLButtonElement;
		nextBtn.click();
		expect(onPageChange).toHaveBeenLastCalledWith(4);

		const firstBtn = target.querySelector('button[aria-label="First page"]') as HTMLButtonElement;
		firstBtn.click();
		expect(onPageChange).toHaveBeenLastCalledWith(1);

		const lastBtn = target.querySelector('button[aria-label="Last page"]') as HTMLButtonElement;
		lastBtn.click();
		expect(onPageChange).toHaveBeenLastCalledWith(5);

		unmount(component);
	});

	it("centers 5-button window around the current page", () => {
		const target = document.createElement("div");
		const component = mount(TablePagination, {
			target,
			props: {
				page: 6,
				totalPages: 10
			}
		});

		// At page 6 of 10, start = max(1, min(6 - 2, 10 - 4)) = max(1, min(4, 6)) = 4
		// So pages should be 4, 5, 6, 7, 8
		const pageButtons = Array.from(target.querySelectorAll("button.table-pagination-btn"))
			.filter((btn) => btn.getAttribute("aria-label")?.startsWith("Page "))
			.map((btn) => btn.textContent?.trim());

		expect(pageButtons).toEqual(["4", "5", "6", "7", "8"]);

		unmount(component);
	});

	it("does not call callbacks when clicking the currently active page", () => {
		const target = document.createElement("div");
		const onPageChange = vi.fn();
		const component = mount(TablePagination, {
			target,
			props: {
				page: 3,
				totalPages: 5,
				onPageChange
			}
		});

		const page3Btn = target.querySelector('button[aria-label="Page 3"]') as HTMLButtonElement;
		page3Btn.click();
		expect(onPageChange).not.toHaveBeenCalled();

		unmount(component);
	});
});
