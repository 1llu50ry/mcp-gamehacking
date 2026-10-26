// ============================================================
// Native TypeScript RE tools -- always available, no external deps.
//
// - pe_parse            PE/PE+ header + sections + imports + exports + overlay
// - aob_scan            IDA-style AoB signature scan over a file
// - entropy_scan        Shannon entropy per section + per window
// - string_extract      ASCII + UTF-16LE strings with min length
// - hash_identify       Scan .rdata-like regions for crypto constants
// - signature_make      Make a byte signature for a file+offset
// ============================================================

import { requirePathAllowed } from "./fs-sandbox.js";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ---------- helpers ----------

function u16le(b: Buffer, o: number) { return b.readUInt16LE(o); }
function u32le(b: Buffer, o: number) { return b.readUInt32LE(o); }
function u64le(b: Buffer, o: number): bigint { return b.readBigUInt64LE(o); }

function cstr(b: Buffer, o: number, max = 256): string {
  let end = o;
  while (end < b.length && end - o < max && b[end] !== 0) end++;
  return b.slice(o, end).toString("ascii");
}

function shannon(bytes: Buffer, start: number, len: number): number {
  const freq = new Uint32Array(256);
  const end = Math.min(start + len, bytes.length);
  const n = end - start;
  if (n <= 0) return 0;
  for (let i = start; i < end; i++) freq[bytes[i]]++;
  let H = 0;
  for (let i = 0; i < 256; i++) {
    if (!freq[i]) continue;
    const p = freq[i] / n;
    H -= p * Math.log2(p);
  }
  return H;
}

// ---------- PE parser (PE32 + PE32+) ----------

interface PeSection { name: string; vsize: number; va: number; rawSize: number; rawPtr: number; chars: number; entropy: number; }
interface PeImport { dll: string; names: string[]; }
interface PeExport { name: string; ordinal: number; rva: number; }

interface PeInfo {
  machine: string;
  bits: 32 | 64;
  timestamp: number;
  numberOfSections: number;
  entryPointRva: number;
  imageBase: bigint;
  sizeOfImage: number;
  subsystem: string;
  dllCharacteristics: string[];
  sections: PeSection[];
  imports: PeImport[];
  exports: { module: string; functions: PeExport[] };
  overlaySize: number;
  authenticode: { present: boolean; offset: number; size: number };
}

const MACHINE: Record<number, string> = {
  0x014c: "i386", 0x0200: "ia64", 0x8664: "amd64",
  0x01c0: "arm", 0xaa64: "arm64", 0x01c4: "armnt",
};

const SUBSYS: Record<number, string> = {
  1: "native", 2: "windows_gui", 3: "windows_cui", 5: "os2_cui",
  7: "posix_cui", 9: "windows_ce_gui", 10: "efi_application",
  11: "efi_boot_service_driver", 12: "efi_runtime_driver", 13: "efi_rom", 14: "xbox",
};

function dllCharsBits(c: number): string[] {
  const bits: [number, string][] = [
    [0x0020, "HIGH_ENTROPY_VA"], [0x0040, "DYNAMIC_BASE"], [0x0080, "FORCE_INTEGRITY"],
    [0x0100, "NX_COMPAT"], [0x0200, "NO_ISOLATION"], [0x0400, "NO_SEH"],
    [0x0800, "NO_BIND"], [0x1000, "APPCONTAINER"], [0x2000, "WDM_DRIVER"],
    [0x4000, "GUARD_CF"], [0x8000, "TERMINAL_SERVER_AWARE"],
  ];
  return bits.filter(([m]) => (c & m) !== 0).map(([, n]) => n);
}

function rvaToOff(sections: PeSection[], rva: number): number | null {
  for (const s of sections) {
    if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) {
      return s.rawPtr + (rva - s.va);
    }
  }
  return null;
}

function parsePe(buf: Buffer): PeInfo {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error("Not a PE (MZ header missing)");
  const peOff = u32le(buf, 0x3c);
  if (peOff + 24 > buf.length || u32le(buf, peOff) !== 0x00004550) throw new Error("Not a PE (PE\\0\\0 missing)");

  const coffOff = peOff + 4;
  const machine = u16le(buf, coffOff);
  const numSections = u16le(buf, coffOff + 2);
  const timestamp = u32le(buf, coffOff + 4);
  const sizeOfOptHdr = u16le(buf, coffOff + 16);
  const optOff = coffOff + 20;
  const magic = u16le(buf, optOff);
  const pePlus = magic === 0x20b;
  const bits: 32 | 64 = pePlus ? 64 : 32;

  const entryRva = u32le(buf, optOff + 16);
  const imageBase = pePlus ? u64le(buf, optOff + 24) : BigInt(u32le(buf, optOff + 28));
  const sizeOfImage = u32le(buf, optOff + (pePlus ? 56 : 56));
  const subsystem = u16le(buf, optOff + (pePlus ? 68 : 68));
  const dllChars = u16le(buf, optOff + (pePlus ? 70 : 70));

  // Data directories: 16 entries, start at optOff + (pePlus ? 112 : 96)
  const ddOff = optOff + (pePlus ? 112 : 96);
  const importDir = { rva: u32le(buf, ddOff + 8), size: u32le(buf, ddOff + 12) };
  const exportDir = { rva: u32le(buf, ddOff + 0), size: u32le(buf, ddOff + 4) };
  const securityDir = { offset: u32le(buf, ddOff + 32), size: u32le(buf, ddOff + 36) };

  const sectionsOff = optOff + sizeOfOptHdr;
  const sections: PeSection[] = [];
  for (let i = 0; i < numSections; i++) {
    const so = sectionsOff + i * 40;
    const name = cstr(buf, so, 8).replace(/\0.*$/, "");
    const vsize = u32le(buf, so + 8);
    const va = u32le(buf, so + 12);
    const rawSize = u32le(buf, so + 16);
    const rawPtr = u32le(buf, so + 20);
    const chars = u32le(buf, so + 36);
    const entropy = rawSize > 0 ? shannon(buf, rawPtr, rawSize) : 0;
    sections.push({ name, vsize, va, rawSize, rawPtr, chars, entropy });
  }

  // imports
  const imports: PeImport[] = [];
  if (importDir.rva) {
    const base = rvaToOff(sections, importDir.rva);
    if (base !== null) {
      for (let i = 0; ; i++) {
        const entry = base + i * 20;
        if (entry + 20 > buf.length) break;
        const nameRva = u32le(buf, entry + 12);
        const firstThunkRva = u32le(buf, entry + 16);
        const origFirstThunkRva = u32le(buf, entry + 0);
        if (nameRva === 0 && firstThunkRva === 0) break;
        const nameOff = rvaToOff(sections, nameRva);
        if (nameOff === null) break;
        const dll = cstr(buf, nameOff, 128);
        const names: string[] = [];
        const thunkRva = origFirstThunkRva || firstThunkRva;
        const thunkOff = rvaToOff(sections, thunkRva);
        if (thunkOff !== null) {
          const stride = pePlus ? 8 : 4;
          for (let j = 0; j < 2048; j++) {
            const tOff = thunkOff + j * stride;
            if (tOff + stride > buf.length) break;
            const t = pePlus ? u64le(buf, tOff) : BigInt(u32le(buf, tOff));
            if (t === 0n) break;
            const ordBit = pePlus ? 0x8000000000000000n : 0x80000000n;
            if ((t & ordBit) !== 0n) {
              names.push(`#${Number(t & 0xffffn)}`);
            } else {
              const hintNameOff = rvaToOff(sections, Number(t & 0xffffffffn));
              if (hintNameOff === null) break;
              names.push(cstr(buf, hintNameOff + 2, 128));
            }
          }
        }
        imports.push({ dll, names });
      }
    }
  }

  // exports
  const exportsOut: { module: string; functions: PeExport[] } = { module: "", functions: [] };
  if (exportDir.rva) {
    const base = rvaToOff(sections, exportDir.rva);
    if (base !== null) {
      const ordBase = u32le(buf, base + 16);
      const numFuncs = u32le(buf, base + 20);
      const numNames = u32le(buf, base + 24);
      const funcsOff = rvaToOff(sections, u32le(buf, base + 28));
      const namesOff = rvaToOff(sections, u32le(buf, base + 32));
      const nameOrdOff = rvaToOff(sections, u32le(buf, base + 36));
      const modNameOff = rvaToOff(sections, u32le(buf, base + 12));
      if (modNameOff !== null) exportsOut.module = cstr(buf, modNameOff, 128);
      if (funcsOff !== null && namesOff !== null && nameOrdOff !== null) {
        for (let i = 0; i < Math.min(numNames, 10000); i++) {
          const nameRva = u32le(buf, namesOff + i * 4);
          const ord = u16le(buf, nameOrdOff + i * 2);
          const funcRva = u32le(buf, funcsOff + ord * 4);
          const nOff = rvaToOff(sections, nameRva);
          const name = nOff !== null ? cstr(buf, nOff, 128) : `(unresolved)`;
          exportsOut.functions.push({ name, ordinal: ord + ordBase, rva: funcRva });
        }
      }
    }
  }

  // overlay: everything past max(section.rawPtr + section.rawSize)
  const peEnd = sections.reduce((m, s) => Math.max(m, s.rawPtr + s.rawSize), 0);
  const overlaySize = Math.max(0, buf.length - peEnd);

  return {
    machine: MACHINE[machine] ?? `0x${machine.toString(16)}`,
    bits,
    timestamp,
    numberOfSections: numSections,
    entryPointRva: entryRva,
    imageBase,
    sizeOfImage,
    subsystem: SUBSYS[subsystem] ?? `0x${subsystem.toString(16)}`,
    dllCharacteristics: dllCharsBits(dllChars),
    sections,
    imports,
    exports: exportsOut,
    overlaySize,
    authenticode: { present: securityDir.offset !== 0, offset: securityDir.offset, size: securityDir.size },
  };
}

// ---------- AoB / IDA pattern scan ----------

interface SigByte { any: boolean; value: number; }

function parsePattern(pattern: string): SigByte[] {
  // Accepts "48 8B ?? ?? ?? ?? ?? E8" or "48 8B ? ? ? ? ? E8" or "488B????????E8" (no spaces OK with ?? wildcard pairs).
  const tokens: SigByte[] = [];
  const normalized = pattern.trim().replace(/\s+/g, " ");
  const parts = normalized.includes(" ") ? normalized.split(" ") : chunkPairs(normalized);
  for (const p of parts) {
    if (p === "??" || p === "?" || p === "**" || p === "*") tokens.push({ any: true, value: 0 });
    else if (/^[0-9a-fA-F]{2}$/.test(p)) tokens.push({ any: false, value: parseInt(p, 16) });
    else if (/^[0-9a-fA-F]$/.test(p)) tokens.push({ any: false, value: parseInt(p, 16) });
    else throw new Error(`Invalid pattern token "${p}"`);
  }
  return tokens;
}
function chunkPairs(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(s.slice(i, i + 2));
  return out;
}

function scanPattern(buf: Buffer, sig: SigByte[], maxMatches = 32, startOff = 0): number[] {
  const matches: number[] = [];
  const n = buf.length;
  const m = sig.length;
  outer:
  for (let i = startOff; i + m <= n; i++) {
    for (let j = 0; j < m; j++) {
      const s = sig[j];
      if (!s.any && buf[i + j] !== s.value) continue outer;
    }
    matches.push(i);
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

// ---------- string extract ----------

function extractStrings(buf: Buffer, min: number, encoding: "ascii" | "utf16le" | "both"): { enc: string; offset: number; text: string }[] {
  const out: { enc: string; offset: number; text: string }[] = [];
  if (encoding === "ascii" || encoding === "both") {
    let start = -1;
    for (let i = 0; i <= buf.length; i++) {
      const b = i < buf.length ? buf[i] : -1;
      const printable = b >= 0x20 && b <= 0x7e;
      if (printable) { if (start < 0) start = i; }
      else {
        if (start >= 0 && i - start >= min) out.push({ enc: "ascii", offset: start, text: buf.slice(start, i).toString("ascii") });
        start = -1;
      }
    }
  }
  if (encoding === "utf16le" || encoding === "both") {
    let start = -1;
    for (let i = 0; i < buf.length - 1; i += 2) {
      const lo = buf[i], hi = buf[i + 1];
      const printable = hi === 0 && lo >= 0x20 && lo <= 0x7e;
      if (printable) { if (start < 0) start = i; }
      else {
        if (start >= 0 && (i - start) / 2 >= min) {
          out.push({ enc: "utf16le", offset: start, text: buf.slice(start, i).toString("utf16le") });
        }
        start = -1;
      }
    }
  }
  return out;
}

// ---------- hash / crypto constant identification ----------

const CRYPTO_CONSTS: { name: string; magic: number; descr: string }[] = [
  { name: "MD5",       magic: 0x67452301, descr: "MD5 initial hash state (A=0x67452301)" },
  { name: "SHA-1",     magic: 0xEFCDAB89, descr: "SHA-1 initial hash state (B=0xEFCDAB89 after A=0x67452301)" },
  { name: "SHA-256",   magic: 0x6A09E667, descr: "SHA-256 initial hash state (H0=0x6A09E667)" },
  { name: "SHA-512",   magic: 0x6A09E667, descr: "SHA-512 reuses 0x6A09E667F3BCC908 low word" },
  { name: "CRC-32",    magic: 0x77073096, descr: "CRC-32 reflected table entry [1]" },
  { name: "FNV-1a-32", magic: 0x811C9DC5, descr: "FNV-1a 32-bit offset basis" },
  { name: "ChaCha20",  magic: 0x61707865, descr: "ChaCha20 sigma 'expa' little-endian" },
  { name: "Blowfish",  magic: 0x243F6A88, descr: "Blowfish P-array (digits of pi)" },
  { name: "AES-RCon",  magic: 0x6363635D, descr: "AES Rijndael S-box constant (lane)" },
];

function identifyHashes(buf: Buffer): { name: string; offset: number; descr: string }[] {
  const out: { name: string; offset: number; descr: string }[] = [];
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    const v = buf.readUInt32LE(i);
    for (const c of CRYPTO_CONSTS) {
      if (v === c.magic) out.push({ name: c.name, offset: i, descr: c.descr });
    }
  }
  // Dedup consecutive same-type matches within 4 bytes
  return out.filter((h, i, a) => i === 0 || !(a[i - 1].name === h.name && h.offset - a[i - 1].offset < 4));
}

// ---------- make signature ----------

function makeSignature(buf: Buffer, offset: number, length: number, wildcardImmediates = true): { pattern: string; mask: string } {
  const bytes: string[] = [];
  const mask: string[] = [];
  for (let i = 0; i < length && offset + i < buf.length; i++) {
    const b = buf[offset + i];
    // Heuristic: wildcard displacement bytes in mov/call/jmp absolute: last 4 bytes of 5-byte opcodes
    if (wildcardImmediates && isLikelyImmediate(buf, offset, i, length)) {
      bytes.push("??");
      mask.push("?");
    } else {
      bytes.push(b.toString(16).padStart(2, "0").toUpperCase());
      mask.push("x");
    }
  }
  return { pattern: bytes.join(" "), mask: mask.join("") };
}

function isLikelyImmediate(buf: Buffer, start: number, i: number, _len: number): boolean {
  // Mark the 4 bytes following a 0xE8/0xE9/0xEB/0xFF 0x15/0xFF 0x25 as immediate
  const b0 = buf[start + i];
  if (i >= 1) {
    const prev = buf[start + i - 1];
    if ((prev === 0xe8 || prev === 0xe9) && i < 5) return i <= 4;
  }
  // Simplified heuristic: lots of 00s in a 4-byte run following an opcode
  return false;
  void b0;
}

// ---------- MCP registration ----------

export function registerNativeReTools(server: McpServer): void {
  server.tool(
    "pe_parse",
    "Parse a Windows PE (.exe/.dll/.sys) file. Returns machine, bits, timestamp, entry point, image base, section table (name/VA/VSize/raw/entropy), imports (DLL + names), exports (module + name/ordinal/RVA), overlay size, Authenticode info. Pure TypeScript, no external deps.",
    {
      path: z.string().describe("Absolute path to a PE file."),
      maxImports: z.number().min(1).max(2048).default(256),
      maxExports: z.number().min(1).max(10000).default(512),
      includeSectionEntropy: z.boolean().default(true),
    },
    async ({ path, maxImports, maxExports, includeSectionEntropy }: { path: string; maxImports: number; maxExports: number; includeSectionEntropy: boolean }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const info = parsePe(buf);
        const lines: string[] = [];
        lines.push(`# PE: ${path}`);
        lines.push(`- machine=${info.machine} bits=${info.bits}`);
        lines.push(`- timestamp=${new Date(info.timestamp * 1000).toISOString()}`);
        lines.push(`- entry point RVA=0x${info.entryPointRva.toString(16)}`);
        lines.push(`- image base=0x${info.imageBase.toString(16)}`);
        lines.push(`- sizeOfImage=0x${info.sizeOfImage.toString(16)}`);
        lines.push(`- subsystem=${info.subsystem}`);
        lines.push(`- dllCharacteristics=${info.dllCharacteristics.join("|") || "(none)"}`);
        lines.push(`- overlay=${info.overlaySize} bytes`);
        lines.push(`- authenticode=${info.authenticode.present ? `${info.authenticode.size} B @ 0x${info.authenticode.offset.toString(16)}` : "none"}`);
        lines.push(``, `## Sections (${info.sections.length})`);
        for (const s of info.sections) {
          const ent = includeSectionEntropy ? ` entropy=${s.entropy.toFixed(2)}` : "";
          lines.push(`- ${s.name.padEnd(10)} VA=0x${s.va.toString(16).padStart(8, "0")} VSz=0x${s.vsize.toString(16)} RawSz=0x${s.rawSize.toString(16)} chars=0x${s.chars.toString(16)}${ent}`);
        }
        lines.push(``, `## Imports (${info.imports.length} DLLs)`);
        let shownImports = 0;
        for (const im of info.imports) {
          lines.push(`### ${im.dll} (${im.names.length} funcs)`);
          lines.push(im.names.slice(0, 32).join(", "));
          shownImports += im.names.length;
          if (shownImports > maxImports) { lines.push(`...(truncated at ${maxImports})`); break; }
        }
        if (info.exports.functions.length) {
          lines.push(``, `## Exports from ${info.exports.module} (${info.exports.functions.length})`);
          for (const e of info.exports.functions.slice(0, maxExports)) {
            lines.push(`- #${e.ordinal} ${e.name} @ 0x${e.rva.toString(16)}`);
          }
          if (info.exports.functions.length > maxExports) lines.push(`...(truncated at ${maxExports})`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `pe_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "aob_scan",
    "Scan a binary file for an IDA-style AoB pattern (bytes separated by spaces, '??' or '?' as wildcard). Example: '48 8B ?? ?? ?? ?? ?? E8'. Returns up to maxMatches offsets.",
    {
      path: z.string().describe("Absolute path to the file."),
      pattern: z.string().describe("IDA-style pattern."),
      maxMatches: z.number().min(1).max(1000).default(32),
      startOffset: z.number().min(0).default(0),
    },
    async ({ path, pattern, maxMatches, startOffset }: { path: string; pattern: string; maxMatches: number; startOffset: number }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const sig = parsePattern(pattern);
        const hits = scanPattern(buf, sig, maxMatches, startOffset);
        const lines = [`# AoB scan: ${path}`, `pattern: ${pattern}`, `matches: ${hits.length}`, ``];
        for (const off of hits) {
          const preview = buf.slice(off, Math.min(off + sig.length, buf.length)).toString("hex").toUpperCase().match(/.{1,2}/g)?.join(" ") ?? "";
          lines.push(`- 0x${off.toString(16)}  ${preview}`);
        }
        if (!hits.length) lines.push("(no matches)");
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `aob_scan error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "entropy_scan",
    "Compute Shannon entropy over a file in sliding windows. High-entropy windows (>7.2) typically indicate packed / encrypted content. Returns per-window entropy summary.",
    {
      path: z.string(),
      windowSize: z.number().min(64).max(1 << 20).default(4096),
      step: z.number().min(1).max(1 << 20).default(4096),
      threshold: z.number().min(0).max(8).default(7.2),
    },
    async ({ path, windowSize, step, threshold }: { path: string; windowSize: number; step: number; threshold: number }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const highs: { offset: number; H: number }[] = [];
        let max = 0;
        let maxOff = 0;
        for (let off = 0; off < buf.length; off += step) {
          const H = shannon(buf, off, Math.min(windowSize, buf.length - off));
          if (H > max) { max = H; maxOff = off; }
          if (H >= threshold) highs.push({ offset: off, H });
        }
        const lines = [`# entropy_scan ${path}`, `size=${buf.length} window=${windowSize} step=${step}`, `max H=${max.toFixed(3)} @ 0x${maxOff.toString(16)}`, `windows >= ${threshold}: ${highs.length}`, ``];
        for (const h of highs.slice(0, 32)) lines.push(`- 0x${h.offset.toString(16)}  H=${h.H.toFixed(3)}`);
        if (highs.length > 32) lines.push(`...(+${highs.length - 32} more)`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `entropy_scan error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "string_extract",
    "Extract printable ASCII and/or UTF-16LE strings from a binary file (minimum length filter).",
    {
      path: z.string(),
      minLength: z.number().min(2).max(1024).default(6),
      encoding: z.enum(["ascii", "utf16le", "both"]).default("both"),
      maxStrings: z.number().min(1).max(100000).default(500),
    },
    async ({ path, minLength, encoding, maxStrings }: { path: string; minLength: number; encoding: "ascii" | "utf16le" | "both"; maxStrings: number }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const strings = extractStrings(buf, minLength, encoding);
        const lines = [`# string_extract ${path}`, `total: ${strings.length}`, ``];
        for (const s of strings.slice(0, maxStrings)) {
          lines.push(`- [${s.enc}] 0x${s.offset.toString(16)}  ${JSON.stringify(s.text)}`);
        }
        if (strings.length > maxStrings) lines.push(`...(+${strings.length - maxStrings} more)`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `string_extract error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "hash_identify",
    "Scan a file for well-known cryptographic initialization constants (MD5, SHA-1, SHA-256, CRC-32 table, FNV-1a, ChaCha20 sigma, Blowfish P-array, AES RCon). Returns likely algorithm presence with byte offsets.",
    {
      path: z.string(),
      max: z.number().min(1).max(1000).default(50),
    },
    async ({ path, max }: { path: string; max: number }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const hits = identifyHashes(buf);
        const grouped = new Map<string, number[]>();
        for (const h of hits) {
          if (!grouped.has(h.name)) grouped.set(h.name, []);
          grouped.get(h.name)!.push(h.offset);
        }
        const lines = [`# hash_identify ${path}`, `distinct algorithms found: ${grouped.size}`, ``];
        for (const [name, offs] of grouped) {
          const descr = CRYPTO_CONSTS.find((c) => c.name === name)?.descr ?? "";
          lines.push(`## ${name} (${offs.length} hit${offs.length === 1 ? "" : "s"})`);
          lines.push(descr);
          lines.push(offs.slice(0, max).map((o) => `0x${o.toString(16)}`).join(", "));
          lines.push(``);
        }
        if (!grouped.size) lines.push("(no known crypto constants matched)");
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `hash_identify error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "signature_make",
    "Make an IDA-style byte signature for a region of a file. Returns pattern + mask.",
    {
      path: z.string(),
      offset: z.number().min(0),
      length: z.number().min(1).max(1024).default(16),
      wildcardImmediates: z.boolean().default(true),
    },
    async ({ path, offset, length, wildcardImmediates }: { path: string; offset: number; length: number; wildcardImmediates: boolean }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        if (offset >= buf.length) return { content: [{ type: "text" as const, text: `offset 0x${offset.toString(16)} past EOF (${buf.length})` }], isError: true as const };
        const sig = makeSignature(buf, offset, Math.min(length, buf.length - offset), wildcardImmediates);
        // Validate uniqueness
        const tokens = parsePattern(sig.pattern);
        const hits = scanPattern(buf, tokens, 2);
        const unique = hits.length === 1;
        const lines = [
          `# signature_make ${path} @ 0x${offset.toString(16)} len=${length}`,
          `pattern: ${sig.pattern}`,
          `mask:    ${sig.mask}`,
          `uniqueness: ${unique ? "UNIQUE in file" : `${hits.length} matches -- not unique`}`,
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `signature_make error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "file_summary",
    "File metadata summary: size, SHA-256 (via native crypto), entropy histogram, first/last bytes, magic.",
    {
      path: z.string(),
    },
    async ({ path }: { path: string }) => {
      try {
        const [buf, st] = await Promise.all([readFile(path), stat(path)]);
        const { createHash } = await import("node:crypto");
        const sha = createHash("sha256").update(buf).digest("hex");
        const magic = buf.slice(0, 8).toString("hex").toUpperCase();
        const H = shannon(buf, 0, Math.min(buf.length, 1 << 20));
        const first = buf.slice(0, 32).toString("hex").match(/.{1,2}/g)!.join(" ");
        const last = buf.slice(Math.max(0, buf.length - 32)).toString("hex").match(/.{1,2}/g)!.join(" ");
        return {
          content: [{
            type: "text" as const,
            text: `# file_summary ${path}\nsize=${st.size}\nmtime=${st.mtime.toISOString()}\nsha256=${sha}\nmagic(8B)=${magic}\nShannon H (first 1MiB)=${H.toFixed(3)}\n\nfirst 32B: ${first}\nlast 32B:  ${last}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `file_summary error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );
}

// Exposed for tests
export { parsePe, parsePattern, scanPattern, shannon, extractStrings, identifyHashes, makeSignature };
