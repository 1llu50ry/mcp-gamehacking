import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWasm, parseElf } from "../dist/native-formats.js";

test("parseWasm reads version + sections of a hand-built module", () => {
  // Minimal valid WASM: magic + version + a type section with 0 types
  const buf = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, // magic
    0x01, 0x00, 0x00, 0x00, // version
    0x01,                   // section id = Type
    0x01,                   // size = 1
    0x00,                   // 0 types
  ]);
  const info = parseWasm(buf);
  assert.equal(info.version, 1);
  assert.equal(info.sections.length, 1);
  assert.equal(info.sections[0].id, "Type");
});

test("parseWasm rejects non-WASM", () => {
  assert.throws(() => parseWasm(Buffer.from("not wasm")));
});

test("parseElf rejects non-ELF buffers", () => {
  assert.throws(() => parseElf(Buffer.from("not elf")));
});
