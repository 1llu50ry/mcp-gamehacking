import test from "node:test";
import assert from "node:assert/strict";
import { ChunkStore, maybeChunk, newTraceId } from "../dist/chunking.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function td() { return await mkdtemp(join(tmpdir(), "chunk-test-")); }

test("chunking: stores + fetches a multi-part record", async () => {
  const root = await td();
  try {
    const store = new ChunkStore(root);
    const text = "A".repeat(500) + "B".repeat(500) + "C".repeat(500);
    const rec = await store.store(text, "test-blob", 500);
    assert.equal(rec.parts, 3);
    assert.equal(rec.total_bytes, 1500);
    const part2 = await store.get(rec.id, 1);
    assert.ok(part2);
    assert.equal(part2.text.length, 500);
    assert.equal(part2.text[0], "B");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("chunking: maybeChunk under softCap returns text unchanged", async () => {
  const root = await td();
  try {
    const r = await maybeChunk(root, "hi", "small", { softCap: 1024 });
    assert.equal(r.chunked, false);
    assert.equal(r.text, "hi");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("chunking: maybeChunk over softCap stores and returns first part", async () => {
  const root = await td();
  try {
    const big = "x".repeat(50_000);
    const r = await maybeChunk(root, big, "big-decompile", { softCap: 10_000 });
    assert.equal(r.chunked, true);
    assert.ok(r.cursor);
    assert.match(r.text, /^#\s+big-decompile — 48\.8 KiB in 5 chunks/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("chunking: over hardCap without full=true refuses", async () => {
  const root = await td();
  try {
    const huge = "x".repeat(3 * 1024 * 1024);
    const r = await maybeChunk(root, huge, "huge", { softCap: 16 * 1024, hardCap: 1024 * 1024 });
    assert.equal(r.chunked, false);
    assert.match(r.text, /too large/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("chunking: newTraceId yields 16 hex chars", () => {
  const t = newTraceId();
  assert.match(t, /^[0-9a-f]{16}$/);
});
