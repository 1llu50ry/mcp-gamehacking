import test from "node:test";
import assert from "node:assert/strict";
import { emulateArm64 } from "../dist/native-arm64.js";

// ARM64 string-decrypt loop:
//   x0 = ptr, x1 = len
//   loop:
//     ldrb w2, [x0]
//     eor  w2, w2, #0x55
//     strb w2, [x0], #1     (post-inc)
//     subs x1, x1, #1
//     b.ne loop
//   ret

const INS = [
  // pc=0: ldrb w2, [x0]
  { op: "ldrb", bits: 32, dst: { kind: "reg", name: "w2" }, src: { kind: "mem", base: "x0" }, size: 4 },
  // pc=4: eor w2, w2, #0x55
  { op: "eor",  bits: 32, dst: { kind: "reg", name: "w2" }, src: { kind: "reg", name: "w2" }, src2: { kind: "imm", value: 0x55n }, size: 4 },
  // pc=8: strb w2, [x0], #1   (post-inc)
  { op: "strb", bits: 32, dst: { kind: "mem", base: "x0", post: true, disp: 1n }, src: { kind: "reg", name: "w2" }, size: 4 },
  // pc=12: subs x1, x1, #1
  { op: "subs", bits: 64, dst: { kind: "reg", name: "x1" }, src: { kind: "reg", name: "x1" }, src2: { kind: "imm", value: 1n }, size: 4 },
  // pc=16: b.ne 0
  { op: "b.cond", cond: "ne", target: 0n, size: 4 },
  // pc=20: ret
  { op: "ret", size: 4 },
];

test("arm64: xor decrypt loop over 4 bytes", () => {
  const r = emulateArm64({
    instructions: INS,
    memorySize: 0x4000,
    initialRegs: { x0: "4096", x1: "4" },
    initialMem: { "0x1000": "01 02 03 04" },
    readback: [{ addr: "0x1000", size: 4 }],
  });
  // 0x01^0x55=0x54, 0x02^0x55=0x57, 0x03^0x55=0x56, 0x04^0x55=0x51
  assert.equal(r.memory_reads[0].hex, "54575651");
  assert.equal(r.reason, "ret");
  assert.equal(r.regs.x1, "0x0");
});

test("arm64: wN write zero-extends to xN", () => {
  const ins = [
    { op: "mov", bits: 32, dst: { kind: "reg", name: "w0" }, src: { kind: "imm", value: 0xCAFEBABEn }, size: 4 },
    { op: "ret", size: 4 },
  ];
  const r = emulateArm64({ instructions: ins });
  assert.equal(r.regs.x0, "0xcafebabe");
});

test("arm64: cbz branches when register is zero", () => {
  const ins = [
    // pc=0: mov x0, #0
    { op: "mov", bits: 64, dst: { kind: "reg", name: "x0" }, src: { kind: "imm", value: 0n }, size: 4 },
    // pc=4: cbz x0, 12   (jump to pc=12)
    { op: "cbz", dst: { kind: "reg", name: "x0" }, target: 12n, size: 4 },
    // pc=8: mov x1, #99  (should be SKIPPED)
    { op: "mov", bits: 64, dst: { kind: "reg", name: "x1" }, src: { kind: "imm", value: 99n }, size: 4 },
    // pc=12: ret
    { op: "ret", size: 4 },
  ];
  const r = emulateArm64({ instructions: ins });
  assert.equal(r.regs.x1, "0x0"); // the mov was skipped
});
