import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

vi.mock("../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../mcp/storage/sqlite");
	const { StubVectorStore } = await import("../../mcp/storage/vectors.stub");
	const db = new SQLiteStore(":memory:");
	const vectors = new StubVectorStore(db);

	return {
		db,
		vectors,
		mcpClient: { start: vi.fn(), stop: vi.fn() },
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		},
		startTime: Date.now()
	};
});

describe("Dashboard Standards API", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const standardRoutes = (await import("../../dashboard/routes/standard.routes")).default;
		app = express();
		app.use(express.json({ limit: "50mb" }));
		app.use("/api/standards", standardRoutes);
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	it("supports create, list, get, update, and delete for /api/standards", async () => {
		const createRes = await fetch(`${baseUrl}/api/standards`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Parent Standard",
				content: "Top-level documentation rule.",
				tags: ["docs"],
				metadata: { source: "api-test" },
				repo: "api-standards-test",
				is_global: false
			})
		});
		expect(createRes.ok).toBe(true);
		const created = (await createRes.json()) as any;
		const parentId = created.data.id;

		const childRes = await fetch(`${baseUrl}/api/standards`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Child Standard",
				content: "Nested documentation rule.",
				parent_id: parentId,
				tags: ["docs", "child"],
				metadata: { source: "api-test" },
				repo: "api-standards-test",
				is_global: false
			})
		});
		expect(childRes.ok).toBe(true);
		const child = (await childRes.json()) as any;
		const childId = child.data.id;
		expect(child.data.attributes.parent_id).toBe(parentId);

		const listRes = await fetch(`${baseUrl}/api/standards?repo=api-standards-test`);
		expect(listRes.ok).toBe(true);
		const listed = (await listRes.json()) as any;
		expect(listed.data).toHaveLength(2);

		const getRes = await fetch(`${baseUrl}/api/standards/${childId}`);
		expect(getRes.ok).toBe(true);
		const fetched = (await getRes.json()) as any;
		expect(fetched.data.id).toBe(childId);
		expect(fetched.data.attributes.parent_id).toBe(parentId);

		const updateRes = await fetch(`${baseUrl}/api/standards/${childId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Child Standard Updated",
				parent_id: null,
				tags: ["docs", "updated"],
				metadata: { source: "api-test", updated: true }
			})
		});
		expect(updateRes.ok).toBe(true);

		const updatedGetRes = await fetch(`${baseUrl}/api/standards/${childId}`);
		const updated = (await updatedGetRes.json()) as any;
		expect(updated.data.attributes.title).toBe("Child Standard Updated");
		expect(updated.data.attributes.parent_id).toBeNull();

		const deleteRes = await fetch(`${baseUrl}/api/standards/${childId}`, { method: "DELETE" });
		expect(deleteRes.ok).toBe(true);

		const listAfterDeleteRes = await fetch(`${baseUrl}/api/standards?repo=api-standards-test`);
		const listAfterDelete = (await listAfterDeleteRes.json()) as any;
		expect(listAfterDelete.data).toHaveLength(1);
		expect(listAfterDelete.data[0].id).toBe(parentId);
	}, 15000);

	it("exports standards and imports large standard sets with upsert semantics", async () => {
		const repo = "bulk-standards-export-import";
		const standards = Array.from({ length: 1000 }, (_, index) => ({
			id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
			code: `B${String(index).padStart(5, "0")}`,
			title: `Bulk Standard ${index}`,
			content: `Rule ${index}: keep implementation behavior deterministic for bulk migration.`,
			parent_id: null,
			context: "bulk-migration",
			version: "1.0.0",
			language: "typescript",
			stack: ["node", "svelte"],
			is_global: false,
			repo,
			tags: ["bulk", "migration"],
			metadata: { source: "api-test", index },
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "vitest"
		}));

		const importRes = await fetch(`${baseUrl}/api/standards/import`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ schema: "local-memory-mcp.standards.v1", standards, refresh_vectors: false })
		});
		expect(importRes.ok).toBe(true);
		const imported = (await importRes.json()) as any;
		expect(imported.data.attributes.imported).toBe(1000);
		expect(imported.data.attributes.updated).toBe(0);
		expect(imported.data.attributes.vectors_refreshed).toBe(false);

		const exportRes = await fetch(`${baseUrl}/api/standards/export?repo=${encodeURIComponent(repo)}&scope=repo`);
		expect(exportRes.ok).toBe(true);
		const exported = (await exportRes.json()) as any;
		expect(exported.data.attributes.schema).toBe("local-memory-mcp.standards.v1");
		expect(exported.data.attributes.standards).toHaveLength(1000);

		const reimportRes = await fetch(`${baseUrl}/api/standards/import`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...exported.data.attributes, refresh_vectors: false })
		});
		expect(reimportRes.ok).toBe(true);
		const reimported = (await reimportRes.json()) as any;
		expect(reimported.data.attributes.imported).toBe(0);
		expect(reimported.data.attributes.updated).toBe(1000);

		const listRes = await fetch(`${baseUrl}/api/standards?repo=${encodeURIComponent(repo)}&pageSize=100`);
		const listed = (await listRes.json()) as any;
		expect(listed.meta.totalItems).toBe(1000);
	}, 30000);
});
