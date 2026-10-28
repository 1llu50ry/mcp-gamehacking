import test from "node:test";
import assert from "node:assert/strict";
import { findGadgetsX64, findGadgetsArm64 } from "../dist/native-rop.js";

test("rop: finds `pop rdi; ret` on x86-64", () => {
  //                    pop rdi (5f) ; ret (c3)
  const bin = new Uint8Array([0x90, 0x90, 0x5F, 0xC3, 0x90]);
  const gs = findGadgetsX64(bin, { maxDepth: 6 });
  const popRdi = gs.find(g => g.asm.includes("pop rdi"));
  assert.ok(popRdi, `expected a pop-rdi gadget, got: ${gs.map(g => g.asm).join(", ")}`);
});

test("rop: finds plain ret on x86-64", () => {
  const bin = new Uint8Array([0x00, 0xC3, 0x00]);
  const gs = findGadgetsX64(bin, { maxDepth: 4 });
  const r = gs.find(g => g.asm === "ret");
  assert.ok(r);
  assert.equal(r.addr, "0x1");
});

test("rop: finds aarch64 ret", () => {
  // Two filler NOP-ish instructions then ret (c0 03 5f d6)
  const bin = new Uint8Array([
    0x00, 0x00, 0x80, 0xD2,     // mov x0, #0
    0x00, 0x00, 0x80, 0xD2,     // mov x0, #0
    0xC0, 0x03, 0x5F, 0xD6,     // ret
  ]);
  const gs = findGadgetsArm64(bin);
  assert.ok(gs.length > 0, `expected gadgets, got none`);
  assert.ok(gs[0].asm.includes("ret"));
});
