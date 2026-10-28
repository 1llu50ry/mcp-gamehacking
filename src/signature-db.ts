// ============================================================
// FLIRT-light — a tiny community-shareable function-signature engine
// so stripped binaries can get *some* symbols back without needing
// IDA's F.L.I.R.T. toolchain.
//
// Each signature:
//   {
//     name:  "memcpy",
//     module: "msvcr120",
//     prolog: "48 8B C1 48 89 D1 ??",          // mask bytes with "??"
//     length: 32,                              // bytes to compare
//     crc16:  "0xabcd",                        // CRC over tail bytes
//     tailLen: 128                             // bytes CRC covers
//   }
//
// The matcher does three passes over the target binary:
//   1. byte-sweep for every sig's prolog with mask (fast, Boyer-Moore-ish)
//   2. for each hit, CRC16 the next `tailLen` bytes and compare to crc16
//   3. the one with the longest matched prolog wins at each address
//
// Signatures live in signatures/*.json; the first ship with the project
// is bundled as data under signatures/common.json (ready-to-extend).
//
// Zero deps.
// ============================================================

import { z } from "zod";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

const SIG_DIR = "signatures";

export interface Signature {
  name: string;
  module?: string;
  prolog: string;
  length?: number;
  crc16?: string;
  tailLen?: number;
}

function parseMasked(sig: string): { bytes: number[]; mask: number[] } {
  const toks = sig.toUpperCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const bytes: number[] = [];
  const mask:  number[] = [];
  for (const t of toks) {
    if (t === "??") { bytes.push(0); mask.push(0); }
    else            { bytes.push(parseInt(t, 16)); mask.push(0xFF); }
  }
  return { bytes, mask };
}

function crc16(buf: Uint8Array, start: number, len: number): number {
  // CRC-16/ARC — the one FLIRT historically used (polynomial 0x8005, reflected)
  let crc = 0;
  const end = Math.min(start + len, buf.length);
  for (let i = start; i < end; i++) {
    crc ^= buf[i];
    for (let b = 0; b < 8; b++) crc = (crc >> 1) ^ ((crc & 1) ? 0xA001 : 0);
  }
  return crc & 0xFFFF;
}

function* scanMasked(buf: Uint8Array, bytes: number[], mask: number[]): Generator<number> {
  const n = bytes.length;
  if (n === 0) return;
  const stop = buf.length - n;
  for (let i = 0; i <= stop; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if ((buf[i + j] & mask[j]) !== (bytes[j] & mask[j])) { ok = false; break; }
    }
    if (ok) yield i;
  }
}

async function loadSignatures(root: string): Promise<Signature[]> {
  const dir = join(root, SIG_DIR);
  try {
    const files = await readdir(dir);
    const out: Signature[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const text = await readFile(join(dir, f), "utf8");
        const arr: Signature[] = JSON.parse(text);
        for (const s of arr) out.push(s);
      } catch { /* skip bad files */ }
    }
    return out;
  } catch { return []; }
}

export interface SigHit { address: string; name: string; module?: string; score: number }

export async function matchSignatures(binary: Uint8Array, sigs: Signature[]): Promise<SigHit[]> {
  const bestAt = new Map<number, SigHit>();
  for (const sig of sigs) {
    const { bytes, mask } = parseMasked(sig.prolog);
    const score = bytes.filter((_, i) => mask[i] === 0xFF).length;
    const needCrc = sig.crc16 && sig.tailLen;
    const expCrc  = needCrc ? parseInt(sig.crc16!, 16) : 0;
    for (const off of scanMasked(binary, bytes, mask)) {
      if (needCrc) {
        const got = crc16(binary, off + bytes.length, sig.tailLen!);
        if (got !== expCrc) continue;
      }
      const prev = bestAt.get(off);
      if (!prev || prev.score < score) bestAt.set(off, {
        address: "0x" + off.toString(16),
        name: sig.name,
        module: sig.module,
        score,
      });
    }
  }
  return Array.from(bestAt.values()).sort((a, b) => parseInt(a.address) - parseInt(b.address));
}

// --- builder: produce a signature file from a known-good object/dll ---
// Reads bytes from `path`, picks `funcs` (name + offset + length) and
// emits one Signature per entry — prolog = first `prologLen` bytes with
// no mask, crc16 over the next `tailLen`. Analysts hand-tune the mask
// later for registers / displacements.

export async function makeSignaturesFromRanges(
  binary: Uint8Array,
  funcs: { name: string; offset: number; length: number }[],
  prologLen = 16,
  tailLen = 128,
): Promise<Signature[]> {
  const out: Signature[] = [];
  for (const f of funcs) {
    const prolog = Array.from(binary.slice(f.offset, f.offset + Math.min(prologLen, f.length)))
      .map(b => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    const crc = crc16(binary, f.offset + prologLen, Math.min(tailLen, f.length - prologLen));
    out.push({
      name: f.name,
      prolog,
      length: prologLen,
      crc16: "0x" + crc.toString(16).padStart(4, "0"),
      tailLen,
    });
  }
  return out;
}

export function registerSignatureDb(server: McpServer, root: string): void {
  server.tool(
    "sig_list",
    "List every FLIRT-light signature bundled under signatures/*.json.",
    { module: z.string().optional() },
    async ({ module }: { module?: string }) => {
      const all = await loadSignatures(root);
      const filtered = module ? all.filter(s => s.module === module) : all;
      const text = [
        `# sig_list — ${filtered.length} signature${filtered.length === 1 ? "" : "s"}`,
        ...filtered.map(s => `- \`${s.name}\`${s.module ? ` (${s.module})` : ""} — ${s.prolog.slice(0, 48)}${s.prolog.length > 48 ? "…" : ""}`),
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "sig_match",
    "Match every bundled signature against a target binary file. Returns one hit per address (longest prolog wins).",
    { path: z.string(), module: z.string().optional() },
    async ({ path, module }: { path: string; module?: string }) => {
      try {
        requirePathAllowed(path);
        const bin = await readFile(path);
        const sigs = (await loadSignatures(root)).filter(s => !module || s.module === module);
        const hits = await matchSignatures(bin, sigs);
        const text = [
          `# sig_match ${path}`,
          `**signatures:** ${sigs.length}  **hits:** ${hits.length}`,
          ``,
          ...hits.slice(0, 500).map(h => `- ${h.address} \`${h.name}\`${h.module ? ` (${h.module})` : ""} score=${h.score}`),
        ].join("\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `sig_match error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );

  server.tool(
    "sig_make",
    "Generate signatures from known function ranges in a binary (used to extend signatures/*.json).",
    {
      path: z.string(),
      funcs: z.array(z.object({ name: z.string(), offset: z.number(), length: z.number().min(16).max(1 << 20) })),
      prologLen: z.number().min(4).max(64).default(16),
      tailLen:   z.number().min(16).max(1024).default(128),
      module:    z.string().optional(),
      outputFile: z.string().optional().describe("relative name under signatures/ (writes next to the bundled sigs)"),
    },
    async ({ path, funcs, prologLen, tailLen, module, outputFile }) => {
      try {
        requirePathAllowed(path);
        const bin = await readFile(path);
        const sigs = await makeSignaturesFromRanges(bin, funcs, prologLen, tailLen);
        if (module) for (const s of sigs) s.module = module;
        if (outputFile) {
          const outRoot = join(root, SIG_DIR);
          await mkdir(outRoot, { recursive: true });
          const dest = join(outRoot, outputFile.endsWith(".json") ? outputFile : outputFile + ".json");
          requirePathAllowed(dest);
          await writeFile(dest, JSON.stringify(sigs, null, 2), "utf8");
        }
        return { content: [{ type: "text" as const, text: `# sig_make\n\nGenerated ${sigs.length} signatures${outputFile ? `, wrote to signatures/${outputFile}` : ""}.\n\n\`\`\`json\n${JSON.stringify(sigs, null, 2)}\n\`\`\`` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `sig_make error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );
}
