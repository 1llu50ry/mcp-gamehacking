// ============================================================
// Chunking for large tool outputs. Decompiler results of large
// functions can exceed 100-500 KB; most clients render that as a
// single message and the model's output budget swallows most of it.
//
// Strategy:
//   1. If the result is under softCap, return it unchanged.
//   2. If over softCap:
//      - store the full text under .cache/chunks/<id>.txt
//      - return a header + the first chunk (softCap bytes)
//      - include a cursor "chunk_id:1" so the caller can call
//        chunk_fetch to pull subsequent slices without ambiguity.
//   3. If over hardCap and the client did not opt in with full=true,
//      refuse and point at summarize-first.
//
// chunk_fetch(id, next) — stream slice n of a stored chunk record.
// chunk_list()          — show in-flight chunk records.
//
// All stored under .cache/chunks/, same lifecycle as decompile-cache.
// ============================================================

import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DEFAULT_SOFT_CAP = 16 * 1024;    // 16 KiB per chunk — fits in most model contexts
const DEFAULT_HARD_CAP = 2 * 1024 * 1024; // 2 MiB total

export interface ChunkRecord {
  id: string;
  label: string;
  total_bytes: number;
  chunk_bytes: number;
  parts: number;
  created_at: number;
}

export class ChunkStore {
  private readonly dir: string;
  constructor(root: string) { this.dir = join(root, ".cache", "chunks"); }

  private pathFor(id: string, part: number): string { return join(this.dir, id, `${part}.txt`); }
  private metaPath(id: string): string              { return join(this.dir, id, "meta.json"); }

  async store(text: string, label: string, chunkBytes = DEFAULT_SOFT_CAP): Promise<ChunkRecord> {
    const id = createHash("sha256").update(label + "\0" + text).digest("hex").slice(0, 16);
    await mkdir(join(this.dir, id), { recursive: true });
    const parts = Math.ceil(Buffer.byteLength(text) / chunkBytes);
    const buf = Buffer.from(text, "utf8");
    for (let i = 0; i < parts; i++) {
      await writeFile(this.pathFor(id, i), buf.slice(i * chunkBytes, (i + 1) * chunkBytes));
    }
    const rec: ChunkRecord = {
      id, label,
      total_bytes: buf.length,
      chunk_bytes: chunkBytes,
      parts,
      created_at: Date.now(),
    };
    await writeFile(this.metaPath(id), JSON.stringify(rec));
    return rec;
  }

  async get(id: string, part: number): Promise<{ meta: ChunkRecord; text: string } | null> {
    try {
      const meta: ChunkRecord = JSON.parse(await readFile(this.metaPath(id), "utf8"));
      const text = await readFile(this.pathFor(id, part), "utf8");
      return { meta, text };
    } catch { return null; }
  }

  async list(): Promise<ChunkRecord[]> {
    const out: ChunkRecord[] = [];
    try {
      for (const d of await readdir(this.dir).catch(() => [])) {
        try {
          const m: ChunkRecord = JSON.parse(await readFile(join(this.dir, d, "meta.json"), "utf8"));
          out.push(m);
        } catch {}
      }
    } catch {}
    return out.sort((a, b) => b.created_at - a.created_at);
  }
}

let _store: ChunkStore | null = null;
export function getChunkStore(root: string): ChunkStore {
  if (!_store) _store = new ChunkStore(root);
  return _store;
}

export async function maybeChunk(
  root: string,
  text: string,
  label: string,
  opts: { softCap?: number; hardCap?: number; full?: boolean } = {},
): Promise<{ text: string; chunked: boolean; cursor?: string }> {
  const softCap = opts.softCap ?? DEFAULT_SOFT_CAP;
  const hardCap = opts.hardCap ?? DEFAULT_HARD_CAP;
  const size = Buffer.byteLength(text);
  if (size <= softCap) return { text, chunked: false };
  if (size > hardCap && !opts.full) {
    return {
      text: `# too large (${(size / 1024 / 1024).toFixed(1)} MiB > ${(hardCap / 1024 / 1024).toFixed(0)} MiB)\n\nRe-run with full=true to force chunking, or ask for a summary first.`,
      chunked: false,
    };
  }
  const rec = await getChunkStore(root).store(text, label, softCap);
  const first = (await getChunkStore(root).get(rec.id, 0))?.text ?? "";
  const header = `# ${label} — ${(size / 1024).toFixed(1)} KiB in ${rec.parts} chunks\n\nUse \`chunk_fetch(id="${rec.id}", part=N)\` for parts 1..${rec.parts - 1}.\n\n`;
  return { text: header + first, chunked: true, cursor: `${rec.id}:0` };
}

export function registerChunkTools(server: McpServer, root: string): void {
  const store = getChunkStore(root);
  server.tool(
    "chunk_fetch",
    "Fetch a part of a chunked tool result produced by maybeChunk.",
    { id: z.string(), part: z.number().min(0) },
    async ({ id, part }: { id: string; part: number }) => {
      const r = await store.get(id, part);
      if (!r) return { content: [{ type: "text" as const, text: `chunk_fetch: no such chunk id=${id} part=${part}` }], isError: true as const };
      return { content: [{ type: "text" as const, text: `# ${r.meta.label} — part ${part + 1}/${r.meta.parts}\n\n${r.text}` }] };
    },
  );
  server.tool(
    "chunk_list",
    "List every chunked record currently stored on disk.",
    {},
    async () => {
      const recs = await store.list();
      return { content: [{ type: "text" as const, text: `# chunk_list (${recs.length})\n\n` + recs.map(r => `- \`${r.id}\` — ${r.label} — ${r.parts} parts (${(r.total_bytes / 1024).toFixed(1)} KiB)`).join("\n") }] };
    },
  );
}

// ---- trace-ids ----

export function newTraceId(): string {
  return randomBytes(8).toString("hex");
}
