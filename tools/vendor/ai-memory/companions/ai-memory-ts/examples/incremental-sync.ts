/**
 * Mirror a project's pages incrementally through /api/v1 (the server needs
 * --enable-api). Lists pages changed after a cutoff, following the cursor,
 * and revalidates each page with its ETag so an unchanged page costs a 304.
 *
 *   node build/examples/incremental-sync.js
 */
import { AiMemoryClient } from "ai-memory-ts";

import { scope, serverUrl, token } from "./env.js";

const memory = new AiMemoryClient({ serverUrl, token, scope });
const cache = new Map<string, { etag: string | undefined; body: string }>();

async function sync(since: string): Promise<string> {
  let newest = since;
  for await (const summary of memory.api.recent({ updatedSince: since, limit: 50 })) {
    const cached = cache.get(summary.path);
    const result = await memory.api.page(
      summary.path,
      cached?.etag === undefined ? {} : { ifNoneMatch: cached.etag },
    );
    if (result.notModified) {
      console.log(`unchanged: ${summary.path}`);
    } else {
      cache.set(summary.path, { etag: result.etag, body: result.page.body });
      console.log(`fetched: ${summary.path} (version ${result.page.id})`);
    }
    if (summary.updatedAt !== undefined && summary.updatedAt > newest) newest = summary.updatedAt;
  }
  return newest;
}

await memory.pages.write({ path: "notes/sync-a.md", body: "# Sync A\nfirst" });
const cutoff = await sync("1970-01-01T00:00:00Z");
await memory.pages.write({ path: "notes/sync-b.md", body: "# Sync B\nsecond" });
await sync(cutoff);
console.log(`cached ${cache.size} pages`);
