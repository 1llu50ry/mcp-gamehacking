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

switch (cmd) {
  case "stats":  await cmdStats(); break;
  case "lookup": await cmdLookup(rest[0] ?? ""); break;
  case "search": await cmdSearch(rest.join(" ")); break;
  case "health": await cmdHealth(rest[0]); break;
  case "tools":  await cmdTools(); break;
  case "serve":  await cmdServe(); break;
  case "-h":
  case "--help":
  case "help":
  case undefined: usage(); break;
  default: console.error(`unknown command: ${cmd}`); usage(); process.exit(1);
}
