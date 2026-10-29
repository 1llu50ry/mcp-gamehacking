// ============================================================
// Native triage helpers — three complementary pure-TS scanners for
// quick malware / dropper / sideload triage.
//
//   shellcode_scan    — spot embedded x86 / x86-64 shellcode in
//                       arbitrary buffers (PE overlays, memory
//                       dumps, pcap payloads, ...). Heuristic:
//                       entropy > 7.0 window + prologue signatures
//                       + egg-hunter patterns + XOR-brute test
//                       (common single-byte keys 0x01..0xFF).
//
//   shellcode_decode  — try to decode an XOR-encoded buffer by
//                       brute-forcing the key against a Windows
//                       stub signature (eh find kernel32).
//
//   dllhijack_scan    — walk a PE's imports and flag DLLs whose
//                       absolute path falls into a user-writable
//                       directory (search-order hijack surface).
//
//   upx_detect        — check whether a PE / ELF is UPX-packed by
//                       looking for the "UPX!" sentinel in sections.
//
//   upx_unpack        — spawn `upx -d` if the user has it installed
//                       to produce an unpacked copy. Nothing is
//                       vendored.
// ============================================================

import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

// --- Shannon entropy over a sliding window ---
function entropy(buf: Uint8Array, start: number, len: number): number {
  const h = new Array<number>(256).fill(0);
  for (let i = 0; i < len; i++) h[buf[start + i]]++;
  let H = 0;
  for (let i = 0; i < 256; i++) {
    if (!h[i]) continue;
    const p = h[i] / len;
    H -= p * Math.log2(p);
  }
  return H;
}

// Prologue / egg-hunter patterns we treat as shellcode anchors.
const SC_PATTERNS: { re: RegExp; label: string }[] = [
  // Classic Windows egg-hunter (fs:[0x30] / fs:[0x60] / cs:[peb])
  { re: /\x64\xA1\x30\x00\x00\x00/g, label: "mov eax,fs:[0x30] (PEB fetch)" },
  { re: /\x65\x48\x8B\x04\x25\x60\x00\x00\x00/g, label: "mov rax,gs:[0x60] (PEB x64)" },
  // Resolve kernel32 via PEB -> LDR
  { re: /\x8B\x40\x0C/g, label: "mov eax,[eax+0x0C] (Ldr fetch)" },
  // call $+5 (position-independent trick) followed by `pop reg` (0x58..0x5F)
  { re: /\xE8\x00\x00\x00\x00[\x58-\x5F]/g, label: "call $+5; pop reg (position-independent)" },
  // XOR self-decrypt loop (any imm after mov [rax], then inc + loop)
  { re: /\x80\x30[\x00-\xff]\x40\xe2\xfa/g, label: "xor BYTE PTR [rax],imm; inc rax; loop (self-decrypt)" },
  // syscall / int 0x80 / sysenter
  { re: /\x0F\x05/g, label: "syscall (direct kernel entry)" },
  { re: /\xCD\x80/g, label: "int 0x80 (linux syscall)" },
  // Windows api hashing (xor eax eax; ror eax,0D)
  { re: /\x33\xC0.{0,8}\xC1\xC8\x0D/g, label: "xor eax,eax + ror eax,0D (API hashing)" },
];

export interface ShellcodeHit { category: "pattern" | "entropy" | "xor"; label: string; offset: string; evidence?: string; score?: number }

export function scanShellcode(buf: Uint8Array, opts: { minEntropy?: number; windowSize?: number } = {}): ShellcodeHit[] {
  const minEntropy = opts.minEntropy ?? 7.0;
  const win        = opts.windowSize ?? 256;
  const hits: ShellcodeHit[] = [];
  const b = Buffer.from(buf);
  const text = b.toString("binary");

  for (const { re, label } of SC_PATTERNS) {
    let m: RegExpExecArray | null; let n = 0;
    while ((m = re.exec(text)) && n < 20) { hits.push({ category: "pattern", label, offset: "0x" + m.index.toString(16) }); n++; }
  }

  // sliding entropy, step = win/4 so we don't miss short payloads
  for (let i = 0; i + win <= buf.length; i += Math.max(16, Math.floor(win / 4))) {
    const H = entropy(buf, i, win);
    if (H >= minEntropy) hits.push({ category: "entropy", label: `H=${H.toFixed(2)} over ${win}B`, offset: "0x" + i.toString(16), score: H });
  }

  // Collapse adjacent entropy hits into runs
  const runs: ShellcodeHit[] = [];
  let last: ShellcodeHit | null = null;
  for (const h of hits.sort((a, b) => parseInt(a.offset) - parseInt(b.offset))) {
    if (h.category !== "entropy") { runs.push(h); last = null; continue; }
    if (last && last.category === "entropy" && (parseInt(h.offset) - parseInt(last.offset)) <= win) {
      last.evidence = `continues to ${h.offset}`;
      continue;
    }
    runs.push(h); last = h;
  }
  return runs;
}

/** Try every single-byte XOR key and return the one that yields the most ASCII text. */
export function xorBruteDecode(buf: Uint8Array, needle: string = "This program cannot be run"): { key: number; score: number; preview: string } | null {
  const needleBytes = Buffer.from(needle, "utf8");
  let best: { key: number; score: number; preview: string } | null = null;
  for (let k = 1; k <= 0xFF; k++) {
    // Only decrypt the first 2 KiB to keep it fast; the stub either
    // signals in the first page or it doesn't.
    const slice = buf.subarray(0, Math.min(buf.length, 4096));
    const out = Buffer.allocUnsafe(slice.length);
    for (let i = 0; i < slice.length; i++) out[i] = slice[i] ^ k;
    let score = 0;
    // The exact-needle match has to dominate any accidental high-ASCII
    // scores that come from decoding ASCII with an arbitrary key.
    // 10_000 >> any plausible 4K-byte ASCII sweep.
    let needleHit = false;
    for (let i = 0; i < out.length - needleBytes.length; i++) {
      if (out[i] === needleBytes[0]) {
        let ok = true;
        for (let j = 0; j < needleBytes.length; j++) if (out[i + j] !== needleBytes[j]) { ok = false; break; }
        if (ok) { needleHit = true; break; }
      }
    }
    if (needleHit) score += 10_000;
    for (let i = 0; i < out.length; i++) if (out[i] >= 0x20 && out[i] < 0x7F) score++;
    if (!best || score > best.score) best = { key: k, score, preview: out.subarray(0, 64).toString("binary").replace(/[^\x20-\x7E]/g, ".") };
  }
  return best;
}

// --- DLL hijacking ---

// Writable-dir heuristic — on Windows, these spots are commonly
// user-writable (hence hijack-prone). We flag any import DLL that
// resolves to one of them in a classic search-order lookup.
const HIJACK_PATTERNS = [
  /\\Users\\[^\\]+\\AppData\\/i,
  /\\ProgramData\\/i,
  /\\Public\\/i,
  /\\Temp\\/i,
  /\\Documents\\/i,
];

export interface HijackHit { dll: string; path?: string; reason: string }

export function scanDllHijack(buf: Uint8Array): HijackHit[] {
  const hits: HijackHit[] = [];
  if (buf.length < 0x40 || buf[0] !== 0x4D || buf[1] !== 0x5A) return hits;
  const b = Buffer.from(buf);
  const peOff = b.readUInt32LE(0x3C);
  if (peOff + 24 >= b.length) return hits;

  // Scan the whole binary for \x00<dllname>.dll\x00 patterns, which
  // catches both import-table entries and delay-loaded / LoadLibrary
  // literals embedded in .rdata. Any match on a writable-dir pattern
  // is a hijack candidate.
  // Character class allows A-Z, a-z, 0-9, _, ., :, \, -, +, space —
  // enough to catch absolute Windows paths (`C:\Users\...\x.dll`) and
  // common unqualified names. Length 3..255 so empty / huge junk is
  // skipped.
  const re = /\x00([A-Za-z0-9_. :\\\-+]{3,255}\.dll)\x00/gi;
  const text = b.toString("binary");
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(text)) && hits.length < 500) {
    const name = m[1];
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    // Flag by two different criteria:
    //   1. absolute path lands in a writable dir  → high-confidence hijack
    //   2. unqualified name  → search-order hijack risk (depends on cwd)
    if (HIJACK_PATTERNS.some(p => p.test(name))) {
      hits.push({ dll: name, path: name, reason: "absolute path in user-writable directory" });
    } else if (!name.includes("\\")) {
      hits.push({ dll: name, reason: "unqualified name — subject to search-order resolution" });
    }
  }
  return hits;
}

// --- UPX detection + unpack ---

export function detectUpx(buf: Uint8Array): { packed: boolean; evidence: string[] } {
  const b = Buffer.from(buf);
  const text = b.toString("binary");
  const ev: string[] = [];
  if (text.includes("UPX!")) ev.push("UPX! sentinel");
  for (const s of ["UPX0", "UPX1", "UPX2", "UPX3", "$Info: This file is packed with the UPX executable packer"]) {
    if (text.includes(s)) ev.push(s);
  }
  return { packed: ev.length > 0, evidence: ev };
}

async function upxBin(): Promise<string> { return process.env.MCP_UPX_BIN ?? "upx"; }

async function upxDecompress(input: string, output: string): Promise<string> {
  const bin = await upxBin();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-d", "-o", output, input], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.stderr.on("data", (b: Buffer) => errChunks.push(b));
    child.on("error", (e) => reject(new Error(`spawn upx failed: ${e.message}. Install upx or set MCP_UPX_BIN.`)));
    child.on("close", (code) => {
      const all = Buffer.concat([...chunks, ...errChunks]).toString("utf8");
      if (code !== 0) return reject(new Error(`upx -d exited ${code}: ${all.slice(0, 400)}`));
      resolve(all);
    });
  });
}

export function registerNativeTriage(server: McpServer): void {
  server.tool(
    "shellcode_scan",
    "Spot embedded x86 / x86-64 shellcode in arbitrary buffers (PE overlays, mem dumps, pcap payloads). Returns prologue-signature matches + high-entropy windows + API-hashing patterns.",
    { path: z.string(), minEntropy: z.number().min(1).max(8).default(7.0), windowSize: z.number().min(64).max(4096).default(256), limit: z.number().min(1).max(10_000).default(300) },
    async ({ path, minEntropy, windowSize, limit }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const hits = scanShellcode(new Uint8Array(buf), { minEntropy, windowSize });
      const shown = hits.slice(0, limit);
      return { content: [{ type: "text" as const, text:
        `# shellcode_scan ${path}\n\n**hits:** ${hits.length}\n\n` +
        shown.map(h => `- **${h.category}** ${h.label} @ ${h.offset}${h.evidence ? ` _(${h.evidence})_` : ""}`).join("\n")
      }] };
    });

  server.tool(
    "shellcode_xor_decode",
    "Brute every 1-byte XOR key against a buffer and keep the one that produces the most ASCII (default signal: 'This program cannot be run' — PE MZ-stub text).",
    { path: z.string(), signal: z.string().default("This program cannot be run") },
    async ({ path, signal }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const r = xorBruteDecode(new Uint8Array(buf), signal);
      if (!r) return { content: [{ type: "text" as const, text: "# shellcode_xor_decode\n\nno viable key found" }] };
      return { content: [{ type: "text" as const, text:
        `# shellcode_xor_decode ${path}\n\n**key:** 0x${r.key.toString(16).padStart(2, "0")}  **score:** ${r.score}\n\n**preview:**\n\`\`\`\n${r.preview}\n\`\`\``
      }] };
    });

  server.tool(
    "dllhijack_scan",
    "Flag imports / LoadLibrary targets in a PE that resolve to user-writable paths (hijack surface).",
    { path: z.string(), limit: z.number().min(1).max(1000).default(200) },
    async ({ path, limit }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const hits = scanDllHijack(new Uint8Array(buf));
      const shown = hits.slice(0, limit);
      return { content: [{ type: "text" as const, text:
        `# dllhijack_scan ${path}\n\n**candidate DLLs:** ${hits.length}\n\n` +
        shown.map(h => `- \`${h.dll}\`${h.path ? ` @ \`${h.path}\`` : ""} — _${h.reason}_`).join("\n")
      }] };
    });

  server.tool(
    "upx_detect",
    "Check whether a PE / ELF carries the UPX! sentinel + UPX0/1/2 sections.",
    { path: z.string() },
    async ({ path }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const r = detectUpx(new Uint8Array(buf));
      return { content: [{ type: "text" as const, text:
        `# upx_detect ${path}\n\n**packed:** ${r.packed}\n**evidence:** ${r.evidence.join(", ") || "(none)"}`
      }] };
    });

  server.tool(
    "upx_unpack",
    "Run `upx -d` to produce an unpacked copy. User must have `upx` installed; override path via MCP_UPX_BIN. Writes to <input>.unpacked by default.",
    { path: z.string(), out: z.string().optional() },
    async ({ path, out }) => {
      requirePathAllowed(path);
      const dest = out ?? path + ".unpacked";
      requirePathAllowed(dest);
      const log = await upxDecompress(path, dest);
      const s = await stat(dest).catch(() => null);
      return { content: [{ type: "text" as const, text:
        `# upx_unpack\n\n**wrote:** \`${dest}\` (${s?.size ?? "?"} bytes)\n\n\`\`\`\n${log.slice(0, 4000)}\n\`\`\``
      }] };
    });
}
