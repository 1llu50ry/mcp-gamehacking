import test from "node:test";
import assert from "node:assert/strict";
import { DecompileCache } from "../dist/decompile-cache.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function newTempCache() {
  const dir = await mkdtemp(join(tmpdir(), "cache-test-"));
  return { cache: new DecompileCache(dir, 1024 * 1024), dir };
}

test("decompile-cache: miss → set → hit", async () => {
  const { cache, dir } = await newTempCache();
  try {
    const miss = await cache.get("ghidra", "0x401000");
    assert.equal(miss, null);

    const entry = await cache.set("ghidra", "0x401000", { code: "int main() {}" });
    assert.equal(entry.hits, 0);

    const hit = await cache.get("ghidra", "0x401000");
    assert.ok(hit);
    assert.equal(hit.payload.code, "int main() {}");
    assert.equal(hit.hits, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("decompile-cache: wrap() runs fn once, then returns cached", async () => {
  const { cache, dir } = await newTempCache();
  try {
    let calls = 0;
    const fn = async () => { calls++; return { fn: `decompiled-${calls}` }; };

    const r1 = await cache.wrap("ida", "sub_401", fn);
    const r2 = await cache.wrap("ida", "sub_401", fn);

    assert.equal(calls, 1);
    assert.equal(r1.hit, false);
    assert.equal(r2.hit, true);
    assert.equal(r2.entry.payload.fn, "decompiled-1");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("decompile-cache: different keys don't collide", async () => {
  const { cache, dir } = await newTempCache();
  try {
    await cache.set("ghidra", "k1", { x: 1 });
    await cache.set("ghidra", "k2", { x: 2 });
    const a = await cache.get("ghidra", "k1");
    const b = await cache.get("ghidra", "k2");
    assert.equal(a.payload.x, 1);
    assert.equal(b.payload.x, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("decompile-cache: different backends don't collide", async () => {
  const { cache, dir } = await newTempCache();
  try {
    await cache.set("ghidra", "0x100", { from: "ghidra" });
    await cache.set("ida",    "0x100", { from: "ida" });
    const g = await cache.get("ghidra", "0x100");
    const i = await cache.get("ida",    "0x100");
    assert.equal(g.payload.from, "ghidra");
    assert.equal(i.payload.from, "ida");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
