/**
 * Unit tests for the queue admin service layer (TASK-296 / TASK-360).
 *
 * Focus (unpinned at the HTTP layer): the default pending+poison filter,
 * the terminal-state guards (retry/clear only apply to poison/done — 409),
 * the guarded-UPDATE failure 409s (unreachable through a real HTTP round
 * trip), and the PARAMETERIZED repo-scope SQL (never interpolated).
 * The outbox is stubbed; `db.db.prepare` is stubbed to capture SQL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueJobRow, QueueJobStatus } from "../../../mcp/embedding-queue/types";

const mocks = vi.hoisted(() => {
	const db = {
		db: { prepare: vi.fn() },
		withWrite: vi.fn((fn: () => unknown) => fn())
	};
	const outbox = {
		listJobs: vi.fn(),
		retryJob: vi.fn(),
		retryAllPoison: vi.fn(),
		deleteJob: vi.fn()
	};
	return {
		db,
		outbox,
		mcpClient: {
			start: vi.fn(),
			stop: vi.fn(),
			isConnected: vi.fn(() => false),
			getPendingCount: vi.fn(() => 0),
			callTool: vi.fn()
		},
		embeddingWorker: { getStats: vi.fn() },
		vectors: { upsert: vi.fn(), remove: vi.fn(), search: vi.fn() },
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		startTime: Date.now()
	};
});

vi.mock("../../lib/context", () => ({
	db: mocks.db,
	mcpClient: mocks.mcpClient,
	embeddingWorker: mocks.embeddingWorker,
	vectors: mocks.vectors,
	logger: mocks.logger,
	startTime: mocks.startTime
}));

vi.mock("../../../mcp/embedding-queue/outbox", () => ({
	outboxFor: () => mocks.outbox
}));

import { QueueService } from "../../services/queue.service";

function makeJobRow(overrides: Partial<QueueJobRow> = {}): QueueJobRow {
	return {
		id: "job-1",
		entity_kind: "memory",
		entity_id: "mem-1",
		entity_repo: "acme/app",
		payload: "{}",
		content_hash: "abc",
		status: "poison",
		attempts: 3,
		lease_until: null,
		locked_by: null,
		backoff_until: null,
		last_error: "boom",
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

/** Captures the SQL passed to db.db.prepare and the statement's get() rows. */
function prepareGetReturning(rows: Array<QueueJobRow | undefined>): void {
	let call = 0;
	vi.mocked(mocks.db.db.prepare).mockImplementation(() => ({
		get: vi.fn(() => {
			const row = rows[Math.min(call, rows.length - 1)];
			call += 1;
			return row;
		}),
		run: vi.fn()
	}));
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(mocks.outbox.listJobs).mockReturnValue({ items: [], total: 0 });
	vi.mocked(mocks.outbox.retryAllPoison).mockReturnValue(0);
	vi.mocked(mocks.outbox.retryJob).mockReturnValue(true);
	vi.mocked(mocks.outbox.deleteJob).mockReturnValue(true);
	prepareGetReturning([undefined]);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("QueueService.listJobs", () => {
	it("defaults to the admin view (pending + poison) when no statuses are given", () => {
		QueueService.listJobs(undefined, 10, 0);

		expect(mocks.outbox.listJobs).toHaveBeenCalledWith({
			statuses: ["pending", "poison"],
			limit: 10,
			offset: 0,
			repo: undefined
		});
	});

	it("passes explicit literal statuses through unchanged", () => {
		QueueService.listJobs(["done"], 5, 1);

		expect(mocks.outbox.listJobs).toHaveBeenCalledWith({
			statuses: ["done"],
			limit: 5,
			offset: 1,
			repo: undefined
		});
	});

	it("scopes the window to a single repo when repo is supplied (TASK-360)", () => {
		const statuses: QueueJobStatus[] = ["poison"];
		QueueService.listJobs(statuses, 10, 0, "acme/app");

		expect(mocks.outbox.listJobs).toHaveBeenCalledWith({
			statuses,
			limit: 10,
			offset: 0,
			repo: "acme/app"
		});
	});
});

describe("QueueService.retryJob", () => {
	it("flips a poison row back to pending via the outbox, inside the write lock", async () => {
		const row = makeJobRow({ status: "poison" });
		prepareGetReturning([row, { ...row, status: "pending" }]);

		const result = await QueueService.retryJob("job-1");

		expect(result.status).toBe("pending");
		expect(mocks.outbox.retryJob).toHaveBeenCalledWith("job-1", undefined);
		expect(mocks.db.withWrite).toHaveBeenCalledTimes(1);
	});

	it("throws 404 for an unknown id", async () => {
		prepareGetReturning([undefined]);

		await expect(QueueService.retryJob("ghost")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Queue job not found"
		});
		expect(mocks.outbox.retryJob).not.toHaveBeenCalled();
	});

	it("throws 409 for a live (pending) row — terminal-state guard", async () => {
		prepareGetReturning([makeJobRow({ status: "pending" })]);

		await expect(QueueService.retryJob("job-1")).rejects.toMatchObject({
			name: "ServiceError",
			status: 409,
			message: "Queue job 'job-1' has status 'pending' — only poison/done rows can be retried"
		});
		expect(mocks.outbox.retryJob).not.toHaveBeenCalled();
	});

	it("throws 409 when the guarded UPDATE matches zero rows (read/write race)", async () => {
		prepareGetReturning([makeJobRow({ status: "poison" })]);
		vi.mocked(mocks.outbox.retryJob).mockReturnValue(false);

		await expect(QueueService.retryJob("job-1")).rejects.toMatchObject({
			name: "ServiceError",
			status: 409,
			message: "Queue job 'job-1' is not retryable"
		});
	});

	it("builds the repo-scoped lookup with a PARAMETERIZED clause (no interpolation)", async () => {
		const getArgs: unknown[][] = [];
		vi.mocked(mocks.db.db.prepare).mockImplementation(() => ({
			get: vi.fn((...args: unknown[]) => {
				getArgs.push(args);
				return makeJobRow({ status: "poison", entity_repo: "acme/app" });
			}),
			run: vi.fn()
		}));

		await QueueService.retryJob("job-1", "acme/app");

		const sql = String(mocks.db.db.prepare.mock.calls[0][0]);
		expect(sql).toContain("AND entity_repo = ?");
		// The id + repo are bound as PARAMETERS (never interpolated into SQL).
		expect(getArgs[0]).toEqual(["job-1", "acme/app"]);
	});
});

describe("QueueService.retryAllPoison", () => {
	it("returns the flipped count from the outbox (0 is a valid idempotent outcome)", async () => {
		vi.mocked(mocks.outbox.retryAllPoison).mockReturnValue(0);
		expect(await QueueService.retryAllPoison()).toBe(0);
		expect(mocks.outbox.retryAllPoison).toHaveBeenCalledWith(undefined);
	});

	it("scopes a retry-all to a single repo when supplied (TASK-360)", async () => {
		vi.mocked(mocks.outbox.retryAllPoison).mockReturnValue(3);
		expect(await QueueService.retryAllPoison("acme/app")).toBe(3);
		expect(mocks.outbox.retryAllPoison).toHaveBeenCalledWith("acme/app");
	});
});

describe("QueueService.clearJob", () => {
	it("deletes a poison row inside the write lock and returns the ack", async () => {
		prepareGetReturning([makeJobRow({ status: "poison" })]);
		vi.mocked(mocks.outbox.deleteJob).mockReturnValue(true);

		const result = await QueueService.clearJob("job-1");

		expect(result).toEqual({ id: "job-1", message: "Deleted" });
		expect(mocks.outbox.deleteJob).toHaveBeenCalledWith("job-1", undefined);
		expect(mocks.db.withWrite).toHaveBeenCalledTimes(1);
	});

	it("throws 404 for an unknown id", async () => {
		prepareGetReturning([undefined]);

		await expect(QueueService.clearJob("ghost")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Queue job not found"
		});
	});

	it("throws 409 for a live (claimed) row", async () => {
		prepareGetReturning([makeJobRow({ status: "claimed" })]);

		await expect(QueueService.clearJob("job-1")).rejects.toMatchObject({
			name: "ServiceError",
			status: 409,
			message: "Queue job 'job-1' has status 'claimed' — only poison/done rows can be cleared"
		});
	});

	it("throws 409 when the guarded DELETE matches zero rows (race)", async () => {
		prepareGetReturning([makeJobRow({ status: "poison" })]);
		vi.mocked(mocks.outbox.deleteJob).mockReturnValue(false);

		await expect(QueueService.clearJob("job-1")).rejects.toMatchObject({
			name: "ServiceError",
			status: 409,
			message: "Queue job 'job-1' is not clearable"
		});
	});
});
