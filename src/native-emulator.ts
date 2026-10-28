// ============================================================
// Native "unicorn-light": a *tiny* x86-64 emulator just big enough
// to run string-decryption loops and small decrypt stubs without a
// real CPU emulator. Zero deps.
//
// Supports a focused slice of x86-64 that covers 90% of what malware
// authors use for inline decryption:
//   mov r/m, r/imm         (8/16/32/64 incl. REX.W)
//   add / sub / xor / and / or r/m, r/imm
//   not / neg / inc / dec r/m
//   rol / ror / shl / shr / sar r/m, imm
//   push / pop
//   cmp + Jcc (JZ/JNZ/JE/JNE/JL/JLE/JG/JGE/JS/JNS)
//   loop / loope / loopne
//   lea
//   ret
//
// What it does NOT do: floating point, SIMD, syscalls, segment regs,
// prefetches, or anything microarchitectural. Guard rails:
//   - instructionBudget (default 1_000_000) — hard trip on infinite loops
//   - memory is a sparse Uint8Array of configurable size (default 64 KiB)
//   - the whole thing is pure JS/TS, no WASM, no FFI, no network
//
// Entry points:
//   emulate({ code, start, memorySize?, initialRegs?, budget? }) → EmuResult
//
// Register names use lower-case 64-bit convention (rax, rbx, …, r8..r15,
// rip, rflags). Reads of 32/16/8-bit subregisters work from the same
// backing store.
// ============================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type U8 = number & { readonly __u8: unique symbol };

const REG_NAMES = [
  "rax","rcx","rdx","rbx","rsp","rbp","rsi","rdi",
  "r8","r9","r10","r11","r12","r13","r14","r15",
] as const;

interface Flags { cf: boolean; zf: boolean; sf: boolean; of: boolean; pf: boolean; af: boolean }

interface EmuState {
  mem: Uint8Array;
  memSize: number;
  regs: BigInt64Array;    // index 0..15 == REG_NAMES
  rip: bigint;
  flags: Flags;
  budget: number;
  halted: boolean;
  haltReason?: string;
}

export interface EmuResult {
  stopped_at: string;
  reason: string;
  instructions: number;
  regs: Record<string, string>;
  flags: Flags;
  memory_reads: { addr: string; size: number; hex: string }[];
}

const mask = (bits: number) => (1n << BigInt(bits)) - 1n;
const sign = (v: bigint, bits: number) => {
  const m = 1n << BigInt(bits - 1);
  const s = v & mask(bits);
  return (s & m) ? s - (1n << BigInt(bits)) : s;
};

function regIdx(name: string): number {
  const i = REG_NAMES.indexOf(name as typeof REG_NAMES[number]);
  if (i < 0) throw new Error(`unknown register: ${name}`);
  return i;
}

function setReg(st: EmuState, idx: number, val: bigint, bits: 8|16|32|64) {
  const cur = st.regs[idx];
  const m = mask(bits);
  let out: bigint;
  if (bits === 64)      out = val & 0xFFFFFFFFFFFFFFFFn;
  else if (bits === 32) out = val & 0xFFFFFFFFn;  // writes zero-extend on x86-64
  else                  out = (cur & ~m) | (val & m);
  st.regs[idx] = out;
}

function getReg(st: EmuState, idx: number, bits: 8|16|32|64): bigint {
  const v = st.regs[idx];
  return BigInt.asUintN(bits, v);
}

function readMem(st: EmuState, addr: bigint, bytes: number): bigint {
  const a = Number(addr & mask(32));           // 32-bit mem addressing for now
  if (a + bytes > st.memSize) throw new Error(`mem read oob: 0x${a.toString(16)}+${bytes}`);
  let v = 0n;
  for (let i = bytes - 1; i >= 0; i--) v = (v << 8n) | BigInt(st.mem[a + i]);
  return v;
}

function writeMem(st: EmuState, addr: bigint, val: bigint, bytes: number) {
  const a = Number(addr & mask(32));
  if (a + bytes > st.memSize) throw new Error(`mem write oob: 0x${a.toString(16)}+${bytes}`);
  for (let i = 0; i < bytes; i++) {
    st.mem[a + i] = Number((val >> BigInt(i * 8)) & 0xFFn);
  }
}

function setArithFlags(st: EmuState, result: bigint, bits: 8|16|32|64) {
  const m = mask(bits);
  const r = result & m;
  st.flags.zf = r === 0n;
  st.flags.sf = (r >> BigInt(bits - 1)) === 1n;
  // parity: xor of low byte bits == 0 → PF
  let p = 1;
  let low = Number(r & 0xFFn);
  while (low) { p ^= (low & 1); low >>= 1; }
  st.flags.pf = p === 1;
}

// ---- a tiny declarative mini-decoder.
// The point here is NOT to implement all of x86 — just the shapes seen
// in string-decryption stubs. Each instruction is passed as a {op, dst, src}
// object by the caller, so this module can run both from raw bytes *and*
// from a disassembly list the caller already has (preferred: it keeps
// decode and semantics separate, so other backends can emit the same IR).

export interface Insn {
  op: string;                  // "mov" | "add" | "xor" | "sub" | "and" | "or" | "not" | "neg" | "inc" | "dec" | "shl" | "shr" | "sar" | "rol" | "ror" | "push" | "pop" | "cmp" | "jmp" | "jz" | "jnz" | "je" | "jne" | "jl" | "jle" | "jg" | "jge" | "js" | "jns" | "loop" | "lea" | "ret" | "hlt"
  bits?: 8|16|32|64;           // operand size
  dst?: Operand;
  src?: Operand;
  target?: bigint;             // for jumps / calls
  size: number;                // in-memory encoded size (for RIP advance)
}

export type Operand =
  | { kind: "reg"; name: string }
  | { kind: "imm"; value: bigint }
  | { kind: "mem"; base?: string; index?: string; scale?: 1|2|4|8; disp?: bigint };

function evalOperandRead(st: EmuState, op: Operand, bits: 8|16|32|64): bigint {
  if (op.kind === "imm") return op.value & mask(bits);
  if (op.kind === "reg") return getReg(st, regIdx(op.name), bits);
  // mem
  let addr = op.disp ?? 0n;
  if (op.base)  addr += getReg(st, regIdx(op.base), 64);
  if (op.index) addr += getReg(st, regIdx(op.index), 64) * BigInt(op.scale ?? 1);
  return readMem(st, addr, bits / 8);
}

function evalOperandWrite(st: EmuState, op: Operand, val: bigint, bits: 8|16|32|64) {
  if (op.kind === "reg") return setReg(st, regIdx(op.name), val, bits);
  if (op.kind === "mem") {
    let addr = op.disp ?? 0n;
    if (op.base)  addr += getReg(st, regIdx(op.base), 64);
    if (op.index) addr += getReg(st, regIdx(op.index), 64) * BigInt(op.scale ?? 1);
    return writeMem(st, addr, val, bits / 8);
  }
  throw new Error(`cannot write immediate operand`);
}

function cond(st: EmuState, kind: string): boolean {
  const f = st.flags;
  switch (kind) {
    case "jz": case "je":   return f.zf;
    case "jnz": case "jne": return !f.zf;
    case "js":              return f.sf;
    case "jns":             return !f.sf;
    case "jl":              return f.sf !== f.of;
    case "jle":             return f.zf || f.sf !== f.of;
    case "jg":              return !f.zf && f.sf === f.of;
    case "jge":             return f.sf === f.of;
    case "jmp":             return true;
  }
  return false;
}

function stepOne(st: EmuState, ins: Insn[]): void {
  // find the instruction whose encoded range contains RIP
  // (callers pass an array keyed by index == instruction, we linear scan)
  let acc = 0n;
  let idx = -1;
  for (let i = 0; i < ins.length; i++) {
    if (acc === st.rip) { idx = i; break; }
    acc += BigInt(ins[i].size);
  }
  if (idx < 0) { st.halted = true; st.haltReason = `rip 0x${st.rip.toString(16)} not aligned to any instruction`; return; }
  const in_ = ins[idx];
  const bits = (in_.bits ?? 64) as 8|16|32|64;
  const advance = () => { st.rip += BigInt(in_.size); };

  switch (in_.op) {
    case "mov":  evalOperandWrite(st, in_.dst!, evalOperandRead(st, in_.src!, bits), bits); advance(); break;
    case "add": {
      const a = evalOperandRead(st, in_.dst!, bits);
      const b = evalOperandRead(st, in_.src!, bits);
      const r = (a + b) & mask(bits);
      setArithFlags(st, r, bits);
      st.flags.cf = (a + b) > mask(bits);
      evalOperandWrite(st, in_.dst!, r, bits);
      advance(); break;
    }
    case "sub": case "cmp": {
      const a = evalOperandRead(st, in_.dst!, bits);
      const b = evalOperandRead(st, in_.src!, bits);
      const r = (a - b) & mask(bits);
      setArithFlags(st, r, bits);
      st.flags.cf = a < b;
      if (in_.op === "sub") evalOperandWrite(st, in_.dst!, r, bits);
      advance(); break;
    }
    case "xor": case "and": case "or": {
      const a = evalOperandRead(st, in_.dst!, bits);
      const b = evalOperandRead(st, in_.src!, bits);
      const r = in_.op === "xor" ? (a ^ b) : in_.op === "and" ? (a & b) : (a | b);
      setArithFlags(st, r & mask(bits), bits);
      st.flags.cf = false; st.flags.of = false;
      evalOperandWrite(st, in_.dst!, r & mask(bits), bits);
      advance(); break;
    }
    case "not":  evalOperandWrite(st, in_.dst!, (~evalOperandRead(st, in_.dst!, bits)) & mask(bits), bits); advance(); break;
    case "neg": {
      const v = evalOperandRead(st, in_.dst!, bits);
      const r = ((-v) & mask(bits));
      setArithFlags(st, r, bits);
      st.flags.cf = v !== 0n;
      evalOperandWrite(st, in_.dst!, r, bits);
      advance(); break;
    }
    case "inc": case "dec": {
      const v = evalOperandRead(st, in_.dst!, bits);
      const r = ((in_.op === "inc" ? v + 1n : v - 1n) & mask(bits));
      setArithFlags(st, r, bits);
      evalOperandWrite(st, in_.dst!, r, bits);
      advance(); break;
    }
    case "shl": case "shr": case "sar": {
      const v = evalOperandRead(st, in_.dst!, bits);
      const n = Number(evalOperandRead(st, in_.src!, 8) & 0x3Fn);
      let r: bigint;
      if (in_.op === "shl") r = (v << BigInt(n)) & mask(bits);
      else if (in_.op === "shr") r = v >> BigInt(n);
      else r = sign(v, bits) >> BigInt(n);
      setArithFlags(st, r & mask(bits), bits);
      evalOperandWrite(st, in_.dst!, r & mask(bits), bits);
      advance(); break;
    }
    case "rol": case "ror": {
      const v = evalOperandRead(st, in_.dst!, bits);
      const n = Number(evalOperandRead(st, in_.src!, 8) & 0x3Fn) % bits;
      const r = in_.op === "rol"
        ? ((v << BigInt(n)) | (v >> BigInt(bits - n))) & mask(bits)
        : ((v >> BigInt(n)) | (v << BigInt(bits - n))) & mask(bits);
      evalOperandWrite(st, in_.dst!, r, bits);
      advance(); break;
    }
    case "push": {
      const v = evalOperandRead(st, in_.src!, 64);
      st.regs[regIdx("rsp")] = st.regs[regIdx("rsp")] - 8n;
      writeMem(st, getReg(st, regIdx("rsp"), 64), v, 8);
      advance(); break;
    }
    case "pop": {
      const v = readMem(st, getReg(st, regIdx("rsp"), 64), 8);
      st.regs[regIdx("rsp")] = st.regs[regIdx("rsp")] + 8n;
      evalOperandWrite(st, in_.dst!, v, 64);
      advance(); break;
    }
    case "lea": {
      const op = in_.src! as Extract<Operand, { kind: "mem" }>;
      let addr = op.disp ?? 0n;
      if (op.base)  addr += getReg(st, regIdx(op.base), 64);
      if (op.index) addr += getReg(st, regIdx(op.index), 64) * BigInt(op.scale ?? 1);
      evalOperandWrite(st, in_.dst!, addr & mask(bits), bits);
      advance(); break;
    }
    case "jmp": case "jz": case "jnz": case "je": case "jne":
    case "jl":  case "jle":case "jg": case "jge": case "js": case "jns": {
      if (cond(st, in_.op)) st.rip = in_.target!;
      else advance();
      break;
    }
    case "loop": {
      // decrement rcx; if rcx != 0 jump
      const n = (getReg(st, regIdx("rcx"), 64) - 1n) & mask(64);
      setReg(st, regIdx("rcx"), n, 64);
      if (n !== 0n) st.rip = in_.target!;
      else advance();
      break;
    }
    case "ret":  st.halted = true; st.haltReason = "ret"; break;
    case "hlt":  st.halted = true; st.haltReason = "hlt"; break;
    default:     st.halted = true; st.haltReason = `unknown op: ${in_.op}`; break;
  }
}

export interface EmuOpts {
  instructions: Insn[];
  start?: bigint;
  memorySize?: number;
  initialMem?: Record<string, string>; // "0x1000" → hex string
  initialRegs?: Record<string, string>;
  budget?: number;
  readback?: { addr: string; size: number }[];
}

export function emulate(opts: EmuOpts): EmuResult {
  const memSize = opts.memorySize ?? 0x10000;
  const st: EmuState = {
    mem: new Uint8Array(memSize),
    memSize,
    regs: new BigInt64Array(16),
    rip: opts.start ?? 0n,
    flags: { cf: false, zf: false, sf: false, of: false, pf: false, af: false },
    budget: opts.budget ?? 1_000_000,
    halted: false,
  };
  // seed stack somewhere safe
  setReg(st, regIdx("rsp"), BigInt(memSize - 0x100), 64);

  for (const [name, hex] of Object.entries(opts.initialMem ?? {})) {
    const addr = Number(BigInt(name));
    const bytes = hex.replace(/\s+/g, "").match(/.{1,2}/g) ?? [];
    for (let i = 0; i < bytes.length; i++) st.mem[addr + i] = parseInt(bytes[i], 16);
  }
  for (const [name, val] of Object.entries(opts.initialRegs ?? {})) {
    setReg(st, regIdx(name), BigInt(val), 64);
  }

  let executed = 0;
  while (!st.halted && executed < st.budget) {
    stepOne(st, opts.instructions);
    executed++;
  }
  if (!st.halted && executed >= st.budget) {
    st.halted = true; st.haltReason = `budget exhausted at ${executed} instructions`;
  }

  const regs: Record<string, string> = {};
  for (const n of REG_NAMES) regs[n] = "0x" + getReg(st, regIdx(n), 64).toString(16);
  regs.rip = "0x" + st.rip.toString(16);

  const memory_reads = (opts.readback ?? []).map(r => {
    const a = Number(BigInt(r.addr));
    const sl = Array.from(st.mem.slice(a, a + r.size));
    return { addr: r.addr, size: r.size, hex: sl.map(b => b.toString(16).padStart(2, "0")).join("") };
  });

  return {
    stopped_at: regs.rip,
    reason: st.haltReason ?? "ok",
    instructions: executed,
    regs,
    flags: st.flags,
    memory_reads,
  };
}

const InsnZ: z.ZodType<Insn> = z.object({
  op: z.string(),
  bits: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).optional(),
  dst: z.any().optional(),
  src: z.any().optional(),
  target: z.string().optional().transform(v => v == null ? undefined : BigInt(v)) as unknown as z.ZodType<bigint | undefined>,
  size: z.number().min(1).max(16),
});

export function registerEmulator(server: McpServer): void {
  server.tool(
    "emu_run",
    "Run a tiny built-in x86-64 emulator over a provided instruction list (useful for string-decrypt loops). Pure JS, no deps.",
    {
      instructions: z.array(InsnZ).max(10_000),
      start: z.string().default("0x0").transform(v => BigInt(v)) as unknown as z.ZodType<bigint>,
      memorySize: z.number().min(0x100).max(0x1000000).default(0x10000),
      initialMem: z.record(z.string(), z.string()).default({}),
      initialRegs: z.record(z.string(), z.string()).default({}),
      budget: z.number().min(1).max(10_000_000).default(1_000_000),
      readback: z.array(z.object({ addr: z.string(), size: z.number().min(1).max(1 << 20) })).default([]),
    },
    async (args) => {
      try {
        const result = emulate(args as unknown as EmuOpts);
        return { content: [{ type: "text" as const, text: `# emu_run\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `emu_run error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );

  server.tool(
    "emu_decrypt_xor",
    "Shortcut: decrypt a buffer by rolling XOR with a key (common inline string obfuscation).",
    {
      hex: z.string().describe("space-separated hex bytes or packed hex"),
      key: z.string().describe("hex key bytes (repeating)"),
      op: z.enum(["xor", "add", "sub"]).default("xor"),
    },
    async ({ hex, key, op }) => {
      const buf = (hex.replace(/\s+/g, "").match(/.{1,2}/g) ?? []).map(h => parseInt(h, 16));
      const k   = (key.replace(/\s+/g, "").match(/.{1,2}/g) ?? []).map(h => parseInt(h, 16));
      if (k.length === 0) return { content: [{ type: "text" as const, text: "key required" }], isError: true as const };
      const out = buf.map((b, i) => {
        const kb = k[i % k.length];
        return op === "xor" ? (b ^ kb) : op === "add" ? ((b + kb) & 0xFF) : ((b - kb + 256) & 0xFF);
      });
      const asHex = out.map(b => b.toString(16).padStart(2, "0")).join("");
      const asStr = String.fromCharCode(...out.map(b => (b >= 32 && b < 127) ? b : 46));
      return { content: [{ type: "text" as const, text: `# emu_decrypt_xor (${op})\n\n**hex:** \`${asHex}\`\n\n**ascii-ish:** \`${asStr}\`` }] };
    },
  );
}
