#!/usr/bin/env node
// Thin CLI for mcp-gamehacking. Subcommands:
//   serve       - start the MCP server (stdio by default; MCP_TRANSPORT=http for HTTP)
//   stats       - print skill library stats and exit
//   lookup NAME - print SKILL.md for one skill by name
//   search Q    - keyword search across skills
//   health URL  - probe a running HTTP server's /healthz
//   tools       - list every registered MCP tool (via dist/index.js tools/list)
//
// All subcommands use the same project tree as the server; set `cd` or use `--root`.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MCP_PROJECT_ROOT ?? resolve(__dirname, "..");

const [, , cmd, ...rest] = process.argv;

async function cmdStats() {
  const names = await readdir(join(ROOT, "skills"));
  let ags = 0;
  for (const n of names) if (n.startsWith("ags-")) ags++;
  console.log(`skills: ${names.length}  (hand-written ${names.length - ags}, archived ags-* ${ags})`);
  for (const d of ["agents", "subagents", "plugins", "prompts"]) {
    try {
      let c = 0;
      const stack = [join(ROOT, d)];
      while (stack.length) {
        const dir = stack.pop();
        for (const e of await readdir(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) stack.push(p);
          else if (e.name.endsWith(".md")) c++;
        }
      }
      console.log(`${d}: ${c}`);
    } catch { /* ignore */ }
  }
}

async function cmdLookup(name) {
  const p = join(ROOT, "skills", name, "SKILL.md");
  try { process.stdout.write(await readFile(p, "utf8")); }
  catch { console.error(`skill not found: ${name}  (looked at ${p})`); process.exit(1); }
}

async function cmdSearch(q) {
  const names = await readdir(join(ROOT, "skills"));
  const lc = q.toLowerCase();
  const hits = [];
  for (const n of names) {
    if (n.toLowerCase().includes(lc)) { hits.push({ n, where: "name" }); continue; }
    try {
      const content = await readFile(join(ROOT, "skills", n, "SKILL.md"), "utf8");
      if (content.toLowerCase().includes(lc)) hits.push({ n, where: "body" });
    } catch { /* ignore */ }
    if (hits.length >= 50) break;
  }
  for (const h of hits) console.log(`${h.where.padEnd(5)} ${h.n}`);
  if (!hits.length) { console.log("no matches"); process.exit(1); }
}

async function cmdHealth(url) {
  const u = url ?? `http://127.0.0.1:${process.env.MCP_HTTP_PORT ?? 7777}/healthz`;
  try {
    const r = await fetch(u);
    console.log(`${u}  ${r.status}`);
    console.log(await r.text());
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(`health probe failed: ${e.message}`);
    process.exit(2);
  }
}

async function cmdTools() {
  const entry = join(ROOT, "dist", "index.js");
  try { await stat(entry); } catch { console.error(`not built. run \`npm run build\` first (looked at ${entry})`); process.exit(1); }
  const child = spawn("node", [entry], { stdio: ["pipe", "pipe", "inherit"] });
  child.stdin.write(`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n`);
  const chunks = [];
  child.stdout.on("data", (b) => chunks.push(b));
  await new Promise((res) => setTimeout(res, 1500));
  child.kill();
  const text = Buffer.concat(chunks).toString();
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const o = JSON.parse(line);
      if (o.result?.tools) {
        for (const t of o.result.tools) console.log(`${t.name.padEnd(32)} ${(t.description ?? "").slice(0, 80)}`);
        return;
      }
    } catch { /* keep looking */ }
  }
  console.error("no tools/list response");
  process.exit(1);
}

async function cmdServe() {
  const entry = join(ROOT, "dist", "index.js");
  const child = spawn("node", [entry, ...rest], { stdio: "inherit", env: process.env });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function usage() {
  console.log(`mcp-gamehacking <command>

Commands:
  serve                 start the MCP server (stdio; MCP_TRANSPORT=http for HTTP)
  stats                 print skill library stats
  lookup <name>         print SKILL.md for one skill
  search <q>            keyword search across skills
  health [url]          probe /healthz on a running HTTP server
  tools                 list every registered MCP tool

Env:
  MCP_PROJECT_ROOT  override project root (default: parent of bin/)
  MCP_TRANSPORT     stdio | http
  MCP_HTTP_PORT     default 7777
  MCP_HTTP_HOST     default 127.0.0.1
  MCP_FS_ALLOW      comma-separated allowed roots for file-reading tools
  MCP_AGENT_MESH_DIR  path for mesh JSON persistence
`);
}

async function cmdUnpack(skillName) {
  // Decompress `skills/<name>/source.txt.gz` into `source.txt` next to
  // it. After release 5.0 the server ships only the `.gz` to keep the
  // package light; tools that walk the file as a stream decompress on
  // the fly, but anyone who wants to grep with external utilities can
  // unpack with this.
  const { createReadStream, createWriteStream } = await import("node:fs");
  const { createGunzip } = await import("node:zlib");
  const { pipeline } = await import("node:stream/promises");
  const names = skillName && skillName !== "--all" ? [skillName] : (await readdir(join(ROOT, "skills")));
  let n = 0;
  for (const name of names) {
    const src = join(ROOT, "skills", name, "source.txt.gz");
    const dst = join(ROOT, "skills", name, "source.txt");
    try {
      await stat(src);
      try { await stat(dst); continue; } catch {}
      await pipeline(createReadStream(src), createGunzip(), createWriteStream(dst));
      n++;
      if (n % 100 === 0) process.stderr.write(`[unpack] ${n}\r`);
    } catch { /* skip missing */ }
  }
  console.log(`unpacked ${n} source archives`);
}

async function cmdPack(skillName) {
  const { createReadStream, createWriteStream } = await import("node:fs");
  const { createGzip } = await import("node:zlib");
  const { pipeline } = await import("node:stream/promises");
  const { unlink } = await import("node:fs/promises");
  const names = skillName && skillName !== "--all" ? [skillName] : (await readdir(join(ROOT, "skills")));
  let n = 0;
  for (const name of names) {
    const src = join(ROOT, "skills", name, "source.txt");
    const dst = join(ROOT, "skills", name, "source.txt.gz");
    try {
      await stat(src);
      await pipeline(createReadStream(src), createGzip({ level: 6 }), createWriteStream(dst));
      await unlink(src);
      n++;
      if (n % 100 === 0) process.stderr.write(`[pack] ${n}\r`);
    } catch { /* skip missing */ }
  }
  console.log(`packed ${n} source archives`);
}

async function cmdBuildDb() {
  // Delegate to scripts/build-db.mjs so the slim/full flag is honoured.
  // The script imports from dist/, so make sure the build is current.
  const { spawnSync } = await import("node:child_process");
  const script = join(ROOT, "scripts", "build-db.mjs");
  const r = spawnSync(process.execPath, [script, ...rest], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

async function cmdDbStats() {
  const { DatabaseSync } = await import("node:sqlite");
  const path = process.env.MCP_SKILLS_DB ?? join(ROOT, "db", "skills.db");
  try { await stat(path); } catch { console.error("no DB at", path); process.exit(1); }
  const db = new DatabaseSync(path, { readOnly: true });
  const q = (sql) => db.prepare(sql).get();
  console.log("db:", path);
  for (const table of ["skills", "plugins", "agents", "subagents", "prompts"]) {
    const c = (q(`SELECT COUNT(*) c FROM ${table}`) ?? { c: 0 }).c;
    console.log(`  ${table}: ${c}`);
  }
  const withSrc = (q("SELECT COUNT(*) c FROM skills WHERE source_gz IS NOT NULL") ?? { c: 0 }).c;
  console.log(`  skills with source: ${withSrc}`);
  const meta = db.prepare("SELECT key, value FROM meta").all();
  for (const m of meta) console.log(`  ${m.key}: ${m.value}`);
  db.close();
}

switch (cmd) {
  case "stats":    await cmdStats(); break;
  case "lookup":   await cmdLookup(rest[0] ?? ""); break;
  case "search":   await cmdSearch(rest.join(" ")); break;
  case "health":   await cmdHealth(rest[0]); break;
  case "tools":    await cmdTools(); break;
  case "serve":    await cmdServe(); break;
  case "unpack":   await cmdUnpack(rest[0]); break;
  case "pack":     await cmdPack(rest[0]); break;
  case "build-db": await cmdBuildDb(); break;
  case "db-stats": await cmdDbStats(); break;
  case "-h":
  case "--help":
  case "help":
  case undefined: usage(); break;
  default: console.error(`unknown command: ${cmd}`); usage(); process.exit(1);
}
