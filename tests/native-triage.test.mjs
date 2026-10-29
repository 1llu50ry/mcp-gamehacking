import test from "node:test";
import assert from "node:assert/strict";
import { scanShellcode, xorBruteDecode, scanDllHijack, detectUpx } from "../dist/native-triage.js";

test("shellcode_scan: finds PEB fetch prologue", () => {
  const buf = Buffer.concat([
    Buffer.alloc(32, 0x90),
    Buffer.from([0x64, 0xA1, 0x30, 0x00, 0x00, 0x00]),
    Buffer.alloc(32, 0x90),
  ]);
  const hits = scanShellcode(new Uint8Array(buf));
  assert.ok(hits.find(h => h.label.includes("PEB fetch")));
});

test("shellcode_scan: flags high-entropy region", () => {
  const noise = Buffer.alloc(512);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
  const buf = Buffer.concat([Buffer.alloc(64, 0), noise, Buffer.alloc(64, 0)]);
  const hits = scanShellcode(new Uint8Array(buf), { minEntropy: 7.0, windowSize: 256 });
  assert.ok(hits.find(h => h.category === "entropy"));
});

test("xor_brute_decode: recovers the right key", () => {
  const needle = "This program cannot be run";
  const KEY = 0x42;
  const buf = Buffer.alloc(256);
  const plain = Buffer.from(" ".repeat(32) + needle + " ".repeat(32), "utf8");
  plain.copy(buf, 0);
  for (let i = 0; i < buf.length; i++) buf[i] ^= KEY;
  const r = xorBruteDecode(new Uint8Array(buf), needle);
  assert.ok(r);
  assert.equal(r.key, KEY);
  assert.ok(r.score >= 100);
});

test("dllhijack: flags user-writable path imports", () => {
  const buf = Buffer.concat([
    Buffer.from([0x4D, 0x5A]),           // MZ
    Buffer.alloc(0x40 - 2, 0),           // DOS header pad
    Buffer.from([0x40, 0, 0, 0]),        // e_lfanew = 0x40
    Buffer.from([0x50, 0x45, 0, 0]),     // PE\0\0
    Buffer.alloc(0x18, 0),               // COFF header
    Buffer.from("\x00C:\\Users\\alice\\AppData\\evil.dll\x00", "utf8"),
    Buffer.alloc(64),
    Buffer.from("\x00kernel32.dll\x00", "utf8"),
  ]);
  const hits = scanDllHijack(new Uint8Array(buf));
  const abs = hits.find(h => h.dll.includes("AppData"));
  assert.ok(abs, `expected AppData hit, got ${JSON.stringify(hits)}`);
  assert.match(abs.reason, /user-writable/);
  const k32 = hits.find(h => h.dll === "kernel32.dll");
  assert.ok(k32);
  assert.match(k32.reason, /search-order/);
});

test("upx_detect: catches UPX! sentinel", () => {
  const buf = Buffer.concat([Buffer.alloc(32, 0), Buffer.from("UPX!"), Buffer.alloc(64, 0), Buffer.from("UPX0"), Buffer.alloc(16, 0)]);
  const r = detectUpx(new Uint8Array(buf));
  assert.equal(r.packed, true);
  assert.ok(r.evidence.includes("UPX! sentinel"));
  assert.ok(r.evidence.includes("UPX0"));
});

test("upx_detect: clean file not packed", () => {
  const buf = Buffer.from("hello world — nothing to see", "utf8");
  const r = detectUpx(new Uint8Array(buf));
  assert.equal(r.packed, false);
  assert.deepEqual(r.evidence, []);
});
