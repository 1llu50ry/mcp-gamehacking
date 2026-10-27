import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMinidump, parsePdb70Header, demangleItanium, demangleMsvc } from "../dist/native-advanced.js";

test("parseMinidump rejects non-MDMP buffers", () => {
  assert.throws(() => parseMinidump(Buffer.from("not a minidump at all")));
});

test("parseMinidump reads a hand-built header", () => {
  // Minimal MDMP: signature + version + 0 streams
  const buf = Buffer.alloc(0x40);
  buf.writeUInt32LE(0x504d444d, 0);  // 'MDMP'
  buf.writeUInt32LE(0x0000a0a3, 4);  // version
  buf.writeUInt32LE(0, 8);           // 0 streams
  buf.writeUInt32LE(0x20, 12);       // streamRva
  const info = parseMinidump(buf);
  assert.equal(info.signature, "MDMP");
  assert.equal(info.streamCount, 0);
  assert.equal(info.modules.length, 0);
  assert.equal(info.threads.length, 0);
});

test("parsePdb70Header rejects non-RSDS", () => {
  assert.throws(() => parsePdb70Header(Buffer.from([0x00, 0x11, 0x22, 0x33])));
});

test("parsePdb70Header extracts GUID + age + pdb path", () => {
  const buf = Buffer.alloc(60);
  buf.write("RSDS", 0, "ascii");                // signature
  buf.writeUInt32LE(0xA7F13C4B, 4);              // guid d1
  buf.writeUInt16LE(0x7F9E, 8);
  buf.writeUInt16LE(0x4C85, 10);
  Buffer.from("9B6F1A33E7FE2B01", "hex").copy(buf, 12);
  buf.writeUInt32LE(1, 20);                       // age
  Buffer.from("C:\\build\\Protected.pdb\0", "ascii").copy(buf, 24);
  const r = parsePdb70Header(buf);
  assert.equal(r.signature, "RSDS");
  assert.equal(r.age, 1);
  assert.ok(r.guid.startsWith("A7F13C4B-"));
  assert.equal(r.pdbPath, "C:\\build\\Protected.pdb");
});

test("demangleItanium handles a nested name", () => {
  // _ZN3foo3barE  →  foo::bar
  const out = demangleItanium("_ZN3foo3barE");
  assert.equal(out, "foo::bar");
});

test("demangleMsvc extracts the scoped name from a plain mangled symbol", () => {
  const out = demangleMsvc("?Func@Namespace@@QEAAXH@Z");
  assert.equal(out, "Namespace::Func");
});

test("demanglers pass through unknown mangling untouched", () => {
  assert.equal(demangleMsvc("plain_name"), "plain_name");
  assert.equal(demangleItanium("plain_name"), "plain_name");
});
