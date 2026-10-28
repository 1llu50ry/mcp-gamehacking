/**
 * Schema drift (design doc §5.3): the committed `schema/tools.json` must match
 * the `tools/list` of the server built from the same commit, and every server
 * tool must be classified in `src/coverage.ts`. A server change to an MCP tool
 * fails here until the SDK is updated in the same change.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { TOOL_COVERAGE } from "../../src/coverage.js";
import { diffTools, normalizeTools, type NormalizedTools } from "../support/schema.js";
import { startServer, type ServerHandle } from "../support/server.js";
import { fetchToolsList } from "../support/tools-list.js";

const HOW_TO_FIX =
  "Run `npm run schema:update` in companions/ai-memory-ts against this build, then update " +
  "src/coverage.ts and the wrapper, its types, tests and docs (AGENTS.md: MCP tool surface changes).";

let server: ServerHandle;
let live: NormalizedTools;
let snapshot: NormalizedTools;

before(async () => {
  server = await startServer();
  live = normalizeTools(await fetchToolsList(server.url, server.rootToken));
  const path = fileURLToPath(new URL("../../../schema/tools.json", import.meta.url));
  snapshot = JSON.parse(await readFile(path, "utf8")) as NormalizedTools;
});
after(async () => server.stop());

describe("schema drift", () => {
  it("the committed snapshot matches the server's tools/list", () => {
    const findings = diffTools(snapshot, live);
    assert.deepEqual(findings, [], `${findings.join("\n")}\n\n${HOW_TO_FIX}`);
  });

  it("every server tool is classified as wrapped or not exposed", () => {
    const unclassified = Object.keys(live).filter((tool) => TOOL_COVERAGE[tool] === undefined);
    assert.deepEqual(unclassified, [], `unclassified tools: ${unclassified.join(", ")}\n${HOW_TO_FIX}`);
    const stale = Object.keys(TOOL_COVERAGE).filter((tool) => live[tool] === undefined);
    assert.deepEqual(stale, [], `classified tools the server no longer lists: ${stale.join(", ")}`);
  });

  it("the diff names the tool and the property that changed", () => {
    const changed: NormalizedTools = structuredClone(live);
    const write = changed["memory_write_page"];
    assert.ok(write !== undefined);
    delete write.properties["expected_page_id"];
    changed["memory_new_tool"] = { properties: {}, required: [] };
    delete changed["memory_status"];
    assert.deepEqual(diffTools(live, changed), [
      "new tool on the server: memory_new_tool",
      "tool removed from the server: memory_status",
      "memory_write_page: properties differ: expected_page_id",
    ]);
  });
});
