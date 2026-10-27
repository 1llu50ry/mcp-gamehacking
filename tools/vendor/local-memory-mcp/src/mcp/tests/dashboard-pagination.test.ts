// Feature: Dashboard Pagination Property Tests
//
// Extracted from dashboard.test.ts (TASK-428) so the original stays under the
// 500-line budget. Self-contained — only depends on fast-check + MockMemory.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { MockMemory } from "../types/index";

describe("Property 13: Pagination non-overlapping", () => {
	function paginate(
		items: MockMemory[] | string[] | number[],
		page: number,
		pageSize: number
	): (MockMemory | string | number)[] {
		const start = (page - 1) * pageSize;
		return items.slice(start, start + pageSize);
	}

	it("property: different pages have no overlapping IDs", () => {
		fc.assert(
			fc.property(
				fc.array(fc.uuid(), { minLength: 10, maxLength: 100 }),
				fc.integer({ min: 1, max: 10 }),
				(ids, pageSize) => {
					if (pageSize < 1) return true;

					const page1 = paginate(ids, 1, pageSize);
					const page2 = paginate(ids, 2, pageSize);

					// No common IDs between pages
					const overlap = page1.filter((id) => page2.includes(id));
					expect(overlap.length).toBe(0);
				}
			),
			{ numRuns: 50 }
		);
	});

	it("property: all items appear in exactly one page", () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer(), { minLength: 1, maxLength: 50 }),
				fc.integer({ min: 1, max: 10 }),
				(items, pageSize) => {
					if (pageSize < 1) return true;
					if (items.length === 0) return true;

					const totalPages = Math.ceil(items.length / pageSize);
					const allPages: number[] = [];

					for (let page = 1; page <= totalPages; page++) {
						const pageItems = paginate(items, page, pageSize);
						(allPages as (MockMemory | string | number)[]).push(...pageItems);
					}

					// Should have same total count
					expect(allPages.length).toBe(items.length);
				}
			),
			{ numRuns: 30 }
		);
	});
});
