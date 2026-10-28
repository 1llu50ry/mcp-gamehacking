import test from "node:test";
import assert from "node:assert/strict";
import { emulate } from "../dist/native-emulator.js";

// A classic string-decryption pattern:
//   mov rcx, length           ; (seeded via initialRegs)
//   mov rsi, 0x1000           ;
//   xor_loop:
//     xor BYTE PTR [rsi], 0x42
//     inc rsi
//   loop xor_loop
//   ret
//
// We build the instruction list declaratively; the emulator's goal
// here is to flip every byte in [0x1000, 0x1000+rcx) with 0x42.

const INSTRUCTIONS = [
  // 0: xor BYTE PTR [rsi], 0x42  (size 3)
  { op: "xor", bits: 8, dst: { kind: "mem", base: "rsi" }, src: { kind: "imm", value: 0x42n }, size: 3 },
  // 3: inc rsi                   (size 3)
  { op: "inc", bits: 64, dst: { kind: "reg", name: "rsi" }, size: 3 },
  // 6: loop 0  (target rip=0 - BigInt as string literal "0x0")
  { op: "loop", target: 0n, size: 2 },
  // 8: ret
  { op: "ret", size: 1 },
];

test("emulator: xor-decrypt loop over 4 bytes", () => {
  const r = emulate({
    instructions: INSTRUCTIONS,
    start: 0n,
    memorySize: 0x4000,
    initialRegs: { rcx: "4", rsi: "4096" }, // 0x1000
    initialMem: { "0x1000": "01 02 03 04" },
    readback: [{ addr: "0x1000", size: 4 }],
  });
  // 0x01^0x42=0x43, 0x02^0x42=0x40, 0x03^0x42=0x41, 0x04^0x42=0x46
  assert.equal(r.memory_reads[0].hex, "43404146");
  assert.equal(r.reason, "ret");
  assert.equal(r.regs.rcx, "0x0");
});

test("emulator: budget guard trips on infinite loop", () => {
  const infLoop = [
    { op: "jmp", target: 0n, size: 2 },
  ];
  const r = emulate({ instructions: infLoop, budget: 1000 });
  assert.match(r.reason, /budget exhausted/);
});

test("emulator: 32-bit mov zero-extends to 64", () => {
  const ins = [
    { op: "mov", bits: 32, dst: { kind: "reg", name: "rax" }, src: { kind: "imm", value: 0xDEADBEEFn }, size: 5 },
    { op: "ret", size: 1 },
  ];
  const r = emulate({ instructions: ins });
  assert.equal(r.regs.rax, "0xdeadbeef");
});
