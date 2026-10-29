import test from "node:test";
import assert from "node:assert/strict";
import { scanAntiRe } from "../dist/native-antire.js";

test("antire: catches IsDebuggerPresent import", () => {
  // Synthetic PE-ish layout: a chunk of noise + NUL-bounded symbol name + more noise.
  const buf = Buffer.concat([
    Buffer.alloc(32, 0x90),
    Buffer.from("\x00IsDebuggerPresent\x00", "utf8"),
    Buffer.alloc(32, 0x90),
  ]);
  const hits = scanAntiRe(new Uint8Array(buf));
  const imp = hits.find(h => h.category === "import" && h.hit === "IsDebuggerPresent");
  assert.ok(imp, `missed IsDebuggerPresent: ${JSON.stringify(hits)}`);
});

test("antire: catches VBoxGuest string in utf-8", () => {
  const buf = Buffer.concat([Buffer.alloc(16, 0), Buffer.from("Driver\\VBoxGuest", "utf8"), Buffer.alloc(16, 0)]);
  const hits = scanAntiRe(new Uint8Array(buf));
  assert.ok(hits.find(h => h.hit === "VBoxGuest" && h.evidence === "utf-8"));
});

test("antire: catches VMware in utf-16le", () => {
  const buf = Buffer.concat([Buffer.alloc(16, 0), Buffer.from("VMware", "utf16le"), Buffer.alloc(16, 0)]);
  const hits = scanAntiRe(new Uint8Array(buf));
  assert.ok(hits.find(h => h.hit === "VMware" && h.evidence === "utf-16le"));
});

test("antire: catches rdtsc opcode", () => {
  const buf = Buffer.concat([Buffer.alloc(32, 0x90), Buffer.from([0x0F, 0x31]), Buffer.alloc(32, 0x90)]);
  const hits = scanAntiRe(new Uint8Array(buf));
  assert.ok(hits.find(h => h.category === "opcode" && h.hit.includes("rdtsc")));
});

test("antire: catches int3 cluster", () => {
  const buf = Buffer.concat([Buffer.alloc(16, 0x90), Buffer.alloc(12, 0xCC), Buffer.alloc(16, 0x90)]);
  const hits = scanAntiRe(new Uint8Array(buf));
  assert.ok(hits.find(h => h.hit.startsWith("int3 cluster")));
});

test("antire: clean file yields no hits", () => {
  const buf = Buffer.concat([Buffer.alloc(64, 0x90), Buffer.from("Hello, world!"), Buffer.alloc(64, 0x90)]);
  const hits = scanAntiRe(new Uint8Array(buf));
  assert.equal(hits.length, 0);
});
