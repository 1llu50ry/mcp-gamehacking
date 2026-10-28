/**
 * `npm run schema:check`: the static half of the drift check. Without a
 * server, confirm that the coverage table and the committed snapshot agree:
 * every snapshot tool is classified, every classified tool is in the
 * snapshot, and every wire argument a wrapper can send exists in the tool's
 * input schema. A typo in a wire name fails here.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { TOOL_COVERAGE } from "../src/coverage.js";
import type { NormalizedTools } from "../test/support/schema.js";

const snapshotPath = fileURLToPath(new URL("../../schema/tools.json", import.meta.url));
const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as NormalizedTools;
const problems: string[] = [];

for (const tool of Object.keys(snapshot)) {
  if (TOOL_COVERAGE[tool] === undefined) {
    problems.push(`${tool} is in schema/tools.json but not classified in src/coverage.ts`);
  }
}
for (const [tool, entry] of Object.entries(TOOL_COVERAGE)) {
  const schema = snapshot[tool];
  if (schema === undefined) {
    problems.push(`${tool} is classified in src/coverage.ts but missing from schema/tools.json`);
    continue;
  }
  if (entry.status !== "wrapped") continue;
  for (const arg of entry.sends) {
    if (!(arg in schema.properties)) {
      problems.push(`${tool}: the SDK can send "${arg}", which the snapshot's schema lacks`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(
    "\nFix the wire name, or run `npm run schema:update` against a current server and update " +
      "the wrapper, its types, tests and docs.",
  );
  process.exit(1);
}
console.log(`schema check passed: ${Object.keys(snapshot).length} tools classified`);
