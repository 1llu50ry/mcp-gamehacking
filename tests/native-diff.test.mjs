import test from "node:test";
import assert from "node:assert/strict";
import { diffBinaries } from "../dist/native-diff.js";

const A = new Uint8Array([
  // func f1 @ 0, length 16  — simple xor loop
  0x48, 0x31, 0xC0, 0x48, 0xFF, 0xC0, 0x48, 0x83, 0xF8, 0x05, 0x75, 0xF8, 0xC3, 0x90, 0x90, 0x90,
  // func f2 @ 16, length 16 — identical in B
  0x55, 0x48, 0x89, 0xE5, 0xB8, 0x01, 0x00, 0x00, 0x00, 0x5D, 0xC3, 0x90, 0x90, 0x90, 0x90, 0x90,
]);
const B = new Uint8Array([
  // func f1 @ 0 — one byte changed (xor key swapped from 0 to 1)
  0x48, 0x31, 0xC9, 0x48, 0xFF, 0xC0, 0x48, 0x83, 0xF8, 0x05, 0x75, 0xF8, 0xC3, 0x90, 0x90, 0x90,
  // func f2 @ 16 — identical
  0x55, 0x48, 0x89, 0xE5, 0xB8, 0x01, 0x00, 0x00, 0x00, 0x5D, 0xC3, 0x90, 0x90, 0x90, 0x90, 0x90,
  // new func f3 @ 32
  0xB8, 0x2A, 0x00, 0x00, 0x00, 0xC3,
]);

const AF = [
  { name: "f1", offset: 0, length: 16 },
  { name: "f2", offset: 16, length: 16 },
];
const BF = [
  { name: "f1", offset: 0, length: 16 },
  { name: "f2", offset: 16, length: 16 },
  { name: "f3", offset: 32, length: 6 },
];

test("bindiff: identical function matches equal", () => {
  const d = diffBinaries(A, AF, B, BF);
  const f2 = d.find(m => m.a.name === "f2" || m.b.name === "f2");
  assert.ok(f2);
  assert.equal(f2.verdict, "equal");
});

test("bindiff: minor byte change becomes modified or shifted", () => {
  const d = diffBinaries(A, AF, B, BF);
  const f1 = d.find(m => m.a.name === "f1");
  assert.ok(f1);
  assert.ok(f1.verdict === "modified" || f1.verdict === "shifted", `got ${f1.verdict}`);
});

test("bindiff: new function on B side is reported as added", () => {
  const d = diffBinaries(A, AF, B, BF);
  const f3 = d.find(m => m.a.name === "f3" || m.b.name === "f3");
  assert.ok(f3);
  assert.equal(f3.verdict, "added");
});
