import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseRelativeDate } from "../tools/time-tunnel";

/**
 * Helper: compute ISO start/end of a day in local time for a given date.
 * These match the implementation's internal `startOfDay` and `endOfDay`.
 */
function localStartOfDay(year: number, month: number, day: number): string {
	return new Date(year, month, day, 0, 0, 0, 0).toISOString();
}

function localEndOfDay(year: number, month: number, day: number): string {
	return new Date(year, month, day, 23, 59, 59, 999).toISOString();
}

/**
 * Returns the Monday of the week containing the given local date.
 */
function localMondayOfWeek(year: number, month: number, day: number): Date {
	const d = new Date(year, month, day);
	const dayOfWeek = d.getDay(); // 0=Sun
	const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
	return new Date(year, month, day + offset);
}

/**
 * Freeze Date to a known value.
 */
function freezeDate(iso: string): void {
	vi.setSystemTime(new Date(iso));
}

describe("Time Tunnel — parseRelativeDate", () => {
	beforeEach(() => {
		// Freeze at 2026-07-07T10:30:00 UTC — actual local date depends on timezone
		freezeDate("2026-07-07T10:30:00Z");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("today", () => {
		it('returns since=start_of_today and until=end_of_today for query "today"', () => {
			const result = parseRelativeDate("today");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const expectedSince = localStartOfDay(now.getFullYear(), now.getMonth(), now.getDate());
			const expectedUntil = localEndOfDay(now.getFullYear(), now.getMonth(), now.getDate());

			expect(result!.since).toBe(expectedSince);
			expect(result!.until).toBe(expectedUntil);
		});

		it('extracts "today" from longer query', () => {
			const result = parseRelativeDate("deployment issues today");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("deployment issues");

			const now = new Date();
			expect(result!.since).toBe(localStartOfDay(now.getFullYear(), now.getMonth(), now.getDate()));
		});

		it('is case insensitive for "Today"', () => {
			const result = parseRelativeDate("Today");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			expect(result!.since).toBe(localStartOfDay(now.getFullYear(), now.getMonth(), now.getDate()));
		});
	});

	describe("yesterday", () => {
		it('returns yesterday boundaries for query "yesterday"', () => {
			const result = parseRelativeDate("yesterday");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
			expect(result!.since).toBe(localStartOfDay(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()));
			expect(result!.until).toBe(localEndOfDay(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()));
		});

		it('extracts "yesterday" from query with prefix', () => {
			const result = parseRelativeDate("bugs found yesterday");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("bugs found");
		});
	});

	describe("this week", () => {
		it('returns since=Monday of current week for "this week"', () => {
			const result = parseRelativeDate("this week");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const monday = localMondayOfWeek(now.getFullYear(), now.getMonth(), now.getDate());
			expect(result!.since).toBe(monday.toISOString());
			expect(result!.until).toBeUndefined();
		});

		it("works on Sunday (rolls back to previous Monday)", () => {
			vi.useRealTimers();
			freezeDate("2026-07-05T15:00:00Z"); // Sunday
			const result = parseRelativeDate("this week");
			expect(result).not.toBeNull();

			const now = new Date();
			const monday = localMondayOfWeek(now.getFullYear(), now.getMonth(), now.getDate());
			expect(result!.since).toBe(monday.toISOString());
		});

		it("works on Monday (same day)", () => {
			freezeDate("2026-07-06T08:00:00Z"); // Monday
			const result = parseRelativeDate("this week");
			expect(result).not.toBeNull();

			const now = new Date();
			expect(result!.since).toBe(localStartOfDay(now.getFullYear(), now.getMonth(), now.getDate()));
		});
	});

	describe("last week", () => {
		it('returns full Mon-Sun window for "last week"', () => {
			freezeDate("2026-07-08T10:30:00Z"); // Wednesday
			const result = parseRelativeDate("last week");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const thisMonday = localMondayOfWeek(now.getFullYear(), now.getMonth(), now.getDate());
			const lastMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
			const lastSunday = new Date(thisMonday.getTime() - 1);

			expect(result!.since).toBe(
				localStartOfDay(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate())
			);
			expect(result!.until).toBe(localEndOfDay(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate()));
		});
	});

	describe("last month", () => {
		it('returns full previous calendar month for "last month"', () => {
			freezeDate("2026-07-15T10:30:00Z");
			const result = parseRelativeDate("last month");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

			expect(result!.since).toBe(startOfLastMonth.toISOString());
			expect(result!.until).toBe(endOfLastMonth.toISOString());
		});
	});

	describe("last N days", () => {
		it('parses "last 3 days"', () => {
			const result = parseRelativeDate("last 3 days");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
			expect(result!.since).toBe(localStartOfDay(since.getFullYear(), since.getMonth(), since.getDate()));
			expect(result!.until).toBeUndefined();
		});

		it('parses "past 7 days"', () => {
			const result = parseRelativeDate("past 7 days");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
			expect(result!.since).toBe(localStartOfDay(since.getFullYear(), since.getMonth(), since.getDate()));
		});

		it("extracts from query with remaining text", () => {
			const result = parseRelativeDate("bugs last 3 days");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("bugs");

			const now = new Date();
			const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
			expect(result!.since).toBe(localStartOfDay(since.getFullYear(), since.getMonth(), since.getDate()));
		});

		it('supports "last 1 day" singular', () => {
			const result = parseRelativeDate("last 1 day");
			expect(result).not.toBeNull();

			const now = new Date();
			const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
			expect(result!.since).toBe(localStartOfDay(since.getFullYear(), since.getMonth(), since.getDate()));
		});
	});

	describe("last N weeks", () => {
		it('parses "last 2 weeks"', () => {
			const result = parseRelativeDate("last 2 weeks");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
			expect(result!.since).toBe(localStartOfDay(since.getFullYear(), since.getMonth(), since.getDate()));
		});

		it('parses "past 1 week" singular', () => {
			const result = parseRelativeDate("past 1 week");
			expect(result).not.toBeNull();

			const now = new Date();
			const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
			expect(result!.since).toBe(localStartOfDay(since.getFullYear(), since.getMonth(), since.getDate()));
		});
	});

	describe("last_hour / past_hour", () => {
		it('parses "last_hour"', () => {
			const result = parseRelativeDate("last_hour");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const since = new Date(now.getTime() - 60 * 60 * 1000);
			expect(result!.since).toBe(since.toISOString());
			expect(result!.until).toBeUndefined();
		});

		it('parses "past_hour"', () => {
			const result = parseRelativeDate("past_hour");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");

			const now = new Date();
			const since = new Date(now.getTime() - 60 * 60 * 1000);
			expect(result!.since).toBe(since.toISOString());
		});

		it("extracts from query with remaining text", () => {
			const result = parseRelativeDate("errors last_hour");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("errors");
		});
	});

	describe("null/no match", () => {
		it("returns null for empty string", () => {
			expect(parseRelativeDate("")).toBeNull();
		});

		it("returns null for whitespace-only string", () => {
			expect(parseRelativeDate("   ")).toBeNull();
		});

		it("returns null for query with no temporal phrase", () => {
			expect(parseRelativeDate("deployment issues production")).toBeNull();
		});

		it("returns null for non-temporal 'last' usage", () => {
			expect(parseRelativeDate("last version")).toBeNull();
		});

		it("returns null for ambiguous 'days' without number prefix", () => {
			expect(parseRelativeDate("days ago")).toBeNull();
		});
	});

	describe("pattern priority", () => {
		it('"last month" takes priority over "last N days"', () => {
			// "last month" should be matched as a full phrase, not "last" + "month" → "last N days"
			const result = parseRelativeDate("last month");
			expect(result).not.toBeNull();

			const now = new Date();
			const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

			expect(result!.since).toBe(startOfLastMonth.toISOString());
			expect(result!.until).toBe(endOfLastMonth.toISOString());
		});

		it('"last week" takes priority over "last N days"', () => {
			const result = parseRelativeDate("last week");
			expect(result).not.toBeNull();

			const now = new Date();
			const thisMonday = localMondayOfWeek(now.getFullYear(), now.getMonth(), now.getDate());
			const lastMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000);
			const lastSunday = new Date(thisMonday.getTime() - 1);

			expect(result!.since).toBe(
				localStartOfDay(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate())
			);
			expect(result!.until).toBe(localEndOfDay(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate()));
		});
	});

	describe("integration examples from spec", () => {
		it('query "deployment issues yesterday"', () => {
			const result = parseRelativeDate("deployment issues yesterday");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("deployment issues");

			const now = new Date();
			const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
			expect(result!.since).toBe(localStartOfDay(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()));
			expect(result!.until).toBe(localEndOfDay(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()));
		});

		it('query "last week" alone returns cleanedQuery as empty string', () => {
			const result = parseRelativeDate("last week");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("");
		});

		it('query "bugs last 3 days"', () => {
			const result = parseRelativeDate("bugs last 3 days");
			expect(result).not.toBeNull();
			expect(result!.cleanedQuery).toBe("bugs");
		});
	});
});
