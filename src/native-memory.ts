// ============================================================
// Native agent memory — "mega-brain" absorption of local-memory-mcp,
// ai-memory, and the client side of TencentDB-Agent-Memory.
//
// Key / value store with:
//   - durable JSON persistence under <project>/.memory/mem.json
//   - namespacing (session / project / global)
//   - full-text search over values + tags
//   - tag filters
//   - time-based pruning
//   - export to JSONL for fine-tune
//   - stats
//
// No npm deps. One JSON file; atomic write-rename on every mutation
// (same pattern as agent-mesh). Memory is shared across every MCP
// client connected to this server, which is the whole point of the
// mega-brain model.
// ============================================================

import { mkdir, open, readFile, writeFile, rename, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface MemEntry {
  id: string;
  key: string;
  value: unknown;
  namespace: string;    // "global" | "session:<id>" | "project:<slug>" | user-chosen
  tags: string[];
  author: string | null;
  createdAt: number;
  updatedAt: number;
  version: number;
  textIndex: string;    // lowercased concatenation of key + stringified value + tags for cheap search
}

interface MemState {
  entries: Record<string, MemEntry>;    // keyed by id
  byKey: Record<string, string>;         // "<ns>::<key>" -> id (uniqueness per namespace)
  version: number;
}

const DIR_ENV = "MCP_MEMORY_DIR";

async function pathExists(p: string): Promise<boolean> {
  try { await access(p, fsConstants.F_OK); return true; } catch { return false; }
}

class MemStore {
  private file: string;
  private state: MemState;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(file: string, initial: MemState) {
    this.file = file;
    this.state = initial;
  }

  static async open(dir: string): Promise<MemStore> {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "mem.json");
    let initial: MemState = { entries: {}, byKey: {}, version: 1 };
    if (await pathExists(file)) {
      try {
        // Open as handle so stat and read go through the same fd (no TOCTOU).
        const fh = await open(file, "r");
        try {
          const text = await fh.readFile("utf8");
          initial = { ...initial, ...JSON.parse(text) };
        } finally { await fh.close(); }
      } catch { /* start fresh on corrupt */ }
    }
    return new MemStore(file, initial);
  }

  get(): MemState { return this.state; }

  async mutate<T>(fn: (s: MemState) => T): Promise<T> {
    const result = fn(this.state);
    this.state.version++;
    this.writeChain = this.writeChain.then(() => this.persist()).catch(() => this.persist());
    await this.writeChain;
    return result;
  }

  private async persist(): Promise<void> {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(this.state, null, 2), "utf8");
    await rename(tmp, this.file);
  }
}

function nsKey(ns: string, key: string): string { return `${ns}::${key}`; }
function buildIndex(key: string, value: unknown, tags: string[]): string {
  return [key, typeof value === "string" ? value : JSON.stringify(value), tags.join(" ")].join(" ").toLowerCase();
}

function scoreMatch(entry: MemEntry, qTokens: string[]): number {
  let s = 0;
  for (const t of qTokens) {
    if (entry.key.toLowerCase().includes(t)) s += 5;
    if (entry.textIndex.includes(t)) s += 1;
    if (entry.tags.some((tag) => tag.toLowerCase() === t)) s += 3;
  }
  return s;
}

export async function registerNativeMemory(server: McpServer, projectRoot: string): Promise<void> {
  const dir = process.env[DIR_ENV] ?? join(projectRoot, ".memory");
  const store = await MemStore.open(dir);
  const now = () => Date.now();
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const err = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const });

  server.tool(
    "memory_put",
    "Store (or update) a value in native agent memory. Keys are unique per namespace. Returns the entry id. Overwriting a key preserves its id and bumps version.",
    {
      key: z.string().min(1),
      value: z.unknown().describe("Any JSON-serializable payload. Agents commonly put facts, decisions, offsets, or short notes."),
      namespace: z.string().default("global").describe("'global' | 'session:<id>' | 'project:<slug>' | your own scope"),
      tags: z.array(z.string()).default([]),
      author: z.string().optional(),
    },
    async ({ key, value, namespace, tags, author }: { key: string; value: unknown; namespace: string; tags: string[]; author?: string }) => {
      const r = await store.mutate((s) => {
        const nk = nsKey(namespace, key);
        const existingId = s.byKey[nk];
        if (existingId) {
          const e = s.entries[existingId];
          e.value = value;
          e.tags = tags.length ? tags : e.tags;
          e.author = author ?? e.author;
          e.updatedAt = now();
          e.version++;
          e.textIndex = buildIndex(e.key, value, e.tags);
          return { id: existingId, version: e.version, created: false };
        }
        const id = randomUUID();
        const entry: MemEntry = {
          id, key, value, namespace, tags, author: author ?? null,
          createdAt: now(), updatedAt: now(), version: 1,
          textIndex: buildIndex(key, value, tags),
        };
        s.entries[id] = entry;
        s.byKey[nk] = id;
        return { id, version: 1, created: true };
      });
      return ok(`${r.created ? "created" : "updated"} id=${r.id} version=${r.version}`);
    }
  );

  server.tool(
    "memory_get",
    "Fetch a memory entry by key (within a namespace) or by id.",
    {
      key: z.string().optional(),
      id: z.string().optional(),
      namespace: z.string().default("global"),
    },
    async ({ key, id, namespace }: { key?: string; id?: string; namespace: string }) => {
      const s = store.get();
      let entry: MemEntry | undefined;
      if (id) entry = s.entries[id];
      else if (key) {
        const eid = s.byKey[nsKey(namespace, key)];
        entry = eid ? s.entries[eid] : undefined;
      } else return err("provide either `id` or `key`");
      if (!entry) return err("not found");
      return ok(`# ${entry.namespace} / ${entry.key}\n(id=${entry.id} v${entry.version}, by ${entry.author ?? "anon"}, updated ${new Date(entry.updatedAt).toISOString()})\ntags: ${entry.tags.join(", ") || "-"}\n\n${JSON.stringify(entry.value, null, 2)}`);
    }
  );

  server.tool(
    "memory_search",
    "Full-text search over memory. Scores by key match (×5) + tag match (×3) + body substring (×1). Filterable by namespace + tag.",
    {
      query: z.string(),
      namespace: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().min(1).max(500).default(20),
    },
    async ({ query, namespace, tag, limit }: { query: string; namespace?: string; tag?: string; limit: number }) => {
      const s = store.get();
      const qTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const results: { entry: MemEntry; score: number }[] = [];
      for (const entry of Object.values(s.entries)) {
        if (namespace && entry.namespace !== namespace) continue;
        if (tag && !entry.tags.includes(tag)) continue;
        const sc = scoreMatch(entry, qTokens);
        if (sc > 0) results.push({ entry, score: sc });
      }
      results.sort((a, b) => b.score - a.score);
      const top = results.slice(0, limit);
      if (!top.length) return ok(`no hits for /${query}/`);
      const lines = [`# memory_search ${query}`, `${results.length} hits (showing ${top.length})`, ``];
      for (const r of top) {
        const preview = typeof r.entry.value === "string" ? r.entry.value : JSON.stringify(r.entry.value);
        lines.push(`- **${r.entry.namespace}/${r.entry.key}** score=${r.score} v${r.entry.version} tags=${r.entry.tags.join(",") || "-"}\n  ${preview.slice(0, 200)}`);
      }
      return ok(lines.join("\n"));
    }
  );

  server.tool(
    "memory_list",
    "List memory entries with filters. Lightweight — returns metadata only, not value bodies. Use memory_get or memory_search for bodies.",
    {
      namespace: z.string().optional(),
      tag: z.string().optional(),
      author: z.string().optional(),
      sinceMs: z.number().optional().describe("Only entries updated after this epoch ms."),
      limit: z.number().min(1).max(1000).default(100),
    },
    async ({ namespace, tag, author, sinceMs, limit }: { namespace?: string; tag?: string; author?: string; sinceMs?: number; limit: number }) => {
      const s = store.get();
      const rows = Object.values(s.entries)
        .filter((e) => !namespace || e.namespace === namespace)
        .filter((e) => !tag || e.tags.includes(tag))
        .filter((e) => !author || e.author === author)
        .filter((e) => sinceMs == null || e.updatedAt > sinceMs)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
      if (!rows.length) return ok("no entries");
      const lines = [`# memory_list — ${rows.length} entries`, ``];
      for (const e of rows) lines.push(`- ${e.namespace}/${e.key}  v${e.version}  tags=${e.tags.join(",") || "-"}  updated=${new Date(e.updatedAt).toISOString()}  (id=${e.id})`);
      return ok(lines.join("\n"));
    }
  );

  server.tool(
    "memory_delete",
    "Delete an entry by key+namespace or by id.",
    {
      key: z.string().optional(),
      id: z.string().optional(),
      namespace: z.string().default("global"),
    },
    async ({ key, id, namespace }: { key?: string; id?: string; namespace: string }) => {
      const r = await store.mutate((s) => {
        const eid = id ?? (key ? s.byKey[nsKey(namespace, key)] : undefined);
        if (!eid) return "not_found";
        const entry = s.entries[eid];
        if (!entry) return "not_found";
        delete s.entries[eid];
        delete s.byKey[nsKey(entry.namespace, entry.key)];
        return "ok";
      });
      return r === "ok" ? ok("deleted") : err("not found");
    }
  );

  server.tool(
    "memory_prune",
    "Prune entries older than `olderThanDays`. Returns the number removed.",
    {
      olderThanDays: z.number().min(1).max(3650).default(90),
      namespace: z.string().optional(),
      dryRun: z.boolean().default(false),
    },
    async ({ olderThanDays, namespace, dryRun }: { olderThanDays: number; namespace?: string; dryRun: boolean }) => {
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
      if (dryRun) {
        const n = Object.values(store.get().entries).filter((e) => (!namespace || e.namespace === namespace) && e.updatedAt < cutoff).length;
        return ok(`[dry] would prune ${n} entries older than ${olderThanDays}d`);
      }
      const n = await store.mutate((s) => {
        let count = 0;
        for (const [id, e] of Object.entries(s.entries)) {
          if (namespace && e.namespace !== namespace) continue;
          if (e.updatedAt >= cutoff) continue;
          delete s.entries[id];
          delete s.byKey[nsKey(e.namespace, e.key)];
          count++;
        }
        return count;
      });
      return ok(`pruned ${n} entries older than ${olderThanDays}d`);
    }
  );

  server.tool(
    "memory_export",
    "Export all memory entries as JSONL (one entry per line). Useful for backup or fine-tune. Returns a file path on disk.",
    {
      out: z.string().optional().describe("Output path. Defaults to .export/memory-<ts>.jsonl"),
      namespace: z.string().optional(),
    },
    async ({ out, namespace }: { out?: string; namespace?: string }) => {
      const s = store.get();
      const path = out ?? join(projectRoot, ".export", `memory-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
      await mkdir(path.split(/[\\/]/).slice(0, -1).join("/"), { recursive: true });
      const lines: string[] = [];
      for (const e of Object.values(s.entries)) {
        if (namespace && e.namespace !== namespace) continue;
        lines.push(JSON.stringify(e));
      }
      await writeFile(path, lines.join("\n"), "utf8");
      return ok(`exported ${lines.length} entries to ${path}`);
    }
  );

  server.tool(
    "memory_stats",
    "Native memory statistics: total entries, by namespace, by tag (top 20), total bytes, oldest + newest timestamps.",
    {},
    async () => {
      const s = store.get();
      const entries = Object.values(s.entries);
      const byNs: Record<string, number> = {};
      const byTag: Record<string, number> = {};
      let bytes = 0;
      let oldest = Infinity;
      let newest = 0;
      for (const e of entries) {
        byNs[e.namespace] = (byNs[e.namespace] ?? 0) + 1;
        for (const t of e.tags) byTag[t] = (byTag[t] ?? 0) + 1;
        bytes += JSON.stringify(e).length;
        if (e.updatedAt < oldest) oldest = e.updatedAt;
        if (e.updatedAt > newest) newest = e.updatedAt;
      }
      const topTags = Object.entries(byTag).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, n]) => `  ${t}: ${n}`).join("\n") || "  (none)";
      const nsBreakdown = Object.entries(byNs).sort((a, b) => b[1] - a[1]).map(([n, c]) => `  ${n}: ${c}`).join("\n") || "  (empty)";
      return ok(`# memory_stats\n- total entries: ${entries.length}\n- stored bytes: ${bytes}\n- oldest: ${entries.length ? new Date(oldest).toISOString() : "-"}\n- newest: ${entries.length ? new Date(newest).toISOString() : "-"}\n- store version: ${s.version}\n- dir: ${dir}\n\n## by namespace\n${nsBreakdown}\n\n## top tags\n${topTags}`);
    }
  );

  // Silence unused-import warning (createHash reserved for future digest fields)
  void createHash;
}
