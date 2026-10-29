// ============================================================
// tool_search / tool_help — meta-navigation for the 268-tool
// surface. Both read the live tool registry out of the McpServer
// instance (the SDK keeps it as `server.server._requestHandlers`
// behind the scenes, but the stable public access path is through
// the ListTools response). We route via the server's own `tools/list`
// equivalent for forward compatibility.
// ============================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// We can't call tools/list from inside a tool handler (would deadlock
// the transport). Instead, maintain a shadow registry — every call to
// server.tool goes through our wrapper in index.ts, so we add an
// entry here at the same time. See `recordTool` below.
interface ToolEntry { name: string; description: string }
const REGISTRY: ToolEntry[] = [];

export function recordTool(name: string, description: string | undefined): void {
  // Replace on re-registration (not expected, but keep the map tidy).
  const i = REGISTRY.findIndex(t => t.name === name);
  const entry: ToolEntry = { name, description: (description ?? "").slice(0, 400) };
  if (i >= 0) REGISTRY[i] = entry; else REGISTRY.push(entry);
}

function score(entry: ToolEntry, needles: string[]): number {
  const hay = (entry.name + "\n" + entry.description).toLowerCase();
  let s = 0;
  for (const n of needles) {
    const nn = n.toLowerCase();
    if (!nn) continue;
    if (entry.name.toLowerCase() === nn) s += 100;
    else if (entry.name.toLowerCase().startsWith(nn)) s += 40;
    else if (entry.name.toLowerCase().includes(nn)) s += 20;
    if (entry.description.toLowerCase().includes(nn)) s += 5;
    // bonus for word-boundary match in description
    if (new RegExp(`\\b${nn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay)) s += 10;
  }
  return s;
}

export function registerToolMeta(server: McpServer): void {
  server.tool(
    "tool_search",
    "Fuzzy search across every MCP tool this server exposes. Returns the top matches ranked by name + description relevance. Great for `what-tool-does-X` navigation when the catalog grew to 268+.",
    { query: z.string().min(1), limit: z.number().min(1).max(50).default(15) },
    async ({ query, limit }) => {
      const needles = query.split(/\s+/).filter(Boolean);
      const ranked = REGISTRY
        .map(e => ({ e, s: score(e, needles) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, limit);
      if (!ranked.length) return { content: [{ type: "text" as const, text: `# tool_search \`${query}\`\n\nno matches among ${REGISTRY.length} tools` }] };
      return { content: [{ type: "text" as const, text:
        `# tool_search \`${query}\`\n\n**matches:** ${ranked.length} of ${REGISTRY.length}\n\n` +
        ranked.map(({ e, s }) => `- \`${e.name}\` _(score=${s})_\n  ${e.description.slice(0, 200)}`).join("\n")
      }] };
    });

  server.tool(
    "tool_help",
    "Return the full description of a single tool by exact name. Prefer tool_search first if the name is uncertain.",
    { name: z.string() },
    async ({ name }) => {
      const entry = REGISTRY.find(e => e.name === name);
      if (!entry) return { content: [{ type: "text" as const, text: `# tool_help ${name}\n\nnot in registry (${REGISTRY.length} tools indexed)` }], isError: true as const };
      return { content: [{ type: "text" as const, text: `# tool_help ${entry.name}\n\n${entry.description}` }] };
    });

  server.tool(
    "tool_catalog",
    "List every tool name grouped by its leading prefix (ghidra_* / r2_* / lldb_* etc.) — a bird's-eye index of the whole catalog.",
    { prefix: z.string().optional() },
    async ({ prefix }) => {
      const filtered = prefix ? REGISTRY.filter(e => e.name.startsWith(prefix)) : REGISTRY;
      const groups = new Map<string, string[]>();
      for (const e of filtered) {
        const key = e.name.split("_")[0] || e.name;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(e.name);
      }
      const sortedGroups = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
      return { content: [{ type: "text" as const, text:
        `# tool_catalog${prefix ? ` /${prefix}/` : ""}\n\n**total:** ${filtered.length}\n\n` +
        sortedGroups.map(([k, v]) => `## ${k} (${v.length})\n${v.map(n => `- \`${n}\``).join("\n")}`).join("\n\n")
      }] };
    });
}
