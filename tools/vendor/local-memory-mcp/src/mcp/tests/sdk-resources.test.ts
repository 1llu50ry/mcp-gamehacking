// SDK-level resource discovery + read regression tests (TASK-442).
//
// OpenCode gates MCP resource support on `initialize`-handshake truthiness of
// `client.getServerCapabilities()?.resources` (its `list_mcp_resources` tool
// throws "does not support resources" when the capability is absent), then
// consumes `resources/list` / `resources/templates/list` / `resources/read`.
//
// These tests drive the REAL production registration path
// (createMcpServer → mcp-server.ts → registerAllResources) over
// InMemoryTransport with the SDK Client, so a regression that empties
// resources/list, drops the resources capability, or breaks read dispatch
// fails here first — exactly what TASK-442 acceptance criteria 1-3 demand.
//
// TASK-442 regression: this SDK's UriTemplate treats `{?a,b,c}` as
// ALL-or-NOTHING, so a concrete URI with zero or a subset of the listed query
// params matched NO template and answered ResourceNotFound. The repository
// collection templates now register a plain form + one sibling template per
// documented param (same pattern as the codebase family), and the partial /
// no-query read tests below pin that behavior.
//
// Convention follows client.test.ts (SDK Client + InMemoryTransport) and
// index.test.ts / codebase-resources.test.ts (createTestStore fixtures): pure
// TS tests, no jsdom, no real DB.

import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../mcp-server";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { createSessionContext } from "../session";
import type { VectorStore } from "../types";

// The concrete (non-template) resources served by resources/list.
const CONCRETE_RESOURCES: ReadonlyArray<{ uri: string; name: string; mimeType: string }> = [
	{ uri: "repository://index", name: "repository-index", mimeType: "application/json" },
	{ uri: "session://roots", name: "session-roots", mimeType: "application/json" }
];

// Template URIs that MUST be listed by resources/templates/list: the plain
// no-query form, the full-query strict form, and one sibling per documented
// param, for every query-parameterized repository collection — plus the
// detail and codebase families.
const EXPECTED_TEMPLATE_URIS: ReadonlyArray<string> = [
	"repository://{name}/memories",
	"repository://{name}/memories{?search}",
	"repository://{name}/memories{?type}",
	"repository://{name}/memories{?tag}",
	"repository://{name}/memories{?limit}",
	"repository://{name}/memories{?offset}",
	"repository://{name}/memories{?search,type,tag,limit,offset}",
	"memory://{id}",
	"repository://{name}/tasks",
	"repository://{name}/tasks{?status}",
	"repository://{name}/tasks{?priority}",
	"repository://{name}/tasks{?limit}",
	"repository://{name}/tasks{?offset}",
	"repository://{name}/tasks{?status,priority,limit,offset}",
	"task://{id}",
	"repository://{name}/summary",
	"repository://{name}/actions",
	"repository://{name}/actions{?limit}",
	"repository://{name}/actions{?offset}",
	"repository://{name}/actions{?limit,offset}",
	"action://{id}",
	"codebase://{repo}/symbols",
	"codebase://{repo}/symbols/{name}",
	"codebase://{repo}/files/{+file_path}"
];

async function connectServer() {
	const db = await createTestStore();
	const vectors: VectorStore = new StubVectorStore(db);
	const { server } = createMcpServer(db, vectors, createSessionContext());

	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "sdk-resources-test", version: "1.0.0" });
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	return { db, client, server };
}

describe("SDK resource discovery (TASK-442 OpenCode compatibility)", () => {
	it("keeps canonical tools discoverable through the SDK transport", async () => {
		const { client, server, db } = await connectServer();
		try {
			const listed = await client.listTools();
			expect(listed.tools.map((tool) => tool.name)).toContain("codebase-index");
			expect(listed.tools.length).toBeGreaterThan(0);
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("advertises the resources capability in the initialize handshake", async () => {
		const { client, server, db } = await connectServer();
		try {
			// OpenCode's list_mcp_resources gate: !!getServerCapabilities()?.resources
			expect(client.getServerCapabilities()?.resources).toBeTruthy();
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("resources/list returns the concrete static resources (non-empty)", async () => {
		const { client, server, db } = await connectServer();
		try {
			const listed = await client.listResources();
			expect(listed.resources.length).toBeGreaterThan(0);

			for (const resource of CONCRETE_RESOURCES) {
				const entry = listed.resources.find((r) => r.uri === resource.uri);
				expect(entry).toBeDefined();
				expect(entry?.name).toBe(resource.name);
				expect(entry?.mimeType).toBe(resource.mimeType);
			}
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("resources/templates/list keeps concrete params forms discoverable", async () => {
		const { client, server, db } = await connectServer();
		try {
			const templates = await client.listResourceTemplates();
			const uris = templates.resourceTemplates.map((t) => t.uriTemplate);
			expect(uris.length).toBeGreaterThanOrEqual(24);
			for (const templateUri of EXPECTED_TEMPLATE_URIS) {
				expect(uris).toContain(templateUri);
			}
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("resources/read returns content for repository://index (parseable JSON)", async () => {
		const { client, server, db } = await connectServer();
		try {
			const result = await client.readResource({ uri: "repository://index" });
			const contents = result.contents as Array<{ uri: string; text: string }>;
			expect(contents.length).toBeGreaterThan(0);
			expect(contents[0]?.uri).toBe("repository://index");
			expect(() => JSON.parse(contents[0]?.text ?? "")).not.toThrow();
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("resources/read returns content for session://roots", async () => {
		const { client, server, db } = await connectServer();
		try {
			const result = await client.readResource({ uri: "session://roots" });
			const contents = result.contents as Array<{ text: string }>;
			const payload = JSON.parse(contents[0]?.text ?? "{}") as { roots: unknown[] };
			expect(Array.isArray(payload.roots)).toBe(true);
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("resources/read dispatches no-query template URIs (repository://{name}/memories)", async () => {
		const { client, server, db } = await connectServer();
		try {
			// TASK-442 regression: previously ResourceNotFound — the strict
			// {?a,b,c} form required ALL params to match.
			const result = await client.readResource({ uri: "repository://sdk-res/memories" });
			const contents = result.contents as Array<{ text: string }>;
			expect(() => JSON.parse(contents[0]?.text ?? "")).not.toThrow();
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("resources/read dispatches partial-query template URIs (repository://{name}/memories?type=…)", async () => {
		const { client, server, db } = await connectServer();
		try {
			// TASK-442 regression: a single-param subset previously matched no
			// template. The {?type} sibling now routes it to the shared reader.
			const result = await client.readResource({ uri: "repository://sdk-res/memories?type=code_fact" });
			const contents = result.contents as Array<{ text: string }>;
			expect(() => JSON.parse(contents[0]?.text ?? "")).not.toThrow();
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("resources/read dispatches task collection URIs (repository://{name}/tasks?status=…)", async () => {
		const { client, server, db } = await connectServer();
		try {
			const result = await client.readResource({ uri: "repository://sdk-res/tasks?status=pending" });
			const contents = result.contents as Array<{ text: string }>;
			expect(() => JSON.parse(contents[0]?.text ?? "")).not.toThrow();
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("completion/complete accepts the new sibling template URIs (no -32602)", async () => {
		const { client, server, db } = await connectServer();
		try {
			// TASK-442 regression: completion/complete passes the listed template
			// URI verbatim; the single-param siblings must not answer -32602.
			const nameResult = await client.complete({
				ref: { type: "ref/resource", uri: "repository://{name}/memories{?search}" },
				argument: { name: "name", value: "" }
			});
			expect(Array.isArray(nameResult.completion.values)).toBe(true);

			const tagResult = await client.complete({
				ref: { type: "ref/resource", uri: "repository://{name}/memories{?tag}" },
				argument: { name: "tag", value: "" }
			});
			expect(Array.isArray(tagResult.completion.values)).toBe(true);
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("completion/complete rejects unknown template URIs", async () => {
		const { client, server, db } = await connectServer();
		try {
			await expect(
				client.complete({
					ref: { type: "ref/resource", uri: "repository://{name}/nope" },
					argument: { name: "name", value: "" }
				})
			).rejects.toThrow();
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});

	it("resources/read rejects unknown URIs (ResourceNotFound)", async () => {
		const { client, server, db } = await connectServer();
		try {
			await expect(client.readResource({ uri: "unknown://scheme/value" })).rejects.toThrow(/not found/i);
		} finally {
			await client.close();
			await server.close();
			db.close();
		}
	});
});
