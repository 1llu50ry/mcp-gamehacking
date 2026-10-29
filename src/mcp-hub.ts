// ============================================================
// MCP Hub -- aggregate multiple backend MCP servers
//
// Our server becomes a CLIENT to other MCPs (ghidra-mcp,
// ida-pro-mcp, x64dbg-mcp, superghidra-mcp, ...) and re-exposes
// their tools as our own. Each remote tool gets a prefix:
//
//   ghidra__decompile, ida__decompile, x64dbg__get_state, ...
//
// Composable "smart_*" tools dispatch to the best available
// backend by capability and binary type.
// ============================================================

import { spawn } from "node:child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

interface HubBackend {
  id: string;
  kind: "stdio" | "http";
  cmd?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  client?: Client;
  tools?: { name: string; description?: string; inputSchema?: unknown }[];
  connectedAt?: number;
  lastError?: string;
}

const connected = new Map<string, HubBackend>();

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export function registerMcpHub(server: McpServer): void {
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const err = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const });

  // ----- hub_connect -----
  server.tool(
    "hub_connect",
    "Connect our server to another MCP server as a client. On success, that server's tools become callable via `hub_call` (and get a 'tools/list changed' notification from our server). Supports stdio and streamable-http transports.",
    {
      id: z.string().describe("Alias for the backend (e.g. 'ghidra', 'ida', 'x64dbg')."),
      transport: z.enum(["stdio", "http"]).default("stdio"),
      cmd: z.string().optional().describe("stdio: command to spawn (e.g. 'pyghidra-mcp')."),
      args: z.array(z.string()).optional().describe("stdio: args list."),
      env: z.record(z.string(), z.string()).optional().describe("stdio: extra env vars."),
      url: z.string().optional().describe("http: endpoint URL."),
    },
    async ({ id, transport, cmd, args, env, url }: { id: string; transport: "stdio" | "http"; cmd?: string; args?: string[]; env?: Record<string, string>; url?: string }) => {
      if (connected.has(id)) return err(`already connected: ${id}`);
      try {
        const client = new Client({ name: `mcp-reverse-hub`, version: "4.4.0" }, { capabilities: {} });
        let be: HubBackend = { id, kind: transport };
        if (transport === "stdio") {
          if (!cmd) return err("stdio transport requires `cmd`");
          const t = new StdioClientTransport({
            command: cmd,
            args: args ?? [],
            env: { ...process.env, ...env } as Record<string, string>,
          });
          await client.connect(t);
          be.cmd = cmd; be.args = args; be.env = env;
        } else {
          if (!url) return err("http transport requires `url`");
          const t = new StreamableHTTPClientTransport(new URL(url));
          await client.connect(t);
          be.url = url;
        }
        const toolsResp = await client.listTools();
        be.client = client;
        be.tools = toolsResp.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
        be.connectedAt = Date.now();
        connected.set(id, be);
        return ok(`connected to backend "${id}" (${transport}). exposes ${be.tools.length} tools. Call them with hub_call id=${id} tool=...`);
      } catch (e) {
        return err(`connect failed: ${(e as Error).message}`);
      }
    }
  );

  // ----- hub_list -----
  server.tool(
    "hub_list",
    "List connected backends and their tools.",
    { id: z.string().optional().describe("Show tools for just this backend.") },
    async ({ id }: { id?: string }) => {
      if (connected.size === 0) return ok("no backends connected. Use hub_connect to add one.");
      const rows: string[] = [];
      for (const be of connected.values()) {
        if (id && be.id !== id) continue;
        rows.push(`## ${be.id} (${be.kind}${be.url ? " " + be.url : be.cmd ? " `" + be.cmd + "`" : ""})`);
        rows.push(`connected ${be.connectedAt ? new Date(be.connectedAt).toISOString() : "?"}, ${be.tools?.length ?? 0} tools`);
        for (const t of be.tools ?? []) rows.push(`  - ${t.name}  ${t.description?.slice(0, 100) ?? ""}`);
        rows.push("");
      }
      return ok(`# Hub backends\n\n${rows.join("\n")}`);
    }
  );

  // ----- hub_call -----
  server.tool(
    "hub_call",
    "Invoke a tool on a connected backend. Example: `hub_call id=ghidra tool=decompile args={\"function\":\"main\"}`.",
    {
      id: z.string(),
      tool: z.string(),
      args: z.record(z.string(), z.unknown()).default({}),
    },
    async ({ id, tool, args }: { id: string; tool: string; args: Record<string, unknown> }) => {
      const be = connected.get(id);
      if (!be?.client) return err(`backend "${id}" not connected`);
      try {
        const resp = await be.client.callTool({ name: tool, arguments: args });
        const content = resp.content as { type: string; text?: string }[] | undefined;
        const text = content?.map((c) => c.text ?? JSON.stringify(c)).join("\n") ?? JSON.stringify(resp);
        return ok(`# ${id}:${tool}\n\n${text}`);
      } catch (e) {
        return err(`call failed on ${id}:${tool}: ${(e as Error).message}`);
      }
    }
  );

  // ----- hub_disconnect -----
  server.tool(
    "hub_disconnect",
    "Disconnect a backend. Shuts down its transport.",
    { id: z.string() },
    async ({ id }: { id: string }) => {
      const be = connected.get(id);
      if (!be) return err(`not connected: ${id}`);
      try { await be.client?.close(); } catch { /* best effort */ }
      connected.delete(id);
      return ok(`disconnected ${id}`);
    }
  );

  // ----- smart_decompile -----
  server.tool(
    "smart_decompile",
    "Decompile a function by dispatching to whichever connected backend offers decompilation (ghidra, ida, binja, retdec). Returns the first successful result and an alternative-provider list.",
    {
      functionName: z.string().describe("Function name or address (e.g. 'main' or '0x401000')."),
      preferred: z.string().optional().describe("Preferred backend id if available."),
    },
    async ({ functionName, preferred }: { functionName: string; preferred?: string }) => {
      // Candidate backends with a tool named like 'decompile'
      const candidates = [...connected.values()].filter((b) => b.client && b.tools?.some((t) => /decompile|decomp|pseudocode/i.test(t.name)));
      if (!candidates.length) return err("no connected backend offers a decompile-like tool. Use hub_connect first.");
      const ordered = preferred
        ? [...candidates].sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0))
        : candidates;
      const errors: string[] = [];
      for (const be of ordered) {
        const toolName = be.tools?.find((t) => /decompile|decomp|pseudocode/i.test(t.name))?.name;
        if (!toolName) continue;
        try {
          const resp = await be.client!.callTool({ name: toolName, arguments: { function: functionName, name: functionName, address: functionName } });
          const content = resp.content as { type: string; text?: string }[] | undefined;
          const text = content?.map((c) => c.text ?? "").join("\n") ?? "";
          return ok(`# smart_decompile via ${be.id}:${toolName}\n\n${text}\n\n_alternative backends: ${ordered.filter((b) => b.id !== be.id).map((b) => b.id).join(", ") || "(none)"}_`);
        } catch (e) {
          errors.push(`${be.id}: ${(e as Error).message}`);
        }
      }
      return err(`all decompile backends failed:\n${errors.join("\n")}`);
    }
  );

  // ----- hub_consensus_call -----
  server.tool(
    "hub_consensus_call",
    "Fan a tool call out across every backend whose tool matches `matcher` (regex). Returns one block per backend; your agent (or `mesh_task_vote`) decides consensus.",
    {
      matcher: z.string().describe("Regex that matches tool names (e.g. 'decompile', 'xrefs|references')."),
      args: z.record(z.string(), z.unknown()).default({}),
      limit: z.number().min(1).max(16).default(8).describe("Max backends to fan out to."),
    },
    async ({ matcher, args, limit }: { matcher: string; args: Record<string, unknown>; limit: number }) => {
      let re: RegExp;
      try { re = new RegExp(matcher, "i"); } catch (e) { return err(`bad regex: ${(e as Error).message}`); }
      const picks: { be: HubBackend; tool: string }[] = [];
      for (const be of connected.values()) {
        if (picks.length >= limit) break;
        const t = be.tools?.find((t) => re.test(t.name));
        if (t && be.client) picks.push({ be, tool: t.name });
      }
      if (!picks.length) return err(`no backend tool matches /${matcher}/i`);
      const results = await Promise.all(picks.map(async ({ be, tool }) => {
        try {
          const resp = await be.client!.callTool({ name: tool, arguments: args });
          const content = resp.content as { type: string; text?: string }[] | undefined;
          return { id: be.id, tool, ok: true as const, text: content?.map((c) => c.text ?? "").join("\n") ?? "" };
        } catch (e) {
          return { id: be.id, tool, ok: false as const, text: (e as Error).message };
        }
      }));
      const sections = results.map((r) => `## ${r.id}:${r.tool} ${r.ok ? "" : "(FAILED)"}\n${r.text.slice(0, 3000)}`);
      return ok(`# consensus call /${matcher}/\n\n${sections.join("\n\n")}`);
    }
  );
}

// shutdown hook
process.on("exit", () => {
  for (const be of connected.values()) {
    try { be.client?.close(); } catch { /* ignore */ }
  }
});
