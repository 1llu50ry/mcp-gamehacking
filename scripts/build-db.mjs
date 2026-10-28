#!/usr/bin/env node
/**
 * build-db.mjs — pack the project's content tree into a single
 * SQLite database (db/skills.db by default).
 *
 * Usage:
 *   node scripts/build-db.mjs                # slim: no source blobs
 *   node scripts/build-db.mjs --with-source  # fat: embed every source.txt(.gz)
 *   node scripts/build-db.mjs --out db/full.db --with-source
 *
 * Reads from (relative to ROOT):
 *   skills/<name>/SKILL.md           — the canonical knowledge file
 *   skills/<name>/source.txt(.gz)    — optional source dump (fat only)
 *   plugins/<category>/<name>.md
 *   agents/*.md
 *   subagents/*.md
 *   prompts/<category>/*.md
 *
 * The slim DB tops out around 20 MiB and is what we ship via npm /
 * docker. The fat DB is what we attach to a GitHub Release when
 * users want the full source archives offline.
 */

import { readdir, readFile, stat, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const withSource = args.includes("--with-source");
const outFlag = args.indexOf("--out");
const outPath = outFlag >= 0 ? args[outFlag + 1] : (withSource ? join(ROOT, "db", "skills-full.db") : join(ROOT, "db", "skills.db"));
const quiet = args.includes("--quiet");

const log = (msg) => { if (!quiet) process.stderr.write(msg + "\n"); };

// Dynamic import so this script runs on bare node without a dist/ build.
const db = await (async () => {
  const sdb = await import("../dist/skills-db.js").catch(() => null);
  if (!sdb) throw new Error("dist/skills-db.js not built — run `npm run build` first");
  await mkdir(dirname(outPath), { recursive: true });
  // Remove existing to start fresh (write-ahead log can produce stale FTS otherwise).
  try { const { unlink } = await import("node:fs/promises"); await unlink(outPath); } catch {}
  try { const { unlink } = await import("node:fs/promises"); await unlink(outPath + "-wal"); } catch {}
  try { const { unlink } = await import("node:fs/promises"); await unlink(outPath + "-shm"); } catch {}
  const h = sdb.createEmptyDb(outPath);
  return { h, sdb };
})();

// -------- parse frontmatter (same subset as src/index.ts) --------
function parseFrontmatter(content) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)/.exec(content);
  if (!m) return { meta: {}, body: content };
  const yaml = m[1];
  const body = m[2];
  const meta = {};
  const topics = [];
  for (const line of yaml.split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, k, v] = kv;
    if (k === "topics" && v.trim().startsWith("[")) {
      meta.topics = v.replace(/[\[\]]/g, "").split(",").map(s => s.trim().replace(/["']/g, "")).filter(Boolean);
    } else {
      meta[k] = v.trim().replace(/^["']|["']$/g, "");
    }
  }
  if (topics.length && !meta.topics) meta.topics = topics;
  return { meta, body };
}

// -------- walk skills/ --------
log(`[build-db] root=${ROOT}  out=${outPath}  with-source=${withSource}`);
const skillsDir = join(ROOT, "skills");
let skillNames;
try { skillNames = await readdir(skillsDir); } catch { skillNames = []; }

let s = 0, s_src = 0;
db.h.exec("BEGIN");
for (const name of skillNames) {
  try {
    const sk = await stat(join(skillsDir, name)).catch(() => null);
    if (!sk?.isDirectory()) continue;
    const skPath = join(skillsDir, name, "SKILL.md");
    const skText = await readFile(skPath, "utf-8").catch(() => null);
    if (!skText) continue;
    const { meta, body } = parseFrontmatter(skText);

    let source_gz = null, source_sha = null;
    if (withSource) {
      // Prefer the already-gzipped sidecar, else gzip the uncompressed one.
      try {
        source_gz = await readFile(join(skillsDir, name, "source.txt.gz"));
        try { source_sha = createHash("sha256").update(gunzipSync(source_gz)).digest("hex"); }
        catch { source_sha = null; }
      } catch {
        try {
          const raw = await readFile(join(skillsDir, name, "source.txt"));
          source_gz = gzipSync(raw, { level: 6 });
          source_sha = createHash("sha256").update(raw).digest("hex");
        } catch {}
      }
      if (source_gz) s_src++;
    }

    db.sdb.insertSkill(db.h, {
      name,
      description: meta.description ?? null,
      type:        meta.type ?? null,
      topics:      meta.topics ?? [],
      body,
      source_gz,
      source_sha,
    });
    s++;
    if (s % 500 === 0) log(`[build-db]   skills: ${s} (with-source: ${s_src})`);
  } catch (e) {
    log(`[build-db]   skip ${name}: ${e.message}`);
  }
}
db.h.exec("COMMIT");
log(`[build-db] skills done: ${s} (with source: ${s_src})`);

// -------- walk plugins/<category>/<name>.md --------
async function walkMd(root, cb) {
  async function visit(dir, prefix) {
    let ents = [];
    try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await visit(full, prefix ? `${prefix}/${e.name}` : e.name);
      else if (e.name.endsWith(".md")) await cb(full, prefix, e.name.replace(/\.md$/, ""));
    }
  }
  await visit(root, "");
}

async function pack(table, dir, catFn) {
  let n = 0;
  db.h.exec("BEGIN");
  await walkMd(dir, async (full, catPath, name) => {
    try {
      const body = await readFile(full, "utf-8");
      const category = catFn(catPath, name);
      if (table === "plugins") db.sdb.insertPlugin(db.h, { category, name, path: full.replace(ROOT, "").replace(/\\/g, "/"), body });
      else if (table === "prompts") db.sdb.insertPrompt(db.h, category, name, body);
      else db.sdb.insertAgent(db.h, table, name, body);
      n++;
    } catch {}
  });
  db.h.exec("COMMIT");
  return n;
}

const p = await pack("plugins",   join(ROOT, "plugins"),   (c) => c || "misc");
const a = await pack("agents",    join(ROOT, "agents"),    () => "");
const sa = await pack("subagents",join(ROOT, "subagents"), () => "");
const pr = await pack("prompts",  join(ROOT, "prompts"),   (c) => c || "misc");

db.sdb.setMeta(db.h, "built_at", new Date().toISOString());
db.sdb.setMeta(db.h, "with_source", withSource ? "yes" : "no");
db.sdb.setMeta(db.h, "schema", "1");

log(`[build-db] plugins: ${p}  agents: ${a}  subagents: ${sa}  prompts: ${pr}`);

// Vacuum + close so the WAL merges back into the main file (keeps the
// on-disk size honest and ships one file instead of three).
db.h.exec("VACUUM");
db.h.close();

const final = await stat(outPath).catch(() => null);
log(`[build-db] final size: ${((final?.size ?? 0) / 1024 / 1024).toFixed(1)} MiB at ${outPath}`);
