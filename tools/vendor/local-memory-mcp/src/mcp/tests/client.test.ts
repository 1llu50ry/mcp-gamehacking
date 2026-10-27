// Integration tests for the SDK-based MCPClient wrapper

import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { MCPClient } from "../client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

describe("MCPClient (SDK-based)", () => {
	it("can be instantiated with no arguments", () => {
		const client = new MCPClient();
		expect(client).toBeInstanceOf(MCPClient);
	});

	it("isConnected() returns false before start()", () => {
		const client = new MCPClient();
		expect(client.isConnected()).toBe(false);
	});

	it("getPendingCount() returns 0", () => {
		const client = new MCPClient();
		expect(client.getPendingCount()).toBe(0);
	});

	it("stop() is safe to call before start()", async () => {
		const client = new MCPClient();
		await expect(client.stop()).resolves.toBeUndefined();
	});

	it("start() throws when server.js is not found", async () => {
		const client = new MCPClient("/nonexistent/server.js");
		await expect(client.start()).rejects.toThrow();
	});
});

describe("SDK Client integration", () => {
	it("Client can be created with name and version", () => {
		const client = new Client({ name: "test", version: "1.0.0" });
		expect(client).toBeDefined();
	});

	it("InMemoryTransport can connect a client to a server", async () => {
		const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { tools: {} } });

		server.registerTool(
			"greet",
			{
				description: "Greet someone",
				inputSchema: z.object({ name: z.string() })
			},
			async (args: any) => ({
				content: [{ type: "text" as const, text: `Hello, ${args.name}!` }]
			})
		);

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "test-client", version: "1.0.0" });

		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

		const tools = await client.listTools();
		expect(tools.tools).toBeDefined();
		const toolNames = tools.tools.map((t: any) => t.name);
		expect(toolNames).toContain("greet");

		const result = await client.callTool({ name: "greet", arguments: { name: "World" } });
		const content = result.content as Array<{ type: string; text: string }>;
		expect(content[0].text).toBe("Hello, World!");

		await client.close();
		await server.close();
	});

	it("Client readResource integration with InMemoryTransport", async () => {
		const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { resources: {} } });

		server.registerResource("config", "config://app", { mimeType: "application/json" }, async (_uri: unknown) => ({
			contents: [
				{
					uri: "config://app",
					text: JSON.stringify({ debug: true })
				}
			]
		}));

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "test-client", version: "1.0.0" });

		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

		const resources = await client.listResources();
		expect(resources.resources).toBeDefined();

		const result = await client.readResource({ uri: "config://app" });
		const contents = result.contents as Array<{ uri: string; text: string }>;
		expect(contents[0].text).toContain("debug");

		await client.close();
		await server.close();
	});

	it("Client can list prompts", async () => {
		const server = new McpServer({ name: "test-server", version: "1.0.0" }, { capabilities: { prompts: {} } });

		server.registerPrompt(
			"review",
			{
				description: "Review code",
				argsSchema: z.object({ code: z.string() })
			},
			async (args: any) => ({
				messages: [{ role: "user" as const, content: { type: "text" as const, text: `Review: ${args.code}` } }]
			})
		);

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "test-client", version: "1.0.0" });

		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

		const prompts = await client.listPrompts();
		expect(prompts.prompts).toBeDefined();
		const promptNames = prompts.prompts.map((p: any) => p.name);
		expect(promptNames).toContain("review");

		await client.close();
		await server.close();
	});
});
