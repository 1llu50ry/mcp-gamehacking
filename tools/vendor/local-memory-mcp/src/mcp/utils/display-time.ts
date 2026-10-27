/**
 * Display-time formatting for human-readable tool output (LMM-TZ-01).
 *
 * Stored timestamps are ISO-8601 UTC strings produced by
 * `new Date().toISOString()`. Storage, ordering, filtering, and comparison all
 * depend on that shape, so this module never touches stored values — it only
 * renders a display copy.
 *
 * `LOCAL_MEMORY_DISPLAY_TZ` (IANA name, e.g. `Asia/Jakarta`) is injected into
 * `process.env` by the existing file-based config loader
 * (`utils/config-file.ts` → `loadConfigFileEnv`, which merges
 * `<configDir>/config.jsonc` then `<configDir>/.env` before the server boots).
 * Reading it here through `envStr` keeps the exact same precedence and
 * empty-string semantics as every other env key.
 *
 * BACKWARD COMPATIBILITY CONTRACT: when the key is unset, empty, or not a
 * valid IANA zone, {@link formatDisplayTimestamp} returns its input verbatim
 * (raw ISO-8601 UTC with `Z`). A configured zone renders
 * `YYYY-MM-DD HH:mm:ss ±HH:MM` so a local time can never be mistaken for UTC.
 */

import { envStr } from "./constants";

/** Env key that selects the display timezone. */
export const DISPLAY_TZ_ENV_KEY = "LOCAL_MEMORY_DISPLAY_TZ";

/**
 * Formatter cache keyed by IANA zone. A `null` entry memoizes an invalid zone
 * so a bogus value does not re-throw `RangeError` on every rendered line.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat | null>();

/**
 * Build (or reuse) the formatter for a zone, or `null` when the zone is not a
 * valid IANA name (`Intl.DateTimeFormat` throws `RangeError` for those).
 */
function getFormatter(timeZone: string): Intl.DateTimeFormat | null {
	const cached = formatterCache.get(timeZone);
	if (cached !== undefined) return cached;

	let formatter: Intl.DateTimeFormat | null;
	try {
		formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
			timeZoneName: "longOffset"
		});
	} catch {
		// Invalid IANA zone — caller falls back to the raw stored string.
		formatter = null;
	}
	formatterCache.set(timeZone, formatter);
	return formatter;
}

/**
 * Normalize an ICU `longOffset` name (`GMT+07:00`, `GMT-04:00`, `GMT+5`) to
 * `±HH:MM`. Returns `undefined` when the shape is not an offset, which makes
 * the caller fall back to raw UTC rather than emit a bare local time.
 */
function normalizeOffset(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(raw);
	if (!match) return undefined;
	const [, sign, hours, minutes] = match;
	return `${sign}${hours.padStart(2, "0")}:${minutes ?? "00"}`;
}

/**
 * Render a stored UTC timestamp for display.
 *
 * Returns the input unchanged when `LOCAL_MEMORY_DISPLAY_TZ` is unset/empty,
 * the value is not a parseable date, or the zone is invalid. Otherwise returns
 * `YYYY-MM-DD HH:mm:ss ±HH:MM` in the configured zone.
 *
 * @param value Stored ISO-8601 UTC timestamp (or any date string).
 * @returns The display string, or the original value when formatting is off.
 */
export function formatDisplayTimestamp(value: string): string;
export function formatDisplayTimestamp(value: string | null): string | null;
export function formatDisplayTimestamp(value: string | null): string | null {
	if (value === null || value === "") return value;

	const timeZone = envStr(DISPLAY_TZ_ENV_KEY);
	if (!timeZone) return value;

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;

	const formatter = getFormatter(timeZone);
	if (!formatter) return value;

	try {
		const parts = formatter.formatToParts(date);
		const part = (type: Intl.DateTimeFormatPartTypes): string | undefined => parts.find((p) => p.type === type)?.value;

		const year = part("year");
		const month = part("month");
		const day = part("day");
		const hour = part("hour");
		const minute = part("minute");
		const second = part("second");
		const offset = normalizeOffset(part("timeZoneName"));

		if (!year || !month || !day || !hour || !minute || !second || !offset) return value;

		return `${year}-${month}-${day} ${hour}:${minute}:${second} ${offset}`;
	} catch {
		return value;
	}
}
