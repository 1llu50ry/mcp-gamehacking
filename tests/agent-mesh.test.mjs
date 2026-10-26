// E2E: spawn the MCP server over stdio and drive the mesh tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function rpc(child, id, method, params) {
  const req = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  child.stdin.write(req);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("rpc timeout")), 15000);
    const handler = (buf) => {
      const text = buf.toString();
      for (const line of text.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const o = JSON.parse(line);
          if (o.id === id) {
            clearTimeout(t);
            child.stdout.off("data", handler);
            resolve(o);
            return;
          }
        } catch { /* keep reading */ }
      }
    };
    child.stdout.on("data", handler);
  });
}

async function startServer(meshDir) {
  const env = { ...process.env, MCP_AGENT_MESH_DIR: meshDir };
  const child = spawn("node", ["dist/index.js"], { env, stdio: ["pipe", "pipe", "pipe"] });
  // Drain stderr but ignore
  child.stderr.on("data", () => {});
  // Initialize
  const init = await rpc(child, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mesh-test", version: "0" } });
  assert.equal(init.result.protocolVersion, "2024-11-05");
  return child;
}

async function callTool(child, id, name, args) {
  const resp = await rpc(child, id, "tools/call", { name, arguments: args });
  return resp.result;
}

test("agent registers, sends message, reads back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mesh-"));
  const child = await startServer(dir);
  try {
    // Register two agents
    const r1 = await callTool(child, 100, "mesh_agent_register", { name: "alice", kind: "claude", capabilities: ["re"] });
    const r2 = await callTool(child, 101, "mesh_agent_register", { name: "bob", kind: "codex", capabilities: ["bypass"] });
    const idA = /agent_id=([a-f0-9-]+)/.exec(r1.content[0].text)[1];
    const idB = /agent_id=([a-f0-9-]+)/.exec(r2.content[0].text)[1];

    // Alice DMs Bob
    const sent = await callTool(child, 102, "mesh_send", { from: idA, to: idB, text: "hey bob, look at this driver" });
    assert.ok(sent.content[0].text.startsWith("sent id="));

    // Bob reads
    const read = await callTool(child, 103, "mesh_read", { agent_id: idB, channels: [] });
    assert.match(read.content[0].text, /alice -> DM/);
    assert.match(read.content[0].text, /hey bob/);

    // Persistence: file on disk is valid JSON
    const diskText = await readFile(join(dir, "mesh.json"), "utf8");
    const disk = JSON.parse(diskText);
    assert.equal(Object.keys(disk.agents).length, 2);
    assert.equal(disk.messages.length, 1);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("task handoff + vote tally", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mesh-"));
  const child = await startServer(dir);
  try {
    const a = await callTool(child, 200, "mesh_agent_register", { name: "A", kind: "claude" });
    const b = await callTool(child, 201, "mesh_agent_register", { name: "B", kind: "codex" });
    const c = await callTool(child, 202, "mesh_agent_register", { name: "C", kind: "cursor" });
    const idA = /agent_id=([a-f0-9-]+)/.exec(a.content[0].text)[1];
    const idB = /agent_id=([a-f0-9-]+)/.exec(b.content[0].text)[1];
    const idC = /agent_id=([a-f0-9-]+)/.exec(c.content[0].text)[1];

    const task = await callTool(child, 203, "mesh_task_create", { from: idA, to: idB, title: "find bypass", spec: "find a BE bypass path" });
    const taskId = /task_id=([a-f0-9-]+)/.exec(task.content[0].text)[1];

    await callTool(child, 204, "mesh_task_update", { actor: idB, task_id: taskId, status: "completed", result: "see KB entry" });
    const vote1 = await callTool(child, 205, "mesh_task_vote", { voter: idA, task_id: taskId, verdict: "approve", confidence: 0.8 });
    const vote2 = await callTool(child, 206, "mesh_task_vote", { voter: idC, task_id: taskId, verdict: "needs_work", confidence: 0.4 });
    assert.match(vote2.content[0].text, /approve=0\.80 reject=0\.00 needs_work=0\.40/);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("kb set/get and lock/release", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mesh-"));
  const child = await startServer(dir);
  try {
    const a = await callTool(child, 300, "mesh_agent_register", { name: "A", kind: "claude" });
    const idA = /agent_id=([a-f0-9-]+)/.exec(a.content[0].text)[1];
    await callTool(child, 301, "mesh_kb_set", { author: idA, key: "cs2:dwEntityList", value: "0x1A3D4B0" });
    const g = await callTool(child, 302, "mesh_kb_get", { key: "cs2:dwEntityList" });
    assert.match(g.content[0].text, /0x1A3D4B0/);

    const lock = await callTool(child, 303, "mesh_lock_acquire", { resource: "driver.sys", holder: idA, ttlSec: 60 });
    const tok = /token=([a-f0-9-]+)/.exec(lock.content[0].text)[1];
    const dupe = await callTool(child, 304, "mesh_lock_acquire", { resource: "driver.sys", holder: "someone-else", ttlSec: 60 });
    assert.ok(dupe.isError);
    const rel = await callTool(child, 305, "mesh_lock_release", { resource: "driver.sys", token: tok });
    assert.match(rel.content[0].text, /released/);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
