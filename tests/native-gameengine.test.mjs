import test from "node:test";
import assert from "node:assert/strict";
import { parseGodotPck, parseUnrealFNames } from "../dist/native-gameengine.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function td() { return await mkdtemp(join(tmpdir(), "ge-test-")); }

function buildGodotPck(files) {
  // Minimum viable .pck: "GDPC" + pack_v + godot_v + 16*reserved + count + N entries
  const header = Buffer.alloc(4 + 4 + 12 + 16 * 4);
  header.writeUInt32LE(0x43504447, 0);          // GDPC
  header.writeUInt32LE(2, 4);                    // pack v2
  header.writeUInt32LE(4, 8);                    // godot 4
  header.writeUInt32LE(2, 12);                   // .2
  header.writeUInt32LE(1, 16);                   // .1
  // reserved stays zero
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(files.length, 0);
  const entries = files.map(f => {
    const nameBuf = Buffer.from(f.path, "utf8");
    const padLen = Math.ceil(nameBuf.length / 4) * 4;
    const padded = Buffer.concat([nameBuf, Buffer.alloc(padLen - nameBuf.length)]);
    const b = Buffer.alloc(4 + padded.length + 8 + 8 + 16);
    b.writeUInt32LE(padded.length, 0);
    padded.copy(b, 4);
    b.writeBigUInt64LE(BigInt(f.offset), 4 + padded.length);
    b.writeBigUInt64LE(BigInt(f.size),   4 + padded.length + 8);
    // md5 stays zero
    return b;
  });
  return Buffer.concat([header, countBuf, ...entries]);
}

test("game-engine: parses a minimal Godot .pck", async () => {
  const root = await td();
  try {
    const path = join(root, "test.pck");
    const pck = buildGodotPck([
      { path: "res://main.tscn", offset: 1024, size: 128 },
      { path: "res://assets/logo.png", offset: 2048, size: 4096 },
    ]);
    await writeFile(path, pck);
    const r = await parseGodotPck(path);
    assert.equal(r.file_count, 2);
    assert.equal(r.files[0].path, "res://main.tscn");
    assert.equal(r.files[1].path, "res://assets/logo.png");
    assert.equal(r.files[1].offset, 2048);
    assert.equal(r.files[1].size, 4096);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("game-engine: unreal_fnames extracts ASCII names from a dump", async () => {
  const root = await td();
  try {
    // Build a tiny blob with two FName-like entries. The parser scans for
    // uint16 length followed by printable ASCII. Each name is preceded by
    // a 2-byte length prefix at position i-2.
    const name1 = "PlayerCharacter"; // 15 chars
    const name2 = "BP_WeaponBase";    // 13 chars
    const buf = Buffer.alloc(100);
    buf.writeUInt16LE(name1.length, 6);  // length at idx 6
    buf.write(name1, 8, "ascii");         // name starts at idx 8 (= 6 + 2)
    const name2Start = 8 + name1.length + 4; // skip past name1 + padding
    buf.writeUInt16LE(name2.length, name2Start - 2);
    buf.write(name2, name2Start, "ascii");
    const path = join(root, "dump.bin");
    await writeFile(path, buf);
    const r = await parseUnrealFNames(path, 4);
    assert.ok(r.count >= 2, `expected ≥2 names, got ${r.count}`);
    assert.ok(r.samples.includes(name1));
    assert.ok(r.samples.includes(name2));
  } finally { await rm(root, { recursive: true, force: true }); }
});
