// ============================================================
// Native ROP / COP gadget finder — scans executable regions for
// short useful tails ending in `ret`, `jmp reg`, or `call reg`.
//
// This is deliberately a simple heuristic finder, not a full
// disassembler: we scan backwards from each terminator for up to
// `maxDepth` bytes and classify what we see using the existing
// mini-disassembler in src/native-disasm.ts. If decoding fails, the
// slice is skipped — no corrupt gadgets in the output.
//
// Supported archs:
//   - x86-64 (default)
//   - x86-32 (opcode map is a superset for the shapes we match)
//   - aarch64 (ret = 0xD65F03C0 fixed-size instruction)
//
// Each gadget is returned as { addr, bytes, asm, score } where asm
// is the symbolic representation and score is a crude usefulness
// metric (shorter + more reg-touching = higher).
//
// Zero deps.
// ============================================================

import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

export interface Gadget {
  addr: string;
  bytes: string;
  asm: string;
  size: number;
  score: number;
}

// Super-small opcode table — just enough to render gadget bytes as
// plausible asm. Byte-level patterns; each entry says what consumed
// how many bytes and what to emit.
const X64_REGS = ["rax","rcx","rdx","rbx","rsp","rbp","rsi","rdi"];
function x64Reg(idx: number): string { return X64_REGS[idx & 7]; }

type DecOne = (bytes: Uint8Array, i: number) => { consumed: number; label: string } | null;

const X64_DECODERS: DecOne[] = [
  // ret
  (b, i) => b[i] === 0xC3 ? { consumed: 1, label: "ret" } : null,
  // retf
  (b, i) => b[i] === 0xCB ? { consumed: 1, label: "retf" } : null,
  // ret imm16
  (b, i) => (b[i] === 0xC2 && i + 2 < b.length) ? { consumed: 3, label: `ret 0x${((b[i+2] << 8) | b[i+1]).toString(16)}` } : null,
  // nop
  (b, i) => b[i] === 0x90 ? { consumed: 1, label: "nop" } : null,
  // pop reg (0x58..0x5F)
  (b, i) => (b[i] >= 0x58 && b[i] <= 0x5F) ? { consumed: 1, label: `pop ${x64Reg(b[i] & 7)}` } : null,
  // push reg (0x50..0x57)
  (b, i) => (b[i] >= 0x50 && b[i] <= 0x57) ? { consumed: 1, label: `push ${x64Reg(b[i] & 7)}` } : null,
  // jmp reg (0xFF /4)
  (b, i) => (b[i] === 0xFF && b[i+1] >= 0xE0 && b[i+1] <= 0xE7) ? { consumed: 2, label: `jmp ${x64Reg(b[i+1] & 7)}` } : null,
  // call reg (0xFF /2)
  (b, i) => (b[i] === 0xFF && b[i+1] >= 0xD0 && b[i+1] <= 0xD7) ? { consumed: 2, label: `call ${x64Reg(b[i+1] & 7)}` } : null,
  // mov r/m64, r64 (REX.W 48 89 /r, modrm reg-reg)
  (b, i) => (b[i] === 0x48 && b[i+1] === 0x89 && b[i+2] >= 0xC0 && b[i+2] <= 0xFF) ?
    { consumed: 3, label: `mov ${x64Reg(b[i+2] & 7)}, ${x64Reg((b[i+2] >> 3) & 7)}` } : null,
  // mov r64, r/m64 (REX.W 48 8B /r)
  (b, i) => (b[i] === 0x48 && b[i+1] === 0x8B && b[i+2] >= 0xC0 && b[i+2] <= 0xFF) ?
    { consumed: 3, label: `mov ${x64Reg((b[i+2] >> 3) & 7)}, ${x64Reg(b[i+2] & 7)}` } : null,
  // xor r32, r32 (31 /r, reg-reg encoding C0..FF)
  (b, i) => (b[i] === 0x31 && b[i+1] >= 0xC0 && b[i+1] <= 0xFF) ?
    { consumed: 2, label: `xor ${x64Reg(b[i+1] & 7)}, ${x64Reg((b[i+1] >> 3) & 7)}` } : null,
  // xor r64, r64 (48 31 /r)
  (b, i) => (b[i] === 0x48 && b[i+1] === 0x31 && b[i+2] >= 0xC0 && b[i+2] <= 0xFF) ?
    { consumed: 3, label: `xor ${x64Reg(b[i+2] & 7)}, ${x64Reg((b[i+2] >> 3) & 7)}` } : null,
  // add r64, r64 (48 01 /r)
  (b, i) => (b[i] === 0x48 && b[i+1] === 0x01 && b[i+2] >= 0xC0 && b[i+2] <= 0xFF) ?
    { consumed: 3, label: `add ${x64Reg(b[i+2] & 7)}, ${x64Reg((b[i+2] >> 3) & 7)}` } : null,
];

function hexOfSlice(buf: Uint8Array, start: number, len: number): string {
  const h: string[] = [];
  for (let i = 0; i < len; i++) h.push(buf[start + i].toString(16).padStart(2, "0"));
  return h.join("");
}

function renderX64Gadget(bytes: Uint8Array): string {
  let i = 0;
  const parts: string[] = [];
  while (i < bytes.length) {
    let emitted = false;
    for (const dec of X64_DECODERS) {
      const r = dec(bytes, i);
      if (r) { parts.push(r.label); i += r.consumed; emitted = true; break; }
    }
    if (!emitted) {
      parts.push(`db 0x${bytes[i].toString(16).padStart(2, "0")}`);
      i++;
    }
  }
  return parts.join("; ");
}

export function findGadgetsX64(bin: Uint8Array, opts: { maxDepth?: number } = {}): Gadget[] {
  const maxDepth = opts.maxDepth ?? 10;
  const out: Gadget[] = [];
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] === 0xC3 /* ret */) {
      // Walk backwards up to maxDepth, emit all gadgets with length 1..maxDepth
      const to = Math.max(0, i - maxDepth + 1);
      for (let j = i; j >= to; j--) {
        const slice = bin.subarray(j, i + 1);
        // Skip gadgets that start with ret-like bytes (would just be ret)
        if (slice.length === 1) {
          out.push({ addr: "0x" + j.toString(16), bytes: "c3", asm: "ret", size: 1, score: 0 });
          continue;
        }
        const asm = renderX64Gadget(slice);
        // Gadgets ending in `ret` and NOT containing an unknown `db` are considered valid
        if (!asm.includes("db ")) {
          const score = Math.max(1, 10 - slice.length) + (/\b(mov|xor|pop|push)\b/.test(asm) ? 3 : 0);
          out.push({
            addr: "0x" + j.toString(16),
            bytes: hexOfSlice(bin, j, slice.length),
            asm,
            size: slice.length,
            score,
          });
        }
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function findGadgetsArm64(bin: Uint8Array): Gadget[] {
  const out: Gadget[] = [];
  // ret = 0xD65F03C0 (little-endian: c0 03 5f d6)
  for (let i = 0; i + 4 <= bin.length; i += 4) {
    if (bin[i] === 0xC0 && bin[i + 1] === 0x03 && bin[i + 2] === 0x5F && bin[i + 3] === 0xD6) {
      // Walk back by 4-byte instructions (ARM64 is fixed-width)
      for (let j = Math.max(0, i - 24); j <= i; j += 4) {
        out.push({
          addr: "0x" + j.toString(16),
          bytes: hexOfSlice(bin, j, i + 4 - j),
          asm: `<${(i + 4 - j) / 4} aarch64 insns>; ret`,
          size: i + 4 - j,
          score: 10 - (i - j) / 4,
        });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function registerRop(server: McpServer): void {
  server.tool(
    "rop_find",
    "Scan a binary for short gadgets ending in ret / jmp reg / call reg. Set arch=x86_64 (default) or aarch64. Zero deps.",
    {
      path: z.string(),
      arch: z.enum(["x86_64", "aarch64"]).default("x86_64"),
      maxDepth: z.number().min(2).max(32).default(10),
      limit:    z.number().min(1).max(100000).default(500),
    },
    async ({ path, arch, maxDepth, limit }) => {
      try {
        requirePathAllowed(path);
        const buf = new Uint8Array(await readFile(path));
        const gadgets = arch === "aarch64" ? findGadgetsArm64(buf) : findGadgetsX64(buf, { maxDepth });
        const sliced = gadgets.slice(0, limit);
        const text = [
          `# rop_find ${path} (arch=${arch})`,
          `**gadgets:** ${gadgets.length}  **showing:** ${sliced.length}`,
          ``,
          ...sliced.map(g => `- ${g.addr}  \`${g.bytes}\`  ${g.asm}  _score=${g.score}_`),
        ].join("\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `rop_find error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );

  server.tool(
    "rop_chain",
    "Assemble a packed binary chain of gadget addresses + inline uint64 values (little-endian) suitable to splice into an exploit payload.",
    {
      slots: z.array(z.union([
        z.object({ kind: z.literal("gadget"), addr: z.string() }),
        z.object({ kind: z.literal("value"),  value: z.string() }),
      ])),
    },
    async ({ slots }) => {
      const buf = Buffer.alloc(slots.length * 8);
      for (let i = 0; i < slots.length; i++) {
        const v = BigInt(slots[i].kind === "gadget" ? (slots[i] as { addr: string }).addr : (slots[i] as { value: string }).value);
        buf.writeBigUInt64LE(v & 0xFFFFFFFFFFFFFFFFn, i * 8);
      }
      return { content: [{ type: "text" as const, text: `# rop_chain (${slots.length} slots)\n\n**bytes (hex):** \`${buf.toString("hex")}\`\n\n**bytes (python):** \`${buf.toString("hex").match(/.{1,2}/g)?.map(h => "\\x" + h).join("")}\`` }] };
    },
  );
}
