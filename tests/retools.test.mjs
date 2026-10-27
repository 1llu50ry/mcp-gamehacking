import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKENDS } from "../dist/retools.js";

const ids = Object.keys(BACKENDS);

test("catalog has at least 60 backends", () => {
  assert.ok(ids.length >= 60, `expected >= 60, got ${ids.length}`);
});

test("every backend id matches its outer map key", () => {
  for (const id of ids) assert.equal(BACKENDS[id].id, id, `${id}.id mismatch`);
});

test("every backend has launch.cmd + install[] + tags", () => {
  for (const id of ids) {
    const b = BACKENDS[id];
    assert.ok(b.launch?.cmd, `${id} missing launch.cmd`);
    assert.ok(Array.isArray(b.install) && b.install.length > 0, `${id} missing install[]`);
    assert.ok(Array.isArray(b.tags) && b.tags.length > 0, `${id} missing tags[]`);
  }
});

test("every backend has at least one supported OS", () => {
  for (const id of ids) assert.ok(BACKENDS[id].os?.length > 0, `${id} missing os[]`);
});

test("kind is static | dynamic | both", () => {
  const ok = new Set(["static", "dynamic", "both"]);
  for (const id of ids) assert.ok(ok.has(BACKENDS[id].kind), `${id} bad kind ${BACKENDS[id].kind}`);
});

test("http backends declare a numeric port", () => {
  for (const id of ids) {
    const h = BACKENDS[id].launch?.http;
    if (!h) continue;
    assert.equal(typeof h.port, "number", `${id} http.port not a number`);
    assert.ok(h.port > 0 && h.port < 65536, `${id} http.port ${h.port} out of range`);
  }
});

test("vendored backends point at an existing tools/vendor/<name> path", async () => {
  const { access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  for (const id of ids) {
    const b = BACKENDS[id];
    const cwd = b.launch?.cwd;
    if (!cwd || !cwd.startsWith("tools/vendor/")) continue;
    const abs = join(root, cwd);
    try { await access(abs); }
    catch { assert.fail(`${id}: cwd ${cwd} does not exist`); }
  }
});

test("no backend id collides with another id", () => {
  const seen = new Set();
  for (const id of ids) {
    assert.ok(!seen.has(id), `duplicate ${id}`);
    seen.add(id);
  }
});
