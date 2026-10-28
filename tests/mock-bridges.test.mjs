import test from "node:test";
import assert from "node:assert/strict";
import { startMockBridge } from "./mock-bridge-server.mjs";

async function rpc(url, tool, args = {}) {
  const r = await fetch(`${url}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });
  return r.json();
}

test("mock bridge: healthz + ready", async () => {
  const bridge = await startMockBridge({ host: "ghidra" });
  try {
    const h = await (await fetch(`${bridge.url}/healthz`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.host, "ghidra");
    const r = await (await fetch(`${bridge.url}/ready`)).json();
    assert.equal(r.ready, true);
  } finally { await bridge.stop(); }
});

test("mock bridge: ghidra routes", async () => {
  const bridge = await startMockBridge({ host: "ghidra" });
  try {
    const funcs = await rpc(bridge.url, "list_functions");
    assert.equal(funcs.ok, true);
    assert.ok(funcs.result.functions.length > 0);

    const dec = await rpc(bridge.url, "decompile", { addr: "0x401000" });
    assert.ok(dec.result.code.includes("// mock decompile"));
  } finally { await bridge.stop(); }
});

test("mock bridge: ida pseudocode", async () => {
  const bridge = await startMockBridge({ host: "ida" });
  try {
    const r = await rpc(bridge.url, "decompile", { ea: 0x401000 });
    assert.match(r.result.pseudocode, /sub_401000/);
  } finally { await bridge.stop(); }
});

test("mock bridge: cheat-engine aob scan", async () => {
  const bridge = await startMockBridge({ host: "cheat-engine" });
  try {
    const r = await rpc(bridge.url, "aob_scan", { pattern: "48 8B ?? ??" });
    assert.ok(r.result.hits.length > 0);
  } finally { await bridge.stop(); }
});

test("mock bridge: reclass header export", async () => {
  const bridge = await startMockBridge({ host: "reclass" });
  try {
    const r = await rpc(bridge.url, "export_header");
    assert.match(r.result.cpp, /struct Player/);
  } finally { await bridge.stop(); }
});

test("mock bridge: unknown tool returns 404", async () => {
  const bridge = await startMockBridge({ host: "ghidra" });
  try {
    const r = await fetch(`${bridge.url}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "does_not_exist" }),
    });
    assert.equal(r.status, 404);
  } finally { await bridge.stop(); }
});

test("mock bridge: bad json returns 400", async () => {
  const bridge = await startMockBridge({ host: "ghidra" });
  try {
    const r = await fetch(`${bridge.url}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(r.status, 400);
  } finally { await bridge.stop(); }
});
