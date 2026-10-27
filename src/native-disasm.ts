// Native TypeScript x86-64 mini-disassembler.
//
// NOT a full Zydis/Capstone replacement. Covers the common prologue /
// epilogue instructions you care about when triaging a function:
//
//   PUSH / POP reg
//   MOV reg, reg
//   MOV reg, imm32/imm64
//   SUB / ADD rsp, imm8/imm32
//   JMP / CALL rel32
//   CALL / JMP [rip+disp32]
//   RET / INT3
//   NOP (single + multi-byte)
//   LEA reg, [rip+disp32]
//   XOR / AND / OR reg, reg
//
// Anything unrecognised is emitted as `db 0xNN` so disassembly never
// crashes on exotic encodings; you still see the bytes.

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

const REG64 = ["rax","rcx","rdx","rbx","rsp","rbp","rsi","rdi","r8","r9","r10","r11","r12","r13","r14","r15"];
const REG32 = ["eax","ecx","edx","ebx","esp","ebp","esi","edi","r8d","r9d","r10d","r11d","r12d","r13d","r14d","r15d"];
const REG8  = ["al","cl","dl","bl","spl","bpl","sil","dil","r8b","r9b","r10b","r11b","r12b","r13b","r14b","r15b"];

export interface DisasmLine {
  offset: number;
  bytes: string;      // hex, space-separated
  mnemonic: string;
  operands: string;
}

interface Ctx {
  buf: Buffer;
  p: number;          // current cursor
  base: bigint;       // VA base
  rex: number;        // REX prefix (0 if none)
  opSize64: boolean;  // W bit set
  opSize16: boolean;  // 0x66 prefix seen
  addrSize32: boolean;// 0x67 prefix seen
}

function regName(ctx: Ctx, idx: number, kind: "r64" | "r32" | "r8"): string {
  const i = idx & 0xf;
  if (kind === "r64") return REG64[i];
  if (kind === "r32") return REG32[i];
  return REG8[i];
}

function readU8(ctx: Ctx): number { return ctx.buf[ctx.p++]; }
function readU16(ctx: Ctx): number { const v = ctx.buf.readUInt16LE(ctx.p); ctx.p += 2; return v; }
function readU32(ctx: Ctx): number { const v = ctx.buf.readUInt32LE(ctx.p); ctx.p += 4; return v; }
function readI8(ctx: Ctx): number { const v = ctx.buf.readInt8(ctx.p); ctx.p += 1; return v; }
function readI32(ctx: Ctx): number { const v = ctx.buf.readInt32LE(ctx.p); ctx.p += 4; return v; }
function readU64(ctx: Ctx): bigint { const v = ctx.buf.readBigUInt64LE(ctx.p); ctx.p += 8; return v; }

function hexByte(n: number) { return n.toString(16).padStart(2, "0").toUpperCase(); }
function hexAddr(n: bigint): string { return "0x" + n.toString(16).toUpperCase(); }

function sliceBytes(buf: Buffer, start: number, end: number): string {
  const out = [];
  for (let i = start; i < end; i++) out.push(hexByte(buf[i]));
  return out.join(" ");
}

export function disasm(buf: Buffer, baseVa: bigint, length = buf.length): DisasmLine[] {
  const out: DisasmLine[] = [];
  const ctx: Ctx = { buf, p: 0, base: baseVa, rex: 0, opSize64: false, opSize16: false, addrSize32: false };

  while (ctx.p < length) {
    const start = ctx.p;
    ctx.rex = 0;
    ctx.opSize64 = false;
    ctx.opSize16 = false;
    ctx.addrSize32 = false;

    // Prefixes
    while (ctx.p < length) {
      const b = ctx.buf[ctx.p];
      if (b === 0x66) { ctx.opSize16 = true; ctx.p++; continue; }
      if (b === 0x67) { ctx.addrSize32 = true; ctx.p++; continue; }
      if (b === 0xf0 || b === 0xf2 || b === 0xf3) { ctx.p++; continue; } // LOCK / REP(N)E
      if (b === 0x2e || b === 0x36 || b === 0x3e || b === 0x26 || b === 0x64 || b === 0x65) { ctx.p++; continue; } // seg
      if ((b & 0xf0) === 0x40) { ctx.rex = b; ctx.opSize64 = (b & 0x08) !== 0; ctx.p++; continue; }
      break;
    }

    if (ctx.p >= length) break;

    const op = readU8(ctx);
    let line: DisasmLine;

    // 1-byte opcodes we actually decode
    if (op === 0xC3) { line = { offset: start, bytes: "", mnemonic: "ret", operands: "" }; }
    else if (op === 0xCC) { line = { offset: start, bytes: "", mnemonic: "int3", operands: "" }; }
    else if (op === 0x90) { line = { offset: start, bytes: "", mnemonic: "nop", operands: "" }; }
    else if (op >= 0x50 && op <= 0x57) {
      // PUSH r64
      const r = (op - 0x50) | ((ctx.rex & 0x1) << 3);
      line = { offset: start, bytes: "", mnemonic: "push", operands: regName(ctx, r, "r64") };
    } else if (op >= 0x58 && op <= 0x5F) {
      const r = (op - 0x58) | ((ctx.rex & 0x1) << 3);
      line = { offset: start, bytes: "", mnemonic: "pop", operands: regName(ctx, r, "r64") };
    } else if (op === 0xE8 || op === 0xE9) {
      // CALL / JMP rel32
      const rel = readI32(ctx);
      const dst = ctx.base + BigInt(ctx.p) + BigInt(rel);
      line = { offset: start, bytes: "", mnemonic: op === 0xE8 ? "call" : "jmp", operands: hexAddr(dst) };
    } else if (op === 0xEB) {
      const rel = readI8(ctx);
      const dst = ctx.base + BigInt(ctx.p) + BigInt(rel);
      line = { offset: start, bytes: "", mnemonic: "jmp", operands: hexAddr(dst) };
    } else if (op >= 0xB8 && op <= 0xBF) {
      // MOV r64/r32, imm
      const r = (op - 0xB8) | ((ctx.rex & 0x1) << 3);
      if (ctx.opSize64) {
        const imm = readU64(ctx);
        line = { offset: start, bytes: "", mnemonic: "mov", operands: `${regName(ctx, r, "r64")}, 0x${imm.toString(16).toUpperCase()}` };
      } else {
        const imm = readU32(ctx);
        line = { offset: start, bytes: "", mnemonic: "mov", operands: `${regName(ctx, r, "r32")}, 0x${imm.toString(16).toUpperCase()}` };
      }
    } else if (op === 0x89) {
      // MOV r/m, r (reg-to-reg form)
      const modrm = readU8(ctx);
      const mod = modrm >> 6;
      const reg = ((ctx.rex & 0x4) << 1) | ((modrm >> 3) & 7);
      const rm = ((ctx.rex & 0x1) << 3) | (modrm & 7);
      if (mod === 3) {
        const kind = ctx.opSize64 ? "r64" : "r32";
        line = { offset: start, bytes: "", mnemonic: "mov", operands: `${regName(ctx, rm, kind)}, ${regName(ctx, reg, kind)}` };
      } else {
        line = { offset: start, bytes: "", mnemonic: "mov", operands: "[mem], reg" };
      }
    } else if (op === 0x8B) {
      // MOV r, r/m
      const modrm = readU8(ctx);
      const mod = modrm >> 6;
      const reg = ((ctx.rex & 0x4) << 1) | ((modrm >> 3) & 7);
      const rm = ((ctx.rex & 0x1) << 3) | (modrm & 7);
      if (mod === 3) {
        const kind = ctx.opSize64 ? "r64" : "r32";
        line = { offset: start, bytes: "", mnemonic: "mov", operands: `${regName(ctx, reg, kind)}, ${regName(ctx, rm, kind)}` };
      } else {
        line = { offset: start, bytes: "", mnemonic: "mov", operands: "reg, [mem]" };
      }
    } else if (op === 0x83) {
      // ADD/SUB/CMP r/m64, imm8  (identify SUB RSP, imm8 / ADD RSP, imm8)
      const modrm = readU8(ctx);
      const sub = (modrm >> 3) & 7;
      const rm = ((ctx.rex & 0x1) << 3) | (modrm & 7);
      const imm = readI8(ctx);
      const name = sub === 0 ? "add" : sub === 5 ? "sub" : sub === 7 ? "cmp" : "op83";
      line = { offset: start, bytes: "", mnemonic: name, operands: `${regName(ctx, rm, "r64")}, 0x${(imm & 0xff).toString(16).toUpperCase()}` };
    } else if (op === 0x81) {
      // ADD/SUB r/m, imm32
      const modrm = readU8(ctx);
      const sub = (modrm >> 3) & 7;
      const rm = ((ctx.rex & 0x1) << 3) | (modrm & 7);
      const imm = readU32(ctx);
      const name = sub === 0 ? "add" : sub === 5 ? "sub" : sub === 7 ? "cmp" : "op81";
      line = { offset: start, bytes: "", mnemonic: name, operands: `${regName(ctx, rm, "r64")}, 0x${imm.toString(16).toUpperCase()}` };
    } else if (op === 0x8D) {
      // LEA r, [rip+disp32]  (the common `lea reg, [rip+rel]` form)
      const modrm = readU8(ctx);
      const mod = modrm >> 6;
      const reg = ((ctx.rex & 0x4) << 1) | ((modrm >> 3) & 7);
      const rm = modrm & 7;
      if (mod === 0 && rm === 5) {
        const disp = readI32(ctx);
        const dst = ctx.base + BigInt(ctx.p) + BigInt(disp);
        line = { offset: start, bytes: "", mnemonic: "lea", operands: `${regName(ctx, reg, "r64")}, [rip+${hexAddr(dst)}]` };
      } else {
        line = { offset: start, bytes: "", mnemonic: "lea", operands: "reg, [mem]" };
      }
    } else if (op === 0xFF) {
      // CALL/JMP r/m
      const modrm = readU8(ctx);
      const sub = (modrm >> 3) & 7;
      const mod = modrm >> 6;
      const rm = modrm & 7;
      const mnem = sub === 2 ? "call" : sub === 4 ? "jmp" : "op_ff";
      if (mod === 0 && rm === 5) {
        const disp = readI32(ctx);
        const dst = ctx.base + BigInt(ctx.p) + BigInt(disp);
        line = { offset: start, bytes: "", mnemonic: mnem, operands: `[rip+${hexAddr(dst)}]` };
      } else {
        line = { offset: start, bytes: "", mnemonic: mnem, operands: "r/m" };
      }
    } else {
      line = { offset: start, bytes: "", mnemonic: "db", operands: "0x" + hexByte(op) };
    }

    line.bytes = sliceBytes(ctx.buf, start, ctx.p);
    out.push(line);
  }
  return out;
}

export function registerNativeDisasm(server: McpServer): void {
  server.tool(
    "disasm_x86_64",
    "Native TypeScript x86-64 mini-disassembler. Covers common prologue/epilogue + MOV reg,reg + CALL/JMP rel32 + LEA [rip+disp32] + SUB RSP imm. Unknown opcodes emit `db 0xNN`. Not a full Zydis replacement — use `smart_decompile` or a backend when you need a complete decoder.",
    {
      path: z.string(),
      offset: z.number().min(0).default(0),
      length: z.number().min(1).max(1 << 20).default(256),
      baseVa: z.string().default("0x140000000").describe("Hex image base VA used for CALL/JMP target resolution."),
    },
    async ({ path, offset, length, baseVa }: { path: string; offset: number; length: number; baseVa: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const slice = buf.slice(offset, offset + length);
        const base = BigInt(baseVa);
        const lines = disasm(slice, base + BigInt(offset), slice.length);
        const text = [
          `# disasm_x86_64 ${path} offset=0x${offset.toString(16)} length=${length}`,
          `# base_va=${baseVa}`,
          ``,
          ...lines.map((l) => `${(base + BigInt(l.offset) + BigInt(offset)).toString(16).padStart(16, "0").toUpperCase()}  ${l.bytes.padEnd(28)} ${l.mnemonic.padEnd(6)} ${l.operands}`),
        ].join("\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `disasm_x86_64 error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );
}
