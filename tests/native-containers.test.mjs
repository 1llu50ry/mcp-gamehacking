import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseZip, findApkSigningBlock, sniffCat } from "../dist/native-containers.js";

// Build a minimal valid ZIP in-memory. 1 entry: "hello.txt" containing "hi".
function makeMinimalZip() {
  const name = "hello.txt";
  const data = Buffer.from("hi", "ascii");
  const nameBuf = Buffer.from(name, "ascii");
  // Local file header (stored, no compression)
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);          // version
  lfh.writeUInt16LE(0, 6);           // flags
  lfh.writeUInt16LE(0, 8);           // method = stored
  lfh.writeUInt16LE(0, 10);          // time
  lfh.writeUInt16LE(0, 12);          // date
  lfh.writeUInt32LE(0, 16);          // crc (ignored by our parser)
  lfh.writeUInt32LE(data.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);
  const local = Buffer.concat([lfh, nameBuf, data]);
  // Central directory header
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(0, 10);
  cdh.writeUInt16LE(0, 12);
  cdh.writeUInt16LE(0, 14);
  cdh.writeUInt32LE(0, 16);          // crc
  cdh.writeUInt32LE(data.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);
  cdh.writeUInt32LE(0, 42);
  const cd = Buffer.concat([cdh, nameBuf]);
  // EOCD
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([local, cd, eocd]);
}

test("parseZip reads a hand-rolled minimal ZIP", () => {
  const buf = makeMinimalZip();
  const z = parseZip(buf);
  assert.equal(z.entries.length, 1);
  assert.equal(z.entries[0].name, "hello.txt");
  assert.equal(z.entries[0].uncompressedSize, 2);
});

test("parseZip rejects non-ZIP input", () => {
  assert.throws(() => parseZip(Buffer.from("not a zip at all, no EOCD anywhere")));
});

test("findApkSigningBlock returns null on a plain ZIP", () => {
  const z = makeMinimalZip();
  assert.equal(findApkSigningBlock(z), null);
});

test("sniffCat correctly reports non-PKCS7 input", () => {
  const r = sniffCat(Buffer.from([0xff, 0xff, 0xff]));
  assert.equal(r.isPkcs7, false);
});

test("integration: writing and reading a ZIP via fs round-trips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zip-"));
  try {
    const p = join(dir, "mini.zip");
    await writeFile(p, makeMinimalZip());
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(p);
    const z = parseZip(buf);
    assert.equal(z.entries[0].name, "hello.txt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
