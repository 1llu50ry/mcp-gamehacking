import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * SDK-based MCP client that spawns the local MCP server as a child process
 * and communicates via the official @modelcontextprotocol/client SDK.
 *
 * Replaces the old raw-JSON-RPC-over-child_process client.
 */
export class MCPClient {
	private client: Client;
	private transport: StdioClientTransport | null = null;
	private _connected = false;
	private serverPathOverride?: string;

	constructor(serverPath?: string) {
		this.serverPathOverride = serverPath;
		this.client = new Client(
			{ name: "mcp-client", version: "1.0.0" },
			{
				enforceStrictCapabilities: false
			}
		);
	}

	async start(): Promise<void> {
		if (this._connected) return;

		const serverPath =
			this.serverPathOverride ||
			(fs.existsSync(path.join(__dirname, "../mcp/server.js"))
				? path.join(__dirname, "../mcp/server.js")
				: path.join(__dirname, "./server.js"));

		this.transport = new StdioClientTransport({
			command: "node",
			args: [serverPath]
		});

		await this.client.connect(this.transport);
		this._connected = true;
	}

	async call(method: string, params: unknown = {}): Promise<unknown> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return this.client.request({ method, params } as any);
	}

	async callTool(toolName: string, args: unknown): Promise<unknown> {
		return this.client.callTool({
			name: toolName,
			arguments: args as Record<string, unknown>
		});
	}

	async readResource(uri: string): Promise<unknown> {
		return this.client.readResource({ uri });
	}

	async stop(): Promise<void> {
		this._connected = false;
		await this.client.close();
		this.transport = null;
	}

	isConnected(): boolean {
		return this._connected;
	}

	getPendingCount(): number {
		return 0;
	}
}
