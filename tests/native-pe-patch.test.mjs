import test from "node:test";
import assert from "node:assert/strict";
import { findCodeCaves, overlayRange, swapJcc } from "../dist/native-pe-patch.js";

// Build a tiny synthetic PE with one executable section big enough
// to contain code caves. Minimal field set — only what the parser
// reads out: DOS header, PE sig, optional header magic + nSections,
// one section header. 64-bit (PE32+ magic 0x20B).

function makePe(opts = {}) {
  const nopFill  = opts.nopFill  ?? 128;
  const trail    = opts.trail    ?? 32;
  const overlay  = opts.overlay  ?? 0;
  // Lay out: DOS(0x40) + PE(4) + COFF header(20) + OptHdr(240 for PE32+)
  //         + 1 Section header(40) + section body
  const peOff = 0x80;
  const optHdrSize = 240;
  const secOff = peOff + 24 + optHdrSize;
  const bodyOff = (secOff + 40 + 0x1FF) & ~0x1FF;  // raw aligned to 0x200
  const body = Buffer.alloc(nopFill + trail, 0x11);
  for (let i = 0; i < nopFill; i++) body[trail + i] = 0x90;
  const total = bodyOff + body.length + overlay;
  const b = Buffer.alloc(total, 0);
  b[0] = 0x4D; b[1] = 0x5A;                        // MZ
  b.writeUInt32LE(peOff, 0x3C);                     // e_lfanew
  b.writeUInt32LE(0x00004550, peOff);               // 'PE\0\0'
  b.writeUInt16LE(0x8664, peOff + 4);               // Machine = AMD64
  b.writeUInt16LE(1, peOff + 6);                    // NumberOfSections
  b.writeUInt16LE(optHdrSize, peOff + 20);          // SizeOfOptionalHeader
  b.writeUInt16LE(0x20B, peOff + 24);               // PE32+ magic
  // Section header: name ".text", VSize=body.len, VAddr=0x1000,
  //                SizeOfRawData=body.len, PointerToRawData=bodyOff,
  //                Characteristics=0x60000020 (code+exec+read)
  b.write(".text", secOff, "ascii");
  b.writeUInt32LE(body.length, secOff + 8);         // VirtualSize
  b.writeUInt32LE(0x1000, secOff + 12);             // VirtualAddress
  b.writeUInt32LE(body.length, secOff + 16);        // SizeOfRawData
  b.writeUInt32LE(bodyOff, secOff + 20);            // PointerToRawData
  b.writeUInt32LE(0x60000020, secOff + 36);         // Characteristics
  body.copy(b, bodyOff);
  if (overlay) b.fill(0xAB, total - overlay);
  return { buf: b, bodyOff, body, overlayStart: total - overlay };
}

test("pe-patch: finds 0x90 cave in exec section", () => {
  const { buf, bodyOff } = makePe({ nopFill: 128, trail: 32 });
  const caves = findCodeCaves(new Uint8Array(buf), 32);
  const nopCave = caves.find(c => c.fill === "nop");
  assert.ok(nopCave, `expected a nop cave, got: ${JSON.stringify(caves)}`);
  assert.equal(nopCave.section, ".text");
  // nop run starts at bodyOff + 32 (after the trail of 0x11s)
  assert.equal(parseInt(nopCave.file_offset), bodyOff + 32);
  assert.equal(nopCave.length, 128);
});

test("pe-patch: overlay_extract spots trailing bytes", () => {
  const { buf, overlayStart } = makePe({ overlay: 1024 });
  const r = overlayRange(new Uint8Array(buf));
  assert.ok(r);
  assert.equal(r.start, overlayStart);
  assert.equal(r.length, 1024);
});

test("pe-patch: jcc_swap flips JZ ↔ JNZ", () => {
  const buf = new Uint8Array([0x74, 0x05]); // JZ +5
  const r = swapJcc(buf, 0);
  assert.ok(r);
  assert.equal(buf[0], 0x75); // now JNZ +5

  // far form 0F 84 → 0F 85
  const far = new Uint8Array([0x0F, 0x84, 0x00, 0x00, 0x00, 0x00]);
  const r2 = swapJcc(far, 0);
  assert.ok(r2);
  assert.equal(far[1], 0x85);
});

test("pe-patch: jcc_swap refuses non-jcc opcode", () => {
  const buf = new Uint8Array([0x90]);
  const r = swapJcc(buf, 0);
  assert.equal(r, null);
});
