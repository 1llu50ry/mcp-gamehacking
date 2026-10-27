import { TTL_MS_PER_DAY, TTL_MS_PER_HOUR } from "../utils/constants";
/**
 * Time Tunnel — Relative Date Parsing for Memory Search
 *
 * Extracts temporal phrases like "yesterday", "last week", "last 3 days"
 * from a search query and returns ISO 8601 date boundaries (since/until)
 * plus the cleaned query with the temporal phrase removed.
 *
 * All date math uses local time, not UTC.
 */

export interface TimeTunnelResult {
	/** Query with the temporal phrase stripped out */
	cleanedQuery: string;
	/** ISO 8601 start of the time window (inclusive) */
	since?: string;
	/** ISO 8601 end of the time window (exclusive upper bound) */
	until?: string;
}

/**
 * Local-start-of-day helper.
 * Returns midnight (00:00:00.000) in local time for the given date.
 */
function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Local-end-of-day helper.
 * Returns 23:59:59.999 in local time for the given date.
 */
function endOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Returns the Monday of the current week in local time.
 * Sunday (day 0) rolls back to the previous Monday.
 */
function currentWeekMonday(now: Date): Date {
	const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
	const offset = day === 0 ? -6 : 1 - day; // Monday offset
	return startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
}

interface PatternHandler {
	regex: RegExp;
	handler: (match: RegExpMatchArray, now: Date) => Pick<TimeTunnelResult, "since" | "until">;
}

const PATTERNS: PatternHandler[] = [
	// Order matters: more specific phrases first to avoid partial matches.

	// "last month" — full previous calendar month
	{
		regex: /\blast month\b/i,
		handler: (_match: RegExpMatchArray, now: Date) => {
			const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
			return {
				since: startOfLastMonth.toISOString(),
				until: endOfLastMonth.toISOString()
			};
		}
	},

	// "last week" — full previous calendar week (Mon–Sun)
	{
		regex: /\blast week\b/i,
		handler: (_match: RegExpMatchArray, now: Date) => {
			const thisMonday = currentWeekMonday(now);
			const startOfLastWeek = new Date(thisMonday.getTime() - 7 * TTL_MS_PER_DAY);
			const _endOfLastWeek = new Date(thisMonday.getTime() - 1);
			// endOfLastWeek should be end of Sunday (the day before this Monday)
			const endOfSunday = new Date(
				startOfLastWeek.getFullYear(),
				startOfLastWeek.getMonth(),
				startOfLastWeek.getDate() + 6,
				23,
				59,
				59,
				999
			);
			return {
				since: startOfLastWeek.toISOString(),
				until: endOfSunday.toISOString()
			};
		}
	},

	// "this week" — current week from Monday to today (no until bound)
	{
		regex: /\bthis week\b/i,
		handler: (_match: RegExpMatchArray, now: Date) => {
			const monday = currentWeekMonday(now);
			return {
				since: monday.toISOString()
			};
		}
	},

	// "yesterday"
	{
		regex: /\byesterday\b/i,
		handler: (_match: RegExpMatchArray, now: Date) => {
			const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
			return {
				since: startOfDay(yesterday).toISOString(),
				until: endOfDay(yesterday).toISOString()
			};
		}
	},

	// "today"
	{
		regex: /\btoday\b/i,
		handler: (_match: RegExpMatchArray, now: Date) => {
			return {
				since: startOfDay(now).toISOString(),
				until: endOfDay(now).toISOString()
			};
		}
	},

	// "last N weeks" / "past N weeks"
	{
		regex: /\b(?:last|past)\s+(\d+)\s+weeks?\b/i,
		handler: (match: RegExpMatchArray, now: Date) => {
			const n = parseInt(match[1], 10);
			const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n * 7);
			return {
				since: startOfDay(since).toISOString()
			};
		}
	},

	// "last N days" / "past N days"
	{
		regex: /\b(?:last|past)\s+(\d+)\s+days?\b/i,
		handler: (match: RegExpMatchArray, now: Date) => {
			const n = parseInt(match[1], 10);
			const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
			return {
				since: startOfDay(since).toISOString()
			};
		}
	},

	// "last_hour" / "past_hour"
	{
		regex: /\b(?:last|past)_hour\b/i,
		handler: (_match: RegExpMatchArray, now: Date) => {
			const since = new Date(now.getTime() - TTL_MS_PER_HOUR);
			return {
				since: since.toISOString()
			};
		}
	}
];

/**
 * Parses a search query for relative date/time phrases.
 *
 * @param query - The raw user query string
 * @returns A TimeTunnelResult with cleanedQuery, optional since/until, or null if no temporal phrase found
 */
export function parseRelativeDate(query: string): TimeTunnelResult | null {
	if (!query || query.trim().length === 0) {
		return null;
	}

	const now = new Date();

	for (const { regex, handler } of PATTERNS) {
		const match = query.match(regex);
		if (match) {
			// Remove the matched temporal phrase from the query
			const cleanedQuery = query.replace(regex, "").trim().replace(/\s+/g, " ");
			const { since, until } = handler(match, now);
			return { cleanedQuery, since, until };
		}
	}

	return null;
}
