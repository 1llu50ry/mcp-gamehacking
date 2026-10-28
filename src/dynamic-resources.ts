// MCP Resource templates for discoverable, URI-addressable
// skill library content.
//
//   gamehacking://skills/{name}        a hand-written SKILL.md
//   gamehacking://ags/{name}           an ags-* archive summary
//   gamehacking://plugins/{category}/{name}
//   gamehacking://agents/{category}/{name}
//   gamehacking://prompts/{category}/{name}
//   gamehacking://subagents/{category}/{name}
//
// Each resource exposes a stable URL that an MCP client can
// subscribe to, link to, or hand around; our handler fetches
// the matching .md file.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

const notFound = (uri: URL) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: `not found: ${uri.href}` }] });

export function registerDynamicResources(server: McpServer, projectRoot: string): void {
  server.resource(
    "skill-dyn",
    new ResourceTemplate("gamehacking://skills/{name}", { list: undefined }),
    { description: "Hand-written or archived skill by name." },
    async (uri, { name }) => {
      try {
        const text = await readFile(join(projectRoot, "skills", name as string, "SKILL.md"), "utf8");
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
      } catch {
        return notFound(uri);
      }
    }
  );

  server.resource(
    "ags-source",
    new ResourceTemplate("gamehacking://ags/{name}/source", { list: undefined }),
    { description: "Source dump (if available) for an ags-* archive skill." },
    async (uri, { name }) => {
      // After the gzip migration, source.txt may be absent on disk and
      // the real payload lives next to it as source.txt.gz. Try both.
      const base = join(projectRoot, "skills", name as string, "source.txt");
      try {
        const text = await readFile(base, "utf8");
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: text.slice(0, 1_000_000) }] };
      } catch {
        try {
          const { gunzipSync } = await import("node:zlib");
          const text = gunzipSync(await readFile(base + ".gz")).toString("utf-8");
          return { contents: [{ uri: uri.href, mimeType: "text/plain", text: text.slice(0, 1_000_000) }] };
        } catch { return notFound(uri); }
      }
    }
  );

  for (const kind of ["plugins", "agents", "subagents", "prompts"]) {
    server.resource(
      `${kind}-dyn`,
      new ResourceTemplate(`gamehacking://${kind}/{category}/{name}`, { list: undefined }),
      { description: `A ${kind.replace(/s$/, "")} by category + name.` },
      async (uri, { category, name }) => {
        try {
          const text = await readFile(join(projectRoot, kind, category as string, (name as string) + ".md"), "utf8");
          return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
        } catch {
          return notFound(uri);
        }
      }
    );
  }
}
