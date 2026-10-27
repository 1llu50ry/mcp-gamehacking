import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pkgVersion = "0.1.0";

// __PKG_VERSION__ is injected at build time by tsup define
// Fallback: walk up directory tree to find package.json
if (typeof __PKG_VERSION__ !== "undefined" && __PKG_VERSION__) {
	pkgVersion = __PKG_VERSION__;
} else {
	let searchDir = __dirname;
	for (let i = 0; i < 5; i++) {
		const candidate = path.join(searchDir, "package.json");
		try {
			if (fs.existsSync(candidate)) {
				const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
				if (pkg.name === "@vheins/local-memory-mcp" && pkg.version) {
					pkgVersion = pkg.version;
					break;
				}
			}
		} catch {
			/* try next */
		}
		searchDir = path.dirname(searchDir);
	}
}

declare const __PKG_VERSION__: string;

// MCP Protocol version supported by this server
export const MCP_PROTOCOL_VERSION = "2025-03-26";

// Server info for the MCP initialize response
export const CAPABILITIES = {
	serverInfo: {
		name: "local-memory-mcp",
		version: pkgVersion
	},
	capabilities: {
		// Advertises roots-derived per-session scoping intent: the server reads
		// the client's MCP roots (listRoots + notifications/roots/list_changed)
		// to resolve owner/repo/projectPath per connection.
		roots: {},
		completions: {},
		logging: {},
		resources: {
			subscribe: true,
			listChanged: true
		},
		tools: {
			listChanged: false
		},
		prompts: {
			listChanged: true
		}
	}
};
