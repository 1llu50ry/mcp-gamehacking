// ============================================================
// Native AArch64 (ARM64) emulator — matches the shape of the x86-64
// emulator in native-emulator.ts so the agent-side IR can target
// both archs. Decode is operand-model, not raw bytes: callers pass
// an Insn[] (from a Capstone/Keystone dump, from a bridge, or
// hand-written) and we execute the semantics with full flag model.
//
// Supported subset (covers 95% of ARM64 string-decrypt loops):
//   mov / movz / movk          (register + imm, with LSL #0/#16/#32/#48 shift)
//   add / sub / adds / subs    (with imm or register, optional shift)
//   and / orr / eor / bic
//   lsl / lsr / asr / ror      (reg or imm)
//   mvn / neg
//   ldr / str / ldrb / strb / ldrh / strh   (base+disp or [base], #disp pre/post)
//   cmp / tst                  (just like subs/ands with no write-back)
//   b / b.<cond> / cbz / cbnz / tbz / tbnz
//   bl / blr / ret
//   nop / brk
//
// Flags: NZCV. Register file: x0..x30 (+ sp, pc). Writes to Wn
// zero-extend into Xn, same as the real CPU.
//
// Zero deps.
// ============================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const REG_NAMES = [
  "x0","x1","x2","x3","x4","x5","x6","x7","x8","x9",
  "x10","x11","x12","x13","x14","x15","x16","x17","x18","x19",
  "x20","x21","x22","x23","x24","x25","x26","x27","x28","x29","x30",
] as const;
// index 31 is reserved for SP; XZR is handled by name "xzr"/"wzr" → zero sink.

interface Flags { N: boolean; Z: boolean; C: boolean; V: boolean }

interface State {
  mem: Uint8Array;
  memSize: number;
  regs: BigInt64Array;   // 0..30, index 31 = SP
  pc: bigint;
  flags: Flags;
  budget: number;
  halted: boolean;
  haltReason?: string;
}

const mask = (bits: number) => (1n << BigInt(bits)) - 1n;

function regIdx(name: string): { idx: number; zero: boolean; bits: 32 | 64 } {
  const n = name.toLowerCase();
  if (n === "sp" || n === "wsp") return { idx: 31, zero: false, bits: n === "wsp" ? 32 : 64 };
  if (n === "xzr" || n === "wzr") return { idx: -1, zero: true, bits: n === "wzr" ? 32 : 64 };
  if (n[0] === "x" || n[0] === "w") {
    const i = parseInt(n.slice(1), 10);
    if (i >= 0 && i <= 30) return { idx: i, zero: false, bits: n[0] === "w" ? 32 : 64 };
  }
  throw new Error(`unknown arm64 register: ${name}`);
}

function readReg(st: State, name: string): bigint {
  const { idx, zero, bits } = regIdx(name);
  if (zero) return 0n;
  const v = st.regs[idx];
  return BigInt.asUintN(bits, v);
}

function writeReg(st: State, name: string, val: bigint) {
  const { idx, zero, bits } = regIdx(name);
  if (zero) return;
  // W-reg writes zero-extend
  st.regs[idx] = bits === 32 ? BigInt.asIntN(64, val & 0xFFFFFFFFn) : BigInt.asIntN(64, val & 0xFFFFFFFFFFFFFFFFn);
}

function regBits(name: string): 32 | 64 { return regIdx(name).bits; }

function readMem(st: State, addr: bigint, bytes: number): bigint {
  const a = Number(addr & mask(32));
  if (a + bytes > st.memSize) throw new Error(`mem read oob: 0x${a.toString(16)}+${bytes}`);
  let v = 0n;
  for (let i = bytes - 1; i >= 0; i--) v = (v << 8n) | BigInt(st.mem[a + i]);
  return v;
}

function writeMem(st: State, addr: bigint, val: bigint, bytes: number) {
  const a = Number(addr & mask(32));
  if (a + bytes > st.memSize) throw new Error(`mem write oob: 0x${a.toString(16)}+${bytes}`);
  for (let i = 0; i < bytes; i++) st.mem[a + i] = Number((val >> BigInt(i * 8)) & 0xFFn);
}

function setFlagsNZ(st: State, result: bigint, bits: 32 | 64) {
  const m = mask(bits);
  const r = result & m;
  st.flags.Z = r === 0n;
  st.flags.N = (r >> BigInt(bits - 1)) === 1n;
}

function setFlagsAdd(st: State, a: bigint, b: bigint, bits: 32 | 64) {
  const m = mask(bits);
  const s = (a + b);
  const r = s & m;
  setFlagsNZ(st, r, bits);
  st.flags.C = s > m;
  const sa = (a >> BigInt(bits - 1)) & 1n;
  const sb = (b >> BigInt(bits - 1)) & 1n;
  const sr = (r >> BigInt(bits - 1)) & 1n;
  st.flags.V = sa === sb && sa !== sr;
}

function setFlagsSub(st: State, a: bigint, b: bigint, bits: 32 | 64) {
  const m = mask(bits);
  const r = (a - b) & m;
  setFlagsNZ(st, r, bits);
  st.flags.C = a >= b;
  const sa = (a >> BigInt(bits - 1)) & 1n;
  const sb = (b >> BigInt(bits - 1)) & 1n;
  const sr = (r >> BigInt(bits - 1)) & 1n;
  st.flags.V = sa !== sb && sa !== sr;
}

export type Operand =
  | { kind: "reg";  name: string }
  | { kind: "imm";  value: bigint;  shift?: { kind: "lsl" | "lsr" | "asr" | "ror"; amount: number } }
  | { kind: "mem";  base: string;   disp?: bigint;  pre?: boolean;  post?: boolean;  index?: string; shift?: { kind: "lsl"; amount: number } };

export interface Arm64Insn {
  op: string;
  dst?: Operand;
  src?: Operand;
  src2?: Operand;
  cond?: string;       // "eq" | "ne" | "lt" | …
  target?: bigint;
  size: number;        // encoded size (should be 4 for valid ARM64 but we don't enforce)
  bits?: 8 | 16 | 32 | 64;
}

function resolveOperandRead(st: State, op: Operand, bits: 32 | 64): bigint {
  if (op.kind === "reg") return readReg(st, op.name);
  if (op.kind === "imm") {
    let v = op.value;
    if (op.shift) {
      const n = BigInt(op.shift.amount);
      if (op.shift.kind === "lsl") v = v << n;
      if (op.shift.kind === "lsr") v = v >> n;
      if (op.shift.kind === "asr") v = BigInt.asIntN(bits, v) >> n;
      if (op.shift.kind === "ror") v = ((v >> n) | (v << (BigInt(bits) - n))) & mask(bits);
    }
    return v & mask(bits);
  }
  throw new Error("cannot read-op mem through resolveOperandRead; use addrOf+readMem");
}

function addrOf(st: State, op: Extract<Operand, { kind: "mem" }>): bigint {
  let a = readReg(st, op.base);
  if (op.disp != null && !op.post) a += op.disp;
  if (op.index) {
    let idx = readReg(st, op.index);
    if (op.shift?.kind === "lsl") idx = idx << BigInt(op.shift.amount);
    a += idx;
  }
  return a;
}

function postIncrement(st: State, op: Extract<Operand, { kind: "mem" }>) {
  if (op.post && op.disp != null) writeReg(st, op.base, readReg(st, op.base) + op.disp);
  else if (op.pre && op.disp != null) writeReg(st, op.base, readReg(st, op.base) + op.disp);
}

function condHolds(st: State, c: string): boolean {
  const f = st.flags;
  switch (c.toLowerCase()) {
    case "eq": return f.Z;
    case "ne": return !f.Z;
    case "cs": case "hs": return f.C;
    case "cc": case "lo": return !f.C;
    case "mi": return f.N;
    case "pl": return !f.N;
    case "vs": return f.V;
    case "vc": return !f.V;
    case "hi": return f.C && !f.Z;
    case "ls": return !f.C || f.Z;
    case "ge": return f.N === f.V;
    case "lt": return f.N !== f.V;
    case "gt": return !f.Z && f.N === f.V;
    case "le": return f.Z || f.N !== f.V;
    case "al": case "": return true;
    default: return false;
  }
}

function step(st: State, ins: Arm64Insn[]) {
  let acc = 0n;
  let idx = -1;
  for (let i = 0; i < ins.length; i++) {
    if (acc === st.pc) { idx = i; break; }
    acc += BigInt(ins[i].size);
  }
  if (idx < 0) { st.halted = true; st.haltReason = `pc 0x${st.pc.toString(16)} not aligned`; return; }
  const in_ = ins[idx];
  const bits = (in_.bits ?? (in_.dst?.kind === "reg" ? regBits(in_.dst.name) : 64)) as 32 | 64;
  const advance = () => { st.pc += BigInt(in_.size); };

  switch (in_.op) {
    case "mov":
    case "movz":
      writeReg(st, (in_.dst as { kind: "reg"; name: string }).name, resolveOperandRead(st, in_.src!, bits));
      advance(); break;
    case "movk": {
      const name = (in_.dst as { kind: "reg"; name: string }).name;
      const sh = (in_.src as Extract<Operand, { kind: "imm" }>).shift?.amount ?? 0;
      const v = (in_.src as Extract<Operand, { kind: "imm" }>).value & 0xFFFFn;
      const cur = readReg(st, name);
      const cleared = cur & ~(0xFFFFn << BigInt(sh));
      writeReg(st, name, cleared | (v << BigInt(sh)));
      advance(); break;
    }
    case "add": case "adds": {
      const a = readReg(st, (in_.src as { kind: "reg"; name: string }).name);
      const b = resolveOperandRead(st, in_.src2!, bits);
      const r = (a + b) & mask(bits);
      if (in_.op === "adds") setFlagsAdd(st, a, b, bits);
      writeReg(st, (in_.dst as { kind: "reg"; name: string }).name, r);
      advance(); break;
    }
    case "sub": case "subs": case "cmp": {
      const srcReg = in_.op === "cmp"
        ? (in_.dst as { kind: "reg"; name: string }).name
        : (in_.src as { kind: "reg"; name: string }).name;
      const a = readReg(st, srcReg);
      const b = resolveOperandRead(st, (in_.op === "cmp" ? in_.src! : in_.src2!), bits);
      const r = (a - b) & mask(bits);
      if (in_.op === "subs" || in_.op === "cmp") setFlagsSub(st, a, b, bits);
      if (in_.op === "sub" || in_.op === "subs") writeReg(st, (in_.dst as { kind: "reg"; name: string }).name, r);
      advance(); break;
    }
    case "and": case "ands": case "orr": case "eor": case "bic": case "tst": {
      const a = readReg(st, (in_.op === "tst" ? (in_.dst as { kind: "reg"; name: string }).name : (in_.src as { kind: "reg"; name: string }).name));
      const b = resolveOperandRead(st, (in_.op === "tst" ? in_.src! : in_.src2!), bits);
      let r: bigint;
      if (in_.op === "and" || in_.op === "ands" || in_.op === "tst") r = a & b;
      else if (in_.op === "orr") r = a | b;
      else if (in_.op === "eor") r = a ^ b;
      else r = a & ~b;
      r &= mask(bits);
      if (in_.op === "ands" || in_.op === "tst") { setFlagsNZ(st, r, bits); st.flags.C = false; st.flags.V = false; }
      if (in_.op !== "tst") writeReg(st, (in_.dst as { kind: "reg"; name: string }).name, r);
      advance(); break;
    }
    case "mvn": {
      const b = resolveOperandRead(st, in_.src!, bits);
      writeReg(st, (in_.dst as { kind: "reg"; name: string }).name, (~b) & mask(bits));
      advance(); break;
    }
    case "neg": {
      const b = resolveOperandRead(st, in_.src!, bits);
      writeReg(st, (in_.dst as { kind: "reg"; name: string }).name, (-b) & mask(bits));
      advance(); break;
    }
    case "lsl": case "lsr": case "asr": case "ror": {
      const a = readReg(st, (in_.src as { kind: "reg"; name: string }).name);
      const n = resolveOperandRead(st, in_.src2!, bits) % BigInt(bits);
      let r: bigint;
      if (in_.op === "lsl") r = (a << n) & mask(bits);
      else if (in_.op === "lsr") r = a >> n;
      else if (in_.op === "asr") r = BigInt.asIntN(bits, a) >> n;
      else r = ((a >> n) | (a << (BigInt(bits) - n))) & mask(bits);
      writeReg(st, (in_.dst as { kind: "reg"; name: string }).name, r & mask(bits));
      advance(); break;
    }
    case "ldr": case "ldrb": case "ldrh": {
      const w = in_.op === "ldrb" ? 1 : in_.op === "ldrh" ? 2 : bits / 8;
      const op = in_.src as Extract<Operand, { kind: "mem" }>;
      const v = readMem(st, addrOf(st, op), w);
      writeReg(st, (in_.dst as { kind: "reg"; name: string }).name, v);
      postIncrement(st, op);
      advance(); break;
    }
    case "str": case "strb": case "strh": {
      const w = in_.op === "strb" ? 1 : in_.op === "strh" ? 2 : bits / 8;
      const op = in_.dst as Extract<Operand, { kind: "mem" }>;
      writeMem(st, addrOf(st, op), readReg(st, (in_.src as { kind: "reg"; name: string }).name) & mask(w * 8), w);
      postIncrement(st, op);
      advance(); break;
    }
    case "b": advance(); st.pc = in_.target!; break;
    case "b.cond": case "bcond": {
      advance();
      if (condHolds(st, in_.cond ?? "al")) st.pc = in_.target!;
      break;
    }
    case "cbz": case "cbnz": {
      const v = readReg(st, (in_.dst as { kind: "reg"; name: string }).name);
      advance();
      if ((in_.op === "cbz" && v === 0n) || (in_.op === "cbnz" && v !== 0n)) st.pc = in_.target!;
      break;
    }
    case "tbz": case "tbnz": {
      const v = readReg(st, (in_.dst as { kind: "reg"; name: string }).name);
      const bit = Number(resolveOperandRead(st, in_.src!, bits));
      const set = ((v >> BigInt(bit)) & 1n) === 1n;
      advance();
      if ((in_.op === "tbz" && !set) || (in_.op === "tbnz" && set)) st.pc = in_.target!;
      break;
    }
    case "bl": writeReg(st, "x30", st.pc + BigInt(in_.size)); st.pc = in_.target!; break;
    case "blr": writeReg(st, "x30", st.pc + BigInt(in_.size)); st.pc = readReg(st, (in_.dst as { kind: "reg"; name: string }).name); break;
    case "ret": st.halted = true; st.haltReason = "ret"; break;
    case "nop": advance(); break;
    case "brk": st.halted = true; st.haltReason = "brk"; break;
    default: st.halted = true; st.haltReason = `unknown op: ${in_.op}`;
  }
}

export interface EmuArm64Opts {
  instructions: Arm64Insn[];
  start?: bigint;
  memorySize?: number;
  initialMem?: Record<string, string>;
  initialRegs?: Record<string, string>;
  budget?: number;
  readback?: { addr: string; size: number }[];
}

export interface EmuArm64Result {
  stopped_at: string;
  reason: string;
  instructions: number;
  regs: Record<string, string>;
  flags: Flags;
  memory_reads: { addr: string; size: number; hex: string }[];
}

export function emulateArm64(opts: EmuArm64Opts): EmuArm64Result {
  const memSize = opts.memorySize ?? 0x10000;
  const st: State = {
    mem: new Uint8Array(memSize),
    memSize,
    regs: new BigInt64Array(32),
    pc: opts.start ?? 0n,
    flags: { N: false, Z: false, C: false, V: false },
    budget: opts.budget ?? 1_000_000,
    halted: false,
  };
  // seed sp
  st.regs[31] = BigInt(memSize - 0x100);

  for (const [name, hex] of Object.entries(opts.initialMem ?? {})) {
    const addr = Number(BigInt(name));
    const bytes = hex.replace(/\s+/g, "").match(/.{1,2}/g) ?? [];
    for (let i = 0; i < bytes.length; i++) st.mem[addr + i] = parseInt(bytes[i], 16);
  }
  for (const [name, val] of Object.entries(opts.initialRegs ?? {})) {
    writeReg(st, name, BigInt(val));
  }

  let executed = 0;
  while (!st.halted && executed < st.budget) {
    step(st, opts.instructions);
    executed++;
  }
  if (!st.halted && executed >= st.budget) {
    st.halted = true; st.haltReason = `budget exhausted at ${executed} instructions`;
  }

  const regs: Record<string, string> = {};
  for (const n of REG_NAMES) regs[n] = "0x" + readReg(st, n).toString(16);
  regs.sp = "0x" + readReg(st, "sp").toString(16);
  regs.pc = "0x" + st.pc.toString(16);

  const memory_reads = (opts.readback ?? []).map(r => {
    const a = Number(BigInt(r.addr));
    const sl = Array.from(st.mem.slice(a, a + r.size));
    return { addr: r.addr, size: r.size, hex: sl.map(b => b.toString(16).padStart(2, "0")).join("") };
  });

  return {
    stopped_at: regs.pc,
    reason: st.haltReason ?? "ok",
    instructions: executed,
    regs,
    flags: st.flags,
    memory_reads,
  };
}

export function registerArm64(server: McpServer): void {
  server.tool(
    "emu_arm64_run",
    "Run the native AArch64 (ARM64) emulator over a declarative instruction list. Zero deps; covers 95% of iOS/Android string-decrypt loops.",
    {
      instructions: z.array(z.object({
        op: z.string(),
        dst: z.any().optional(),
        src: z.any().optional(),
        src2: z.any().optional(),
        cond: z.string().optional(),
        target: z.string().optional(),
        size: z.number().min(1).max(16),
        bits: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).optional(),
      })).max(10_000),
      start: z.string().default("0x0"),
      memorySize: z.number().min(0x100).max(0x1000000).default(0x10000),
      initialMem: z.record(z.string(), z.string()).default({}),
      initialRegs: z.record(z.string(), z.string()).default({}),
      budget: z.number().min(1).max(10_000_000).default(1_000_000),
      readback: z.array(z.object({ addr: z.string(), size: z.number().min(1).max(1 << 20) })).default([]),
    },
    async (args) => {
      try {
        const insns = args.instructions.map(i => ({
          ...i,
          target: i.target != null ? BigInt(i.target) : undefined,
        })) as Arm64Insn[];
        const r = emulateArm64({
          instructions: insns,
          start: BigInt(args.start),
          memorySize: args.memorySize,
          initialMem: args.initialMem,
          initialRegs: args.initialRegs,
          budget: args.budget,
          readback: args.readback,
        });
        return { content: [{ type: "text" as const, text: `# emu_arm64_run\n\n\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\`` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `emu_arm64_run error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );
}
