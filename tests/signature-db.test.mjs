import test from "node:test";
import assert from "node:assert/strict";
import { matchSignatures, makeSignaturesFromRanges } from "../dist/signature-db.js";

test("signature-db: masked match finds target in a buffer", async () => {
  const target = new Uint8Array([
    0x00, 0x11, 0x22, 0x33,
    0x48, 0x89, 0xC1, 0x48, 0x89, 0xD2, 0x48, 0x89, 0xDB,  // ← looks like a memcpy prologue
    0x55, 0x66,
  ]);
  const sigs = [
    { name: "fake_memcpy", prolog: "48 89 ?? 48 89 ?? 48 89 ??", length: 9 },
    { name: "nope",        prolog: "FF FF FF FF",                length: 4 },
  ];
  const hits = await matchSignatures(target, sigs);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "fake_memcpy");
  assert.equal(hits[0].address, "0x4");
});

test("signature-db: longest prolog wins at the same address", async () => {
  const target = new Uint8Array([0x90, 0x90, 0x48, 0x89, 0xC1, 0x48, 0x89, 0xD2]);
  const sigs = [
    { name: "short", prolog: "48 89",       length: 2 },
    { name: "long",  prolog: "48 89 ?? 48 89 ??", length: 6 },
  ];
  const hits = await matchSignatures(target, sigs);
  // Only one hit at address 0x2 is kept (the longest prolog score)
  const at2 = hits.filter(h => h.address === "0x2");
  assert.equal(at2.length, 1);
  assert.equal(at2[0].name, "long");
});

test("signature-db: makeSignaturesFromRanges round-trip", async () => {
  const target = new Uint8Array(256).fill(0x90);
  for (let i = 32; i < 48; i++) target[i] = i; // distinctive function body

  const sigs = await makeSignaturesFromRanges(target, [{ name: "f", offset: 32, length: 16 }], 8, 8);
  assert.equal(sigs.length, 1);
  const hits = await matchSignatures(target, sigs);
  const names = hits.map(h => `${h.name}@${h.address}`);
  assert.ok(names.includes("f@0x20"), `expected hit at 0x20, got ${names.join(",")}`);
});
