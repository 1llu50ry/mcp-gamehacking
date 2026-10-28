// ============================================================
// Content-addressable decompile cache.
//
// Decompiling a function takes 5-60 seconds in Ghidra/IDA. Agents
// often call the same tool twice (verification, retry after a model
// pivot, sibling model in the mesh asking the same question). This
// cache turns those repeats into free lookups.
//
// Key: SHA-256 of (backend_id, binary_sha256, function_address) OR
//      SHA-256 of (backend_id, exact_byte_slice) for bytes-based lookups.
//
// Storage: `.cache/decompile/<prefix>/<hash>.json` under the project
// root, zero-dep. Each file holds the full tool response plus
// metadata (backend, hit count, created_at).
//
// Eviction: LRU trim on get() if dir size > CAP (default 500 MB).
//
// Public API: cache.wrap(backend, key, fn) → runs fn only on miss.
// ============================================================

import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DEFAULT_CAP_BYTES = 500 * 1024 * 1024;

export interface CacheEntry<T> {
  backend: string;
  key: string;             // human-readable key (e.g. "ghidra:0x401000:sha256:abc...")
  created_at: number;
  last_hit:   number;
  hits:       number;
  bytes:      number;      // payload size estimate
  payload:    T;
}

export class DecompileCache {
  private readonly dir: string;
  private readonly capBytes: number;

  constructor(root: string, capBytes = DEFAULT_CAP_BYTES) {
    this.dir = join(root, ".cache", "decompile");
    this.capBytes = capBytes;
  }

  private pathFor(hash: string): string {
    return join(this.dir, hash.slice(0, 2), hash + ".json");
  }

  private hashKey(backend: string, key: string): string {
    return createHash("sha256").update(backend + "\0" + key).digest("hex");
  }

  async get<T>(backend: string, key: string): Promise<CacheEntry<T> | null> {
    const hash = this.hashKey(backend, key);
    try {
      const raw = await readFile(this.pathFor(hash), "utf8");
      const entry: CacheEntry<T> = JSON.parse(raw);
      entry.hits++;
      entry.last_hit = Date.now();
      // write-back fire-and-forget
      writeFile(this.pathFor(hash), JSON.stringify(entry)).catch(() => {});
      return entry;
    } catch { return null; }
  }

  async set<T>(backend: string, key: string, payload: T): Promise<CacheEntry<T>> {
    const hash = this.hashKey(backend, key);
    const serialized = JSON.stringify(payload);
    const entry: CacheEntry<T> = {
      backend, key,
      created_at: Date.now(), last_hit: Date.now(), hits: 0,
      bytes: serialized.length,
      payload,
    };
    await mkdir(join(this.dir, hash.slice(0, 2)), { recursive: true });
    await writeFile(this.pathFor(hash), JSON.stringify(entry));
    // async trim
    this.trimIfOversize().catch(() => {});
    return entry;
  }

  async wrap<T>(backend: string, key: string, fn: () => Promise<T>): Promise<{ hit: boolean; entry: CacheEntry<T> }> {
    const cached = await this.get<T>(backend, key);
    if (cached) return { hit: true, entry: cached };
    const payload = await fn();
    const entry = await this.set(backend, key, payload);
    return { hit: false, entry };
  }

  async stats() {
    let files = 0, bytes = 0;
    try {
      for (const prefix of await readdir(this.dir).catch(() => [])) {
        const sub = join(this.dir, prefix);
        for (const f of await readdir(sub).catch(() => [])) {
          const s = await stat(join(sub, f)).catch(() => null);
          if (s?.isFile()) { files++; bytes += s.size; }
        }
      }
    } catch {}
    return { files, bytes, dir: this.dir, cap_bytes: this.capBytes };
  }

  async clear(): Promise<number> {
    let n = 0;
    for (const prefix of await readdir(this.dir).catch(() => [])) {
      const sub = join(this.dir, prefix);
      for (const f of await readdir(sub).catch(() => [])) {
        await unlink(join(sub, f)).catch(() => {}); n++;
      }
    }
    return n;
  }

  private async trimIfOversize(): Promise<void> {
    const s = await this.stats();
    if (s.bytes <= this.capBytes) return;
    const victims: { path: string; last_hit: number; size: number }[] = [];
    for (const prefix of await readdir(this.dir).catch(() => [])) {
      const sub = join(this.dir, prefix);
      for (const f of await readdir(sub).catch(() => [])) {
        const p = join(sub, f);
        try {
          const st = await stat(p);
          const text = await readFile(p, "utf8");
          const e: CacheEntry<unknown> = JSON.parse(text);
          victims.push({ path: p, last_hit: e.last_hit ?? e.created_at, size: st.size });
        } catch {}
      }
    }
    victims.sort((a, b) => a.last_hit - b.last_hit); // oldest first
    let bytes = s.bytes;
    for (const v of victims) {
      if (bytes <= this.capBytes * 0.9) break;
      await unlink(v.path).catch(() => {});
      bytes -= v.size;
    }
  }
}

// Lazily-constructed singleton tied to ROOT; wired from index.ts.
let _singleton: DecompileCache | null = null;
export function getCache(root: string): DecompileCache {
  if (!_singleton) _singleton = new DecompileCache(root);
  return _singleton;
}

export function registerCacheTools(server: McpServer, root: string): void {
  const cache = getCache(root);
  server.tool(
    "cache_stats",
    "Show the decompile cache size and location.",
    {},
    async () => {
      const s = await cache.stats();
      const mb = (s.bytes / 1024 / 1024).toFixed(2);
      const cap = (s.cap_bytes / 1024 / 1024).toFixed(0);
      return { content: [{ type: "text" as const, text: `# cache_stats\n\n- files: **${s.files}**\n- size:  **${mb} MB** / cap **${cap} MB**\n- dir:   \`${s.dir}\`` }] };
    },
  );
  server.tool(
    "cache_clear",
    "Clear every decompile-cache entry (counts freed files).",
    { confirm: z.boolean().default(false) },
    async ({ confirm }: { confirm: boolean }) => {
      if (!confirm) return { content: [{ type: "text" as const, text: "pass confirm=true to actually clear the cache" }] };
      const n = await cache.clear();
      return { content: [{ type: "text" as const, text: `# cache_clear\n\nremoved ${n} files` }] };
    },
  );
}
