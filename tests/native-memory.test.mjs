// E2E over stdio for native memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function rpc(child, id, method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("rpc timeout")), 15000);
    const handler = (buf) => {
      for (const line of buf.toString().split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const o = JSON.parse(line);
          if (o.id === id) { clearTimeout(t); child.stdout.off("data", handler); resolve(o); return; }
        } catch { /* keep */ }
      }
    };
    child.stdout.on("data", handler);
  });
}

async function startServer(memDir) {
  const env = { ...process.env, MCP_MEMORY_DIR: memDir };
  const child = spawn("node", ["dist/index.js"], { env, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", () => {});
  const init = await rpc(child, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mem-test", version: "0" } });
  assert.equal(init.result.protocolVersion, "2024-11-05");
  return child;
}
async function call(child, id, name, args) {
  const r = await rpc(child, id, "tools/call", { name, arguments: args });
  return r.result;
}

test("put / get / search / list / delete round-trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mem-"));
  const child = await startServer(dir);
  try {
    const p1 = await call(child, 100, "memory_put", { key: "cs2:dwEntityList", value: "0x1A3D4B0", namespace: "global", tags: ["cs2", "offset"], author: "alice" });
    assert.match(p1.content[0].text, /created id=/);

    const g1 = await call(child, 101, "memory_get", { key: "cs2:dwEntityList", namespace: "global" });
    assert.match(g1.content[0].text, /0x1A3D4B0/);

    const upd = await call(child, 102, "memory_put", { key: "cs2:dwEntityList", value: "0x1A3D5C0", namespace: "global", tags: ["cs2", "offset", "updated"] });
    assert.match(upd.content[0].text, /updated/);

    const g2 = await call(child, 103, "memory_get", { key: "cs2:dwEntityList", namespace: "global" });
    assert.match(g2.content[0].text, /0x1A3D5C0/);
    assert.match(g2.content[0].text, /v2/);

    const s1 = await call(child, 104, "memory_search", { query: "cs2 entity", limit: 5 });
    assert.match(s1.content[0].text, /cs2:dwEntityList/);

    const l1 = await call(child, 105, "memory_list", { tag: "updated", limit: 10 });
    assert.match(l1.content[0].text, /cs2:dwEntityList/);

    const stats = await call(child, 106, "memory_stats", {});
    assert.match(stats.content[0].text, /total entries: 1/);

    const d1 = await call(child, 107, "memory_delete", { key: "cs2:dwEntityList", namespace: "global" });
    assert.match(d1.content[0].text, /deleted/);

    const g3 = await call(child, 108, "memory_get", { key: "cs2:dwEntityList", namespace: "global" });
    assert.ok(g3.isError);

    const disk = JSON.parse(await readFile(join(dir, "mem.json"), "utf8"));
    assert.equal(Object.keys(disk.entries).length, 0);
  } finally { child.kill(); await rm(dir, { recursive: true, force: true }); }
});

test("namespaces isolate same-key entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mem-"));
  const child = await startServer(dir);
  try {
    await call(child, 200, "memory_put", { key: "note", value: "A", namespace: "project:alpha" });
    await call(child, 201, "memory_put", { key: "note", value: "B", namespace: "project:beta" });
    const ga = await call(child, 202, "memory_get", { key: "note", namespace: "project:alpha" });
    const gb = await call(child, 203, "memory_get", { key: "note", namespace: "project:beta" });
    assert.match(ga.content[0].text, /"A"/);
    assert.match(gb.content[0].text, /"B"/);
  } finally { child.kill(); await rm(dir, { recursive: true, force: true }); }
});
