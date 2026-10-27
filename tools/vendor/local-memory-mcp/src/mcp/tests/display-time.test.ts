/**
 * Tests for the display-timezone layer (LMM-TZ-01).
 *
 * Two contracts are covered:
 *
 *  1. `formatDisplayTimestamp` — when `LOCAL_MEMORY_DISPLAY_TZ` is unset,
 *     empty, or an invalid IANA name, the helper must return the ORIGINAL
 *     stored ISO-8601 UTC string verbatim. The expected values below are
 *     hardcoded literals, not the formatter's own output, so the
 *     backward-compatibility assertion has an independent oracle.
 *  2. The four read sites named by the task render the configured zone in
 *     text output and fall back to raw UTC when the key is absent.
 *
 * Storage is never touched: every fixture is inserted with an explicit
 * `created_at`/`updated_at` literal and read back through the real handlers.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { CodingStandardEntry, MemoryEntry, Task, VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";
import { formatDisplayTimestamp } from "../utils/display-time";
import { handleMemoryRead } from "../tools/memory-read";
import { handleStandardRead } from "../tools/standard-read";
import { handleTaskRead } from "../tools/task-read";

const OWNER = "test";
const REPO = "display-time-repo";

// Hardcoded independent oracles: 2026-10-17T14:56:00.000Z is 21:56 in
// Asia/Jakarta (UTC+7), 20:56 in Europe/Berlin (UTC+2 in October), and
// 20:41 in Asia/Kathmandu (UTC+5:45).
const STORED_ISO = "2026-10-17T14:56:00.000Z";
const JAKARTA_EXPECTED = "2026-10-17 21:56:00 +07:00";
const KATHMANDU_EXPECTED = "2026-10-17 20:41:00 +05:45";
const NEW_YORK_EXPECTED = "2026-10-17 10:56:00 -04:00";

function setDisplayTz(value: string | undefined): void {
	if (value === undefined) {
		delete process.env.LOCAL_MEMORY_DISPLAY_TZ;
		return;
	}
	process.env.LOCAL_MEMORY_DISPLAY_TZ = value;
}

const ORIGINAL_DISPLAY_TZ = process.env.LOCAL_MEMORY_DISPLAY_TZ;

afterEach(() => {
	setDisplayTz(ORIGINAL_DISPLAY_TZ);
});

describe("formatDisplayTimestamp — backward compatibility", () => {
	it("returns the exact stored ISO string when the env key is unset", () => {
		setDisplayTz(undefined);

		expect(formatDisplayTimestamp(STORED_ISO)).toBe("2026-10-17T14:56:00.000Z");
	});

	it("treats an empty/whitespace value as unset", () => {
		setDisplayTz("   ");
		expect(formatDisplayTimestamp(STORED_ISO)).toBe("2026-10-17T14:56:00.000Z");
	});

	it("falls back to the raw ISO string for an invalid IANA zone (RangeError path)", () => {
		setDisplayTz("Not/AZone");
		expect(formatDisplayTimestamp(STORED_ISO)).toBe("2026-10-17T14:56:00.000Z");
	});

	it("returns an unparseable date string unchanged", () => {
		setDisplayTz("Asia/Jakarta");
		expect(formatDisplayTimestamp("not-a-date")).toBe("not-a-date");
	});

	it("passes null and empty strings through untouched", () => {
		setDisplayTz("Asia/Jakarta");
		expect(formatDisplayTimestamp(null)).toBeNull();
		expect(formatDisplayTimestamp("")).toBe("");
	});
});

describe("formatDisplayTimestamp — configured zone", () => {
	it("renders Asia/Jakarta with an explicit +07:00 offset", () => {
		setDisplayTz("Asia/Jakarta");
		expect(formatDisplayTimestamp(STORED_ISO)).toBe(JAKARTA_EXPECTED);
	});

	it("renders a half-hour offset zone correctly (Asia/Kathmandu)", () => {
		setDisplayTz("Asia/Kathmandu");
		expect(formatDisplayTimestamp(STORED_ISO)).toBe(KATHMANDU_EXPECTED);
	});

	it("renders a negative DST offset correctly (America/New_York)", () => {
		setDisplayTz("America/New_York");
		expect(formatDisplayTimestamp(STORED_ISO)).toBe(NEW_YORK_EXPECTED);
	});

	it("never emits a bare local string without an offset", () => {
		setDisplayTz("Asia/Jakarta");
		expect(formatDisplayTimestamp(STORED_ISO)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$/);
	});
});

// ── Read-site integration ────────────────────────────────────────────────

describe("read-site rendering honours LOCAL_MEMORY_DISPLAY_TZ", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;
	let task: Task;
	let memory: MemoryEntry;
	let standard: CodingStandardEntry;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);

		task = {
			id: randomUUID(),
			owner: OWNER,
			repo: REPO,
			task_code: "TZ-001",
			phase: "test",
			title: "Timezone display task",
			description: null,
			status: "pending",
			priority: 3,
			agent: "test",
			role: "test",
			doc_path: null,
			created_at: STORED_ISO,
			updated_at: STORED_ISO,
			in_progress_at: null,
			finished_at: null,
			canceled_at: null,
			est_tokens: 0,
			commit_id: null,
			changed_files: [],
			tags: [],
			suggested_skills: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		};
		db.tasks.insertTask(task);

		memory = {
			id: randomUUID(),
			code: "MEM-TZ-001",
			type: "code_fact",
			title: "Timezone display memory",
			content: "Stored timestamps stay UTC.",
			importance: 3,
			agent: "test",
			role: "test",
			model: "test",
			scope: { owner: OWNER, repo: REPO },
			created_at: STORED_ISO,
			updated_at: STORED_ISO,
			completed_at: null,
			hit_count: 0,
			recall_count: 0,
			last_used_at: null,
			expires_at: null,
			supersedes: null,
			status: "active",
			tags: [],
			metadata: {},
			is_global: false
		};
		db.memories.insert(memory);

		standard = {
			id: randomUUID(),
			code: "STD-TZ-001",
			title: "Timezone display standard",
			content: "Render local time with an explicit offset.",
			parent_id: null,
			context: "display",
			version: "1.0.0",
			language: "typescript",
			stack: [],
			is_global: false,
			owner: OWNER,
			repo: REPO,
			tags: [],
			metadata: {},
			created_at: STORED_ISO,
			updated_at: STORED_ISO,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		};
		db.standards.insert(standard);
	});

	it("task-read detail renders the configured zone and keeps stored UTC intact", async () => {
		setDisplayTz("Asia/Jakarta");
		const res = await handleTaskRead({ owner: OWNER, repo: REPO, code: "TZ-001" }, db, vectors);
		const text = getPrimaryTextContent(res);

		expect(text).toContain(`Created: ${JAKARTA_EXPECTED}`);
		expect(text).toContain(`Updated: ${JAKARTA_EXPECTED}`);
		expect(db.tasks.getTaskByCode(OWNER, REPO, "TZ-001")?.created_at).toBe(STORED_ISO);
	});

	it("task-read detail is byte-identical to raw UTC when the key is unset", async () => {
		setDisplayTz(undefined);

		const res = await handleTaskRead({ owner: OWNER, repo: REPO, code: "TZ-001" }, db, vectors);
		const text = getPrimaryTextContent(res);

		expect(text).toContain(`Created: ${STORED_ISO}`);
		expect(text).toContain(`Updated: ${STORED_ISO}`);
	});

	it("task-read list rows render the configured zone", async () => {
		setDisplayTz("Asia/Jakarta");
		const res = await handleTaskRead({ owner: OWNER, repo: REPO, status: "all", json: true }, db, vectors);
		const rows = (res.structuredContent as { tasks: { rows: unknown[][] } }).tasks.rows;

		expect(rows.some((row) => row.includes(JAKARTA_EXPECTED))).toBe(true);
	});

	it("task-read list rows stay raw UTC when the key is unset", async () => {
		setDisplayTz(undefined);

		const res = await handleTaskRead({ owner: OWNER, repo: REPO, status: "all", json: true }, db, vectors);
		const rows = (res.structuredContent as { tasks: { rows: unknown[][] } }).tasks.rows;

		expect(rows.some((row) => row.includes(STORED_ISO))).toBe(true);
	});

	it("memory-read detail renders the configured zone", async () => {
		setDisplayTz("Asia/Jakarta");
		const res = await handleMemoryRead({ owner: OWNER, repo: REPO, id: memory.id }, db, vectors);
		const text = getPrimaryTextContent(res);

		expect(text).toContain(`Created: ${JAKARTA_EXPECTED}`);
		expect(text).toContain(`Updated: ${JAKARTA_EXPECTED}`);
	});

	it("memory-read detail stays raw UTC when the key is unset", async () => {
		setDisplayTz(undefined);

		const res = await handleMemoryRead({ owner: OWNER, repo: REPO, id: memory.id }, db, vectors);
		const text = getPrimaryTextContent(res);

		expect(text).toContain(`Created: ${STORED_ISO}`);
		expect(text).toContain(`Updated: ${STORED_ISO}`);
	});

	it("standard-read detail renders the configured zone", async () => {
		setDisplayTz("Asia/Jakarta");
		const res = await handleStandardRead({ owner: OWNER, repo: REPO, code: "STD-TZ-001" }, db, vectors);
		const text = getPrimaryTextContent(res);

		expect(text).toContain(`Created: ${JAKARTA_EXPECTED}`);
		expect(text).toContain(`Updated: ${JAKARTA_EXPECTED}`);
	});

	it("standard-read detail stays raw UTC when the key is unset", async () => {
		setDisplayTz(undefined);

		const res = await handleStandardRead({ owner: OWNER, repo: REPO, code: "STD-TZ-001" }, db, vectors);
		const text = getPrimaryTextContent(res);

		expect(text).toContain(`Created: ${STORED_ISO}`);
		expect(text).toContain(`Updated: ${STORED_ISO}`);
	});
});
