/**
 * Change a page only if nobody else changed it since we read it. On a
 * concurrent change the server writes nothing and the SDK raises
 * PreconditionFailedError; re-read and try again, a bounded number of times.
 *
 *   node build/examples/conditional-update.js
 */
import { AiMemoryClient, PreconditionFailedError } from "ai-memory-ts";

import { scope, serverUrl, token } from "./env.js";

const memory = new AiMemoryClient({ serverUrl, token, scope });
const path = "notes/changelog-count.md";

// Create the page once; createOnly refuses to overwrite an existing page.
try {
  await memory.pages.write({ path, body: "# Counter\n0", createOnly: true, tags: ["example"] });
} catch (error) {
  if (!(error instanceof PreconditionFailedError)) throw error;
}

for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    // update() reads the page, applies the change, and writes with the
    // version it read as expectedPageId. Tags and other metadata are kept.
    const written = await memory.pages.update(path, (current) => {
      const count = Number(current.body.split("\n")[1] ?? "0") + 1;
      return { body: `# Counter\n${count}` };
    });
    console.log(`updated ${written.path} on attempt ${attempt} (version ${written.pageId})`);
    break;
  } catch (error) {
    if (!(error instanceof PreconditionFailedError) || attempt === 5) throw error;
    console.log(`changed underneath us (now ${error.currentPageId}); retrying`);
  }
}

const page = await memory.pages.read({ path });
console.log(`counter is ${page.body.split("\n")[1]}, tags ${JSON.stringify(page.frontmatter["tags"])}`);
