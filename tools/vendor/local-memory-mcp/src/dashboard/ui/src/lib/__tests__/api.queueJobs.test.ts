// ─── api.queueJobs — repo is optional (TASK-418/TASK-419) ────────────────────
// Pure unit test (node env, no DOM): mocks global fetch and asserts the URL
// shape of GET /api/queue/jobs — `?repo=` is present when a repo is given and
// omitted when empty, so the backend serves the GLOBAL queue (MEM-1457).
import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../api";

function mockFetchOnce(body: unknown) {
	return vi.spyOn(globalThis, "fetch").mockResolvedValue({
		ok: true,
		json: async () => body
	} as unknown as Response);
}

describe("api.queueJobs — repo-optional param", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("omits ?repo= when repo is empty", async () => {
		const fetchMock = mockFetchOnce({
			data: [],
			meta: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 }
		});

		await api.queueJobs({ repo: "", status: "poison", page: 1, pageSize: 50 });

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toBe("/api/queue/jobs?status=poison&page=1&pageSize=50");
		expect(url).not.toContain("repo=");
	});

	it("omits ?repo= when no params are provided at all", async () => {
		const fetchMock = mockFetchOnce({
			data: [],
			meta: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 }
		});

		await api.queueJobs({});

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toBe("/api/queue/jobs?");
	});

	it("includes ?repo= when a repo is provided", async () => {
		const fetchMock = mockFetchOnce({
			data: [],
			meta: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 }
		});

		await api.queueJobs({ repo: "my-repo", status: "poison", page: 1, pageSize: 50 });

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toBe("/api/queue/jobs?repo=my-repo&status=poison&page=1&pageSize=50");
	});

	it("passes the JSON:API response through as { jobs, pagination }", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{
						id: "job-1",
						type: "queue-job",
						attributes: {
							entity_kind: "memory",
							entity_id: "mem-1",
							entity_repo: "my-repo",
							status: "poison",
							attempts: 2,
							max_attempts: 3,
							enqueued_at: "2026-08-11T00:00:00Z",
							processed_at: "2026-08-11T00:00:01Z",
							last_error: "boom"
						}
					}
				],
				meta: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 }
			})
		} as unknown as Response);

		const result = await api.queueJobs({ repo: "my-repo", page: 1, pageSize: 50, status: "poison" });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.jobs).toHaveLength(1);
		expect(result.jobs[0].id).toBe("job-1");
		expect(result.jobs[0].entity_repo).toBe("my-repo");
		expect(result.jobs[0].status).toBe("poison");
		expect(result.pagination.totalItems).toBe(1);
		expect(result.pagination.totalPages).toBe(1);
	});
});
