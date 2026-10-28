/**
 * `npm run schema:update`: start the server named by AI_MEMORY_BIN, read its
 * `tools/list`, and rewrite `schema/tools.json`. Run it after a server change
 * to an MCP tool, then update the wrapper, its types, tests and docs.
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { fetchToolsList } from "../test/support/tools-list.js";
import { normalizeTools, stableStringify } from "../test/support/schema.js";
import { startServer } from "../test/support/server.js";

const target = fileURLToPath(new URL("../../schema/tools.json", import.meta.url));
const server = await startServer();
try {
  const normalized = normalizeTools(await fetchToolsList(server.url, server.rootToken));
  await writeFile(target, stableStringify(normalized));
  console.log(`wrote ${Object.keys(normalized).length} tools to schema/tools.json`);
} finally {
  await server.stop();
}
