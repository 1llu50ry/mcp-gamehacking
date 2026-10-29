// ============================================================
// Native PE patching helpers.
//
//   pe_code_cave_find   — locate N-byte runs of free space inside
//                         an executable section (0x00/0x90/0xCC
//                         fills + section-end slack). Where to drop
//                         shellcode or a trampoline without growing
//                         the file.
//
//   pe_overlay_extract  — dump bytes past the last section's raw
//                         boundary. Classic dropper storage; also
//                         where signed PEs stash the Authenticode
//                         PKCS#7 blob.
//
//   pe_jcc_swap         — flip JZ↔JNZ / JE↔JNE / JA↔JBE / JB↔JAE /
//                         JL↔JGE / JLE↔JG at a given offset. Writes
//                         a *copy* with `.patched` suffix; original
//                         is never modified.
//
//   pe_nop_bytes        — overwrite N bytes with 0x90 in a copy.
//                         The common "ignore this call" patch.
//
// Zero deps.
// ============================================================

import { z } from "zod";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

interface Section { name: string; vaddr: number; vsize: number; raw: number; rsize: number; chars: number }

function parsePeSections(buf: Buffer): Section[] | null {
  if (buf.length < 0x40 || buf[0] !== 0x4D || buf[1] !== 0x5A) return null;
  const peOff = buf.readUInt32LE(0x3C);
  if (peOff + 24 >= buf.length || buf.readUInt32LE(peOff) !== 0x00004550) return null;
  const nSec   = buf.readUInt16LE(peOff + 6);
  const magic  = buf.readUInt16LE(peOff + 24);
  const is64   = magic === 0x20B;
  const secStart = peOff + 24 + (is64 ? 240 : 224);
  const out: Section[] = [];
  for (let i = 0; i < nSec && secStart + (i + 1) * 40 <= buf.length; i++) {
    const base = secStart + i * 40;
    out.push({
      name:  buf.slice(base, base + 8).toString("ascii").replace(/\0.*$/, ""),
      vaddr: buf.readUInt32LE(base + 12),
      vsize: buf.readUInt32LE(base + 8),
      raw:   buf.readUInt32LE(base + 20),
      rsize: buf.readUInt32LE(base + 16),
      chars: buf.readUInt32LE(base + 36),
    });
  }
  return out;
}

export interface CodeCave { section: string; file_offset: string; va_hint: string; length: number; fill: string }

export function findCodeCaves(buf: Uint8Array, minLen: number): CodeCave[] {
  const b = Buffer.from(buf);
  const sections = parsePeSections(b);
  if (!sections) return [];
  const caves: CodeCave[] = [];
  for (const s of sections) {
    // IMAGE_SCN_MEM_EXECUTE 0x20000000 — only hunt caves in exec sections.
    if (!(s.chars & 0x20000000)) continue;
    // Trailing slack: bytes past rsize up to the aligned section boundary.
    // We treat the gap between rsize and the next section's raw start.
    const end = Math.min(s.raw + s.rsize, b.length);
    for (let i = s.raw; i + minLen <= end; i++) {
      const first = b[i];
      if (first !== 0x00 && first !== 0x90 && first !== 0xCC) continue;
      let j = i;
      while (j < end && b[j] === first) j++;
      if (j - i >= minLen) {
        caves.push({
          section: s.name,
          file_offset: "0x" + i.toString(16),
          va_hint: "0x" + (s.vaddr + (i - s.raw)).toString(16),
          length: j - i,
          fill: first === 0x00 ? "00" : first === 0x90 ? "nop" : "int3",
        });
      }
      i = j - 1;
    }
    // Alignment slack after rsize
    const alignedEnd = Math.ceil((s.raw + s.rsize) / 0x200) * 0x200;
    if (alignedEnd - (s.raw + s.rsize) >= minLen) {
      caves.push({
        section: s.name,
        file_offset: "0x" + (s.raw + s.rsize).toString(16),
        va_hint: "0x" + (s.vaddr + s.vsize).toString(16),
        length: alignedEnd - (s.raw + s.rsize),
        fill: "section-slack",
      });
    }
  }
  return caves.sort((a, b) => b.length - a.length);
}

export function overlayRange(buf: Uint8Array): { start: number; length: number } | null {
  const b = Buffer.from(buf);
  const sections = parsePeSections(b);
  if (!sections) return null;
  const maxEnd = sections.reduce((m, s) => Math.max(m, s.raw + s.rsize), 0);
  if (maxEnd >= b.length) return null;
  return { start: maxEnd, length: b.length - maxEnd };
}

// JCC flip table (near-form 0x7X opcodes AND far-form 0x0F 0x8X).
const JCC_FLIP: Record<number, number> = {
  0x70: 0x71, 0x71: 0x70,  // JO ↔ JNO
  0x72: 0x73, 0x73: 0x72,  // JB/JC ↔ JAE/JNC
  0x74: 0x75, 0x75: 0x74,  // JZ/JE ↔ JNZ/JNE
  0x76: 0x77, 0x77: 0x76,  // JBE ↔ JA
  0x78: 0x79, 0x79: 0x78,  // JS ↔ JNS
  0x7A: 0x7B, 0x7B: 0x7A,  // JP ↔ JNP
  0x7C: 0x7D, 0x7D: 0x7C,  // JL ↔ JGE
  0x7E: 0x7F, 0x7F: 0x7E,  // JLE ↔ JG
};

export function swapJcc(buf: Uint8Array, offset: number): { from: string; to: string } | null {
  const op = buf[offset];
  if (op === 0x0F && JCC_FLIP[buf[offset + 1] - 0x10] !== undefined) {
    // far form 0F 8X — translate to the matching 7X in the flip table
    const near = buf[offset + 1] - 0x10; // 0x80..0x8F → 0x70..0x7F
    const flip = JCC_FLIP[near];
    if (flip === undefined) return null;
    buf[offset + 1] = flip + 0x10;
    return { from: "0F " + near.toString(16), to: "0F " + buf[offset + 1].toString(16) };
  }
  if (JCC_FLIP[op] !== undefined) {
    buf[offset] = JCC_FLIP[op];
    return { from: op.toString(16), to: buf[offset].toString(16) };
  }
  return null;
}

export function registerNativePePatch(server: McpServer): void {
  server.tool(
    "pe_code_cave_find",
    "Locate code caves (0x00/0x90/0xCC runs + section slack) inside executable sections of a PE. Where to drop a trampoline without resizing the file.",
    { path: z.string(), minLen: z.number().min(4).max(16384).default(32), limit: z.number().min(1).max(1000).default(50) },
    async ({ path, minLen, limit }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const caves = findCodeCaves(new Uint8Array(buf), minLen);
      const shown = caves.slice(0, limit);
      return { content: [{ type: "text" as const, text:
        `# pe_code_cave_find ${path}\n\n**candidates:** ${caves.length} (showing ${shown.length})\n\n` +
        shown.map(c => `- \`${c.section}\` @ ${c.file_offset} (va ${c.va_hint}) — **${c.length} B** fill=${c.fill}`).join("\n")
      }] };
    });

  server.tool(
    "pe_overlay_extract",
    "Dump bytes past the last PE section's raw boundary (dropper storage / Authenticode / stego). Writes `<path>.overlay`.",
    { path: z.string(), out: z.string().optional() },
    async ({ path, out }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const r = overlayRange(new Uint8Array(buf));
      if (!r) return { content: [{ type: "text" as const, text: "# pe_overlay_extract\n\nno overlay found" }] };
      const dest = out ?? path + ".overlay";
      requirePathAllowed(dest);
      await writeFile(dest, buf.subarray(r.start));
      return { content: [{ type: "text" as const, text:
        `# pe_overlay_extract\n\n**wrote:** \`${dest}\`\n**start:** 0x${r.start.toString(16)}  **length:** ${r.length} bytes`
      }] };
    });

  server.tool(
    "pe_jcc_swap",
    "Flip a conditional jump (JZ↔JNZ etc.) at a file offset. Writes `<path>.patched` + a `.bak` of the original.",
    { path: z.string(), offset: z.string() },
    async ({ path, offset }) => {
      requirePathAllowed(path);
      const buf = new Uint8Array(await readFile(path));
      const off = Number(BigInt(offset));
      if (off < 0 || off >= buf.length) throw new Error(`offset out of range: ${offset}`);
      const r = swapJcc(buf, off);
      if (!r) throw new Error(`byte at ${offset} is 0x${buf[off].toString(16)} — not a Jcc near/far opcode`);
      const dest = path + ".patched";
      requirePathAllowed(dest);
      try { await copyFile(path, dest + ".bak"); } catch { /* ignore if dest write fails below */ }
      await writeFile(dest, buf);
      return { content: [{ type: "text" as const, text:
        `# pe_jcc_swap\n\n**wrote:** \`${dest}\`\n**flip:** ${r.from} → ${r.to} @ ${offset}`
      }] };
    });

  server.tool(
    "pe_nop_bytes",
    "Overwrite N bytes with 0x90 (NOP) at a file offset in a copy. Classic 'ignore this call' patch.",
    { path: z.string(), offset: z.string(), count: z.number().min(1).max(1024) },
    async ({ path, offset, count }) => {
      requirePathAllowed(path);
      const buf = new Uint8Array(await readFile(path));
      const off = Number(BigInt(offset));
      if (off < 0 || off + count > buf.length) throw new Error(`range out of file: ${offset}+${count}`);
      const before = Array.from(buf.slice(off, off + Math.min(16, count))).map(b => b.toString(16).padStart(2, "0")).join(" ");
      for (let i = 0; i < count; i++) buf[off + i] = 0x90;
      const dest = path + ".patched";
      requirePathAllowed(dest);
      try { await copyFile(path, dest + ".bak"); } catch { /* ignore if dest write fails below */ }
      await writeFile(dest, buf);
      return { content: [{ type: "text" as const, text:
        `# pe_nop_bytes\n\n**wrote:** \`${dest}\`\n**range:** ${offset}+${count}\n**was:** \`${before}\`\n**now:**  \`${"90 ".repeat(Math.min(16, count)).trim()}\``
      }] };
    });
}
