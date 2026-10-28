/**
 * The README quickstart: connect, check the server, write a page, search,
 * read it back, and pass a handoff to the next run.
 *
 *   node build/examples/quickstart.js
 */
import { AiMemoryClient } from "ai-memory-ts";

import { scope, serverUrl, token } from "./env.js";

const memory = new AiMemoryClient({ serverUrl, token, scope });

// Confirm the connection and the token. Reads never create a project, so
// project calls like status() come after the first write.
const identity = await memory.identity();
console.log(`connected to ai-memory ${identity.version} as ${identity.level}`);

const page = await memory.pages.write({
  path: "notes/retries.md",
  body: "# Retry policy\nKeep the same event ID when retrying delivery.",
  tags: ["delivery"],
});
console.log(`wrote ${page.path} (version ${page.pageId})`);

const result = await memory.query({ query: "retry policy" });
for (const hit of result.hits) console.log(`hit: ${hit.path} ${hit.title}`);

const stored = await memory.pages.read({ path: "notes/retries.md" });
console.log(`read back: ${stored.body.split("\n")[1] ?? ""}`);

const status = await memory.status();
console.log(`${status.counts.pagesLatest} page(s) in ${scope.workspace}/${scope.project}`);

const begun = await memory.handoffs.begin({
  summary: "The retry policy was saved. Add the delivery test next.",
  nextSteps: ["Add a retry regression test."],
});
const claimed = await memory.handoffs.accept({ handoffId: begun.handoffId });
if (claimed.status === "claimed") {
  console.log(`handoff: ${claimed.handoff.summary}`);
}
