// ============================================================
// Native Cheat Engine ceserver HTTP client.
//
// ceserver (Cheat Engine's remote-process server) ships a tiny HTTP /
// JSON surface for process attach, AoB scan, pointer scan, memory R/W,
// Lua eval. The vendored `cheatengine-mcp-bridge` wraps the same surface.
// We absorb the client into our server so you don't need a separate MCP
// subprocess for the common operations.
//
// If ceserver / the bridge isn't running at the configured host:port,
// every tool returns an actionable "backend unreachable" message that
// points at `launch_re_backend id=cheat-engine-python` or the hub config.
// ============================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const ENV_HOST = "MCP_CESERVER_HOST";
const ENV_PORT = "MCP_CESERVER_PORT";

function endpoint(path: string): string {
  const host = process.env[ENV_HOST] ?? "127.0.0.1";
  const port = Number(process.env[ENV_PORT] ?? 52736);
  return `http://${host}:${port}${path.startsWith("/") ? path : "/" + path}`;
}

async function ceCall(path: string, body: unknown, timeoutMs = 10_000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(endpoint(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`ceserver HTTP ${resp.status}: ${text.slice(0, 400)}`);
    return text;
  } finally { clearTimeout(timer); }
}

function unreachable(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return [
    `ceserver unreachable: ${msg}`,
    ``,
    `Set MCP_CESERVER_HOST / MCP_CESERVER_PORT (default 127.0.0.1:52736), then either:`,
    `  • launch_re_backend id=cheat-engine-python`,
    `  • launch_re_backend id=cheat-engine-mcp`,
    `  • launch_re_backend id=cheat-engine-python-bridge   (vendored)`,
    `  • start ceserver + bridge manually from tools/vendor/cheatengine-mcp-bridge`,
  ].join("\n");
}

export function registerCeserverClient(server: McpServer): void {
  server.tool(
    "ce_attach",
    "Attach ceserver to a target process by name or pid.",
    { process: z.string().describe("Process name (e.g. 'csgo.exe') or numeric pid as a string.") },
    async ({ process: proc }: { process: string }) => {
      try {
        const r = await ceCall("/tool/attach", { process: proc });
        return { content: [{ type: "text" as const, text: `ce_attach(${proc})\n\n${r}` }] };
      } catch (e) { return { content: [{ type: "text" as const, text: unreachable(e) }], isError: true as const }; }
    }
  );

  server.tool(
    "ce_aob_scan",
    "AoB (array-of-bytes) scan via ceserver. Accepts CE-style wildcard syntax: '48 8B ?? ?? ?? ?? ?? E8'.",
    {
      pattern: z.string(),
      process: z.string().optional().describe("Target process; required if not already attached."),
      max: z.number().min(1).max(1000).default(32),
    },
    async ({ pattern, process: proc, max }: { pattern: string; process?: string; max: number }) => {
      try {
        const r = await ceCall("/tool/aobscan", { pattern, process: proc, max });
        return { content: [{ type: "text" as const, text: `ce_aob_scan(${pattern})\n\n${r}` }] };
      } catch (e) { return { content: [{ type: "text" as const, text: unreachable(e) }], isError: true as const }; }
    }
  );

  server.tool(
    "ce_pointer_scan",
    "Pointer-scan: find pointer chains that land at a given value / address. Thin wrapper over ceserver's pointer-scan.",
    {
      target: z.string().describe("Target value or address (hex)."),
      maxLevel: z.number().min(1).max(8).default(5),
      maxOffset: z.number().min(0).max(0x10000).default(0x400),
    },
    async ({ target, maxLevel, maxOffset }: { target: string; maxLevel: number; maxOffset: number }) => {
      try {
        const r = await ceCall("/tool/pointerscan", { target, maxLevel, maxOffset });
        return { content: [{ type: "text" as const, text: `ce_pointer_scan(${target}, lv=${maxLevel})\n\n${r}` }] };
      } catch (e) { return { content: [{ type: "text" as const, text: unreachable(e) }], isError: true as const }; }
    }
  );

  server.tool(
    "ce_read_memory",
    "Read process memory via ceserver.",
    {
      address: z.string().describe("Address as hex, e.g. '0x7FF6ABCD1234'."),
      size: z.number().min(1).max(1 << 20).default(0x100),
    },
    async ({ address, size }: { address: string; size: number }) => {
      try {
        const r = await ceCall("/tool/readmem", { address, size });
        return { content: [{ type: "text" as const, text: `ce_read_memory(${address}, ${size})\n\n${r}` }] };
      } catch (e) { return { content: [{ type: "text" as const, text: unreachable(e) }], isError: true as const }; }
    }
  );

  server.tool(
    "ce_write_memory",
    "Write process memory via ceserver.",
    {
      address: z.string(),
      bytesHex: z.string().describe("Space-separated hex bytes, e.g. '90 90 90 90'."),
    },
    async ({ address, bytesHex }: { address: string; bytesHex: string }) => {
      try {
        const r = await ceCall("/tool/writemem", { address, bytes: bytesHex });
        return { content: [{ type: "text" as const, text: `ce_write_memory(${address})\n\n${r}` }] };
      } catch (e) { return { content: [{ type: "text" as const, text: unreachable(e) }], isError: true as const }; }
    }
  );

  server.tool(
    "ce_lua",
    "Evaluate a Cheat Engine Lua expression inside the attached CE session via ceserver.",
    { code: z.string().describe("Lua code to run.") },
    async ({ code }: { code: string }) => {
      try {
        const r = await ceCall("/tool/lua", { code });
        return { content: [{ type: "text" as const, text: `ce_lua\n\n${r}` }] };
      } catch (e) { return { content: [{ type: "text" as const, text: unreachable(e) }], isError: true as const }; }
    }
  );

  server.tool(
    "ce_status",
    "Check whether ceserver is reachable at the configured host:port.",
    {},
    async () => {
      try {
        const r = await ceCall("/healthz", {}, 2000);
        return { content: [{ type: "text" as const, text: `ceserver OK @ ${endpoint("")}\n\n${r.slice(0, 400)}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: unreachable(e) }], isError: true as const };
      }
    }
  );
}
