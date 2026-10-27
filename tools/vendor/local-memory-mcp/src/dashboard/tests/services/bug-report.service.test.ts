/**
 * Unit tests for the bug-report dashboard service. Pure unit — the db
 * context is stubbed with a `bugReports` entity double, and we assert the
 * service delegates with the exact arguments it received.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const db = {
		bugReports: {
			list: vi.fn(),
			getById: vi.fn(),
			resolve: vi.fn(),
			stats: vi.fn()
		}
	};
	return { db };
});

vi.mock("../../lib/context", () => ({
	db: mocks.db
}));

import { BugReportService } from "../../services/bug-report.service";

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("BugReportService.list", () => {
	it("delegates to the entity with the provided options", () => {
		mocks.db.bugReports.list.mockReturnValue([{ id: 1 }]);

		const result = BugReportService.list(true, "tool", 10, 5);

		expect(mocks.db.bugReports.list).toHaveBeenCalledWith({
			includeResolved: true,
			source: "tool",
			limit: 10,
			offset: 5
		});
		expect(result).toEqual([{ id: 1 }]);
	});

	it("defaults to open reports with no source filter", () => {
		mocks.db.bugReports.list.mockReturnValue([]);

		BugReportService.list();

		expect(mocks.db.bugReports.list).toHaveBeenCalledWith({
			includeResolved: false,
			source: undefined,
			limit: 50,
			offset: 0
		});
	});
});

describe("BugReportService.get", () => {
	it("delegates to getById", () => {
		mocks.db.bugReports.getById.mockReturnValue({ id: 7 });

		const result = BugReportService.get(7);

		expect(mocks.db.bugReports.getById).toHaveBeenCalledWith(7);
		expect(result).toEqual({ id: 7 });
	});
});

describe("BugReportService.resolve", () => {
	it("delegates to resolve", () => {
		mocks.db.bugReports.resolve.mockReturnValue(true);

		const result = BugReportService.resolve(3);

		expect(mocks.db.bugReports.resolve).toHaveBeenCalledWith(3);
		expect(result).toBe(true);
	});
});

describe("BugReportService.stats", () => {
	it("delegates to stats", () => {
		mocks.db.bugReports.stats.mockReturnValue({ total: 2, open: 1, resolved: 1 });

		const result = BugReportService.stats();

		expect(mocks.db.bugReports.stats).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ total: 2, open: 1, resolved: 1 });
	});
});
