/**
 * Streamable HTTP transport integration tests.
 *
 * Starts the real HTTP transport (node:http bridge + SDK createMcpHandler) on
 * an ephemeral loopback port against an in-memory store + stub vectors, then
 * exercises it with the SDK's StreamableHTTPClientTransport:
 *   - bearer auth is enforced (401 without/with a wrong token);
 *   - a valid session completes an initialize + tools/list round-trip;
 *   - multiple concurrent sessions are served by the one daemon.
 *
 * Hermetic: uses createTestStore + StubVectorStore, so no ONNX model / network.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { createServerFactory } from "../transport/factory";
import { startHttpTransport, type HttpTransportHandle } from "../transport/http";

const TOKEN = "example-bearer-token";

interface Harness {
	store: SQLiteStore;
	handle: HttpTransportHandle;
}

const active: Harness[] = [];

/** Start an HTTP transport on an ephemeral port backed by a fresh in-memory store. */
async function startHarness(): Promise<Harness> {
	const store = await createTestStore();
	const vectors = new StubVectorStore(store);
	const handle = await startHttpTransport({
		host: "127.0.0.1",
		port: 0,
		path: "/mcp",
		token: TOKEN,
		allowInsecure: false,
		factory: createServerFactory(store, vectors, "http")
	});
	const harness = { store, handle };
	active.push(harness);
	return harness;
}

afterEach(async () => {
	while (active.length > 0) {
		const harness = active.pop()!;
		await harness.handle.close();
		harness.store.close();
	}
});

describe("MCP HTTP transport — auth", () => {
	it("refuses to start without a token unless insecure mode is allowed", async () => {
		const store = await createTestStore();
		const vectors = new StubVectorStore(store);
		try {
			await expect(
				startHttpTransport({
					host: "127.0.0.1",
					port: 0,
					path: "/mcp",
					token: undefined,
					allowInsecure: false,
					factory: createServerFactory(store, vectors, "http")
				})
			).rejects.toThrow(/requires a bearer token/i);
		} finally {
			store.close();
		}
	});

	it("rejects a request without a bearer token with 401", async () => {
		const { handle } = await startHarness();
		const res = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
		});
		expect(res.status).toBe(401);
		expect(res.headers.get("www-authenticate")).toContain("Bearer");
	});

	it("rejects a wrong bearer token with 401", async () => {
		const { handle } = await startHarness();
		const res = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				Authorization: "Bearer wrong-token"
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
		});
		expect(res.status).toBe(401);
	});

	it("returns 404 for a path other than the configured endpoint", async () => {
		const { handle } = await startHarness();
		const res = await fetch(`${handle.url}/nope`, {
			headers: { Authorization: `Bearer ${TOKEN}` }
		});
		expect(res.status).toBe(404);
	});
});

describe("MCP HTTP transport — session round-trip", () => {
	it("accepts a valid session and completes initialize + tools/list", async () => {
		const { handle } = await startHarness();

		const transport = new StreamableHTTPClientTransport(new URL(`${handle.url}/mcp`), {
			requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }
		});
		const client = new Client({ name: "http-test-client", version: "1.0.0" });

		await client.connect(transport);
		try {
			const tools = await client.listTools();
			expect(Array.isArray(tools.tools)).toBe(true);
			expect(tools.tools.length).toBeGreaterThan(0);
		} finally {
			await client.close();
		}
	});
});

describe("MCP HTTP transport — concurrent sessions", () => {
	it("serves multiple concurrent clients over the one daemon", async () => {
		const { handle } = await startHarness();

		const makeClient = async () => {
			const transport = new StreamableHTTPClientTransport(new URL(`${handle.url}/mcp`), {
				requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }
			});
			const client = new Client({ name: "http-concurrent-client", version: "1.0.0" });
			await client.connect(transport);
			return client;
		};

		const clients = await Promise.all([makeClient(), makeClient(), makeClient()]);
		try {
			const results = await Promise.all(clients.map((client) => client.listTools()));
			for (const result of results) {
				expect(result.tools.length).toBeGreaterThan(0);
			}
		} finally {
			await Promise.all(clients.map((client) => client.close()));
		}
	});
});
