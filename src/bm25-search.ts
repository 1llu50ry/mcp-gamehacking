// Zero-dep BM25 full-text search over the skill library.
// Builds an inverted index lazily, caches it in-memory (TTL 10 min).
// Written for the 4,000+ skills archive; typical cold index ~1 sec.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface IndexDoc {
  id: string;         // skill name
  len: number;        // token count
  tf: Map<string, number>;
  description: string;
  type: string;
}

interface InvertedIndex {
  docs: Map<string, IndexDoc>;
  df: Map<string, number>; // document frequency per term
  avgLen: number;
  N: number;
  builtAt: number;
}

const TOKEN_RE = /[a-z0-9]+/g;
const STOP = new Set(["the","a","an","and","or","of","to","in","on","for","with","is","it","this","that","as","by","from","be","are","was","were","at"]);

function tokenise(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(TOKEN_RE)) {
    const t = m[0];
    if (t.length < 2 || t.length > 30) continue;
    if (STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

let INDEX: InvertedIndex | null = null;
const TTL = 10 * 60 * 1000;

async function build(root: string): Promise<InvertedIndex> {
  const skillsDir = join(root, "skills");
  const docs = new Map<string, IndexDoc>();
  const df = new Map<string, number>();
  let totalLen = 0;
  let names: string[];
  try { names = await readdir(skillsDir); } catch { return { docs, df, avgLen: 0, N: 0, builtAt: Date.now() }; }
  await Promise.all(names.map(async (name) => {
    try {
      const content = await readFile(join(skillsDir, name, "SKILL.md"), "utf8");
      const fmMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
      const fm: Record<string, string> = {};
      let body = content;
      if (fmMatch) { body = fmMatch[2]; for (const line of fmMatch[1].split("\n")) { const kv = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line); if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, ""); } }
      const text = name + " " + (fm.description ?? "") + " " + (fm.topics ?? "") + " " + body;
      const tokens = tokenise(text);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      docs.set(name, { id: name, len: tokens.length, tf, description: fm.description ?? "", type: fm.type ?? "" });
      totalLen += tokens.length;
      for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    } catch { /* skip corrupt */ }
  }));
  return { docs, df, avgLen: docs.size ? totalLen / docs.size : 0, N: docs.size, builtAt: Date.now() };
}

// Disk cache: `.index-cache/bm25.json`. Loaded on first query if newer
// than any SKILL.md on disk; otherwise rebuilt and saved.
const CACHE_SUBDIR = ".index-cache";
const CACHE_FILE = "bm25.json";

async function loadDiskCache(root: string): Promise<InvertedIndex | null> {
  const { readFile, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const path = join(root, CACHE_SUBDIR, CACHE_FILE);
  try {
    const st = await stat(path);
    const text = await readFile(path, "utf8");
    const raw = JSON.parse(text) as { docs: [string, { id: string; len: number; tf: [string, number][]; description: string; type: string }][]; df: [string, number][]; avgLen: number; N: number; mtime: number };
    const docs = new Map<string, IndexDoc>();
    for (const [id, d] of raw.docs) docs.set(id, { id: d.id, len: d.len, tf: new Map(d.tf), description: d.description, type: d.type });
    return { docs, df: new Map(raw.df), avgLen: raw.avgLen, N: raw.N, builtAt: st.mtimeMs };
  } catch { return null; }
}

async function saveDiskCache(root: string, idx: InvertedIndex): Promise<void> {
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(root, CACHE_SUBDIR);
  await mkdir(dir, { recursive: true });
  const payload = {
    docs: [...idx.docs.entries()].map(([id, d]) => [id, { id: d.id, len: d.len, tf: [...d.tf.entries()], description: d.description, type: d.type }]),
    df: [...idx.df.entries()],
    avgLen: idx.avgLen,
    N: idx.N,
    mtime: idx.builtAt,
  };
  const tmp = join(dir, `${CACHE_FILE}.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(payload), "utf8");
  await rename(tmp, join(dir, CACHE_FILE));
}

async function newestSkillMtime(root: string): Promise<number> {
  // Cheap mtime watermark: `skills/` dir mtime changes when entries are
  // added / removed; file-level staleness falls through to the TTL. This
  // avoids walking 4,200 files on every cold start.
  const { stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try { return (await stat(join(root, "skills"))).mtimeMs; } catch { return 0; }
}

async function getIndex(root: string): Promise<InvertedIndex> {
  if (INDEX && Date.now() - INDEX.builtAt < TTL) return INDEX;
  // Try disk cache first — if newer than skills/ mtime, we can skip the
  // ~1 s cold build entirely.
  const disk = await loadDiskCache(root);
  const skillMtime = await newestSkillMtime(root);
  if (disk && disk.builtAt >= skillMtime) {
    INDEX = { ...disk, builtAt: Date.now() };
    return INDEX;
  }
  INDEX = await build(root);
  // Persist asynchronously; failure to save shouldn't block queries.
  saveDiskCache(root, INDEX).catch(() => { /* best effort */ });
  return INDEX;
}

function score(idx: InvertedIndex, qTokens: string[], doc: IndexDoc, k1 = 1.2, b = 0.75): number {
  let s = 0;
  for (const q of qTokens) {
    const nq = idx.df.get(q) ?? 0;
    if (!nq) continue;
    const idf = Math.log((idx.N - nq + 0.5) / (nq + 0.5) + 1);
    const tf = doc.tf.get(q) ?? 0;
    const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * (doc.len / (idx.avgLen || 1))));
    s += idf * norm;
  }
  return s;
}

export function registerBm25Search(server: McpServer, projectRoot: string): void {
  server.tool(
    "bm25_search",
    "Full-text BM25 search across all skills (hand-written + ags-* archives). Returns ranked results. More accurate than keyword matching for multi-term queries like 'battleye kernel shellcode detection'.",
    {
      query: z.string(),
      limit: z.number().min(1).max(100).default(10),
      typeFilter: z.string().optional(),
    },
    async ({ query, limit, typeFilter }: { query: string; limit: number; typeFilter?: string }) => {
      const idx = await getIndex(projectRoot);
      const qTokens = tokenise(query);
      if (!qTokens.length) return { content: [{ type: "text" as const, text: "no searchable tokens in query" }] };
      const scored: { id: string; score: number; description: string; type: string }[] = [];
      for (const doc of idx.docs.values()) {
        if (typeFilter && doc.type !== typeFilter) continue;
        const s = score(idx, qTokens, doc);
        if (s > 0) scored.push({ id: doc.id, score: s, description: doc.description, type: doc.type });
      }
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, limit);
      if (!top.length) return { content: [{ type: "text" as const, text: `no hits for /${query}/` }] };
      const lines = [`# bm25_search ${query}`, `index: ${idx.N} docs, avg ${idx.avgLen.toFixed(1)} tokens`, `hits: ${scored.length} (top ${top.length})`, ``];
      for (const r of top) lines.push(`- **${r.id}**  score=${r.score.toFixed(2)}  (${r.type})\n  ${r.description.slice(0, 160)}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "bm25_rebuild",
    "Force a rebuild of the BM25 inverted index. Automatic rebuild happens after a 10-minute TTL expiry.",
    {},
    async () => {
      INDEX = await build(projectRoot);
      return { content: [{ type: "text" as const, text: `rebuilt index. docs=${INDEX.N} avgLen=${INDEX.avgLen.toFixed(1)} unique terms=${INDEX.df.size}` }] };
    }
  );
}
