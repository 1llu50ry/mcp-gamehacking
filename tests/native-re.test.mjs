// Node's built-in test runner. Run via `node --test tests/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsePattern,
  scanPattern,
  shannon,
  extractStrings,
  identifyHashes,
  makeSignature,
  parsePe,
} from "../dist/native-re.js";

test("parsePattern accepts spaced hex with wildcards", () => {
  const sig = parsePattern("48 8B ?? ?? ?? ?? ?? E8");
  assert.equal(sig.length, 8);
  assert.deepEqual(sig[0], { any: false, value: 0x48 });
  assert.deepEqual(sig[1], { any: false, value: 0x8b });
  assert.deepEqual(sig[2], { any: true, value: 0 });
  assert.deepEqual(sig[7], { any: false, value: 0xe8 });
});

test("parsePattern accepts contiguous hex pairs", () => {
  const sig = parsePattern("488B??????????E8");
  assert.equal(sig.length, 8);
  assert.equal(sig[0].value, 0x48);
  assert.equal(sig[6].any, true);
});

test("scanPattern finds exact + wildcard hits", () => {
  const buf = Buffer.from([0x48, 0x8b, 0x05, 0x01, 0x02, 0x03, 0x04, 0xe8, 0x90, 0x90]);
  const sig = parsePattern("48 8B ?? ?? ?? ?? ?? E8");
  assert.deepEqual(scanPattern(buf, sig, 10), [0]);
});

test("scanPattern returns [] on no match", () => {
  const buf = Buffer.from([0x90, 0x90, 0x90]);
  const sig = parsePattern("48 8B");
  assert.deepEqual(scanPattern(buf, sig, 10), []);
});

test("shannon entropy of uniform data approaches 8.0", () => {
  const buf = Buffer.alloc(2048);
  for (let i = 0; i < buf.length; i++) buf[i] = i % 256;
  const H = shannon(buf, 0, buf.length);
  assert.ok(H > 7.9 && H <= 8.0, `expected H near 8.0, got ${H}`);
});

test("shannon entropy of all-zero data is 0", () => {
  const buf = Buffer.alloc(1024);
  assert.equal(shannon(buf, 0, buf.length), 0);
});

test("extractStrings finds ASCII strings above minLength", () => {
  const buf = Buffer.from("\x00\x00Hello world!\x00bye\x00ThisStringIsLongEnough\x00", "binary");
  const s = extractStrings(buf, 5, "ascii");
  const texts = s.map((x) => x.text);
  assert.ok(texts.includes("Hello world!"));
  assert.ok(texts.includes("ThisStringIsLongEnough"));
  assert.ok(!texts.includes("bye"));
});

test("extractStrings finds UTF-16LE strings", () => {
  const buf = Buffer.concat([
    Buffer.from("H\x00e\x00l\x00l\x00o\x00 \x00W\x00i\x00d\x00e\x00", "binary"),
    Buffer.from([0, 0]),
  ]);
  const s = extractStrings(buf, 5, "utf16le");
  assert.ok(s.some((x) => x.text.startsWith("Hello Wide")));
});

test("identifyHashes finds MD5/SHA-1/SHA-256 initial state", () => {
  const buf = Buffer.alloc(32);
  buf.writeUInt32LE(0x67452301, 0);   // MD5 A / SHA-1 A
  buf.writeUInt32LE(0x6a09e667, 8);   // SHA-256 H0
  buf.writeUInt32LE(0x811c9dc5, 16);  // FNV-1a offset basis
  buf.writeUInt32LE(0x61707865, 24);  // ChaCha20 sigma
  const hits = identifyHashes(buf);
  const names = new Set(hits.map((h) => h.name));
  assert.ok(names.has("MD5"), "MD5 constant should match");
  assert.ok(names.has("SHA-256"), "SHA-256 constant should match");
  assert.ok(names.has("FNV-1a-32"), "FNV constant should match");
  assert.ok(names.has("ChaCha20"), "ChaCha20 sigma should match");
});

test("makeSignature returns pattern of requested length and valid chars", () => {
  const buf = Buffer.from([0x48, 0x8b, 0x05, 0x11, 0x22, 0x33, 0x44, 0xe8]);
  const sig = makeSignature(buf, 0, 8, false);
  assert.equal(sig.pattern.split(" ").length, 8);
  assert.ok(/^([0-9A-F]{2} )+[0-9A-F]{2}$/.test(sig.pattern));
});

test("parsePe recognises a minimal PE and returns sections", async () => {
  // Build a minimal PE: MZ + e_lfanew + PE signature + COFF + opt + 1 section
  const buf = Buffer.alloc(0x400);
  buf.write("MZ", 0);
  buf.writeUInt32LE(0x80, 0x3c); // e_lfanew
  const peOff = 0x80;
  buf.writeUInt32LE(0x00004550, peOff); // "PE\0\0"
  // COFF starts after the "PE\0\0" signature (peOff + 4)
  const coffOff = peOff + 4;
  buf.writeUInt16LE(0x8664, coffOff + 0);        // machine amd64
  buf.writeUInt16LE(1, coffOff + 2);             // NumberOfSections
  buf.writeUInt32LE(0x60000000, coffOff + 4);    // timestamp
  buf.writeUInt16LE(240, coffOff + 16);          // SizeOfOptionalHeader
  buf.writeUInt16LE(0x0022, coffOff + 18);       // Characteristics
  // Opt header (PE32+) immediately after COFF (20 bytes)
  const optOff = coffOff + 20;
  buf.writeUInt16LE(0x20b, optOff);             // magic PE32+
  buf.writeUInt32LE(0x1000, optOff + 16);       // AddressOfEntryPoint
  buf.writeBigUInt64LE(0x140000000n, optOff + 24); // ImageBase
  buf.writeUInt32LE(0x2000, optOff + 56);       // SizeOfImage
  buf.writeUInt16LE(3, optOff + 68);            // Subsystem = windows_cui
  buf.writeUInt16LE(0x8160, optOff + 70);       // DllCharacteristics
  // Section header right after optional header
  const secOff = optOff + 240;
  buf.write(".text\0\0\0", secOff);
  buf.writeUInt32LE(0x100, secOff + 8);         // VirtualSize
  buf.writeUInt32LE(0x1000, secOff + 12);       // VirtualAddress
  buf.writeUInt32LE(0x200, secOff + 16);        // SizeOfRawData
  buf.writeUInt32LE(0x200, secOff + 20);        // PointerToRawData
  buf.writeUInt32LE(0x60000020, secOff + 36);   // Characteristics (code+exec+read)

  const info = parsePe(buf);
  assert.equal(info.machine, "amd64");
  assert.equal(info.bits, 64);
  assert.equal(info.subsystem, "windows_cui");
  assert.equal(info.sections.length, 1);
  assert.equal(info.sections[0].name, ".text");
  assert.equal(info.sections[0].va, 0x1000);
});

test("parsePe rejects non-PE buffers", () => {
  assert.throws(() => parsePe(Buffer.from("not-a-pe")));
});

test("extractStrings handles empty buffer", () => {
  assert.deepEqual(extractStrings(Buffer.alloc(0), 5, "both"), []);
});

test("integration: write + readback via node:fs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nativ-re-"));
  const p = join(dir, "zero.bin");
  try {
    await writeFile(p, Buffer.alloc(1024));
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(p);
    assert.equal(shannon(buf, 0, buf.length), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
