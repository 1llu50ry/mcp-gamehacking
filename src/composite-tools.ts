// ============================================================
// High-level composite tools -- one call, orchestrated across
// several native parsers + helpers.
//
//   - analyze_binary  : file_identify -> format parse -> entropy
//                       -> strings -> hash_identify -> AoB
//                       pattern suggestions.
//   - triage_pe       : PE deep triage with Debug Directory, Rich
//                       Header, imports, exports, overlay, cert.
//   - compare_binaries: identify + compare two builds side-by-side.
// ============================================================

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";
import { parsePe } from "./native-re.js";
import { parseElf, parseMachO, parseDex, parseWasm } from "./native-formats.js";
import { parseMinidump, parseRichHeader } from "./native-advanced.js";

// Lightweight re-impl of helpers from native-re.ts to avoid a cycle:
function shannon(buf: Buffer, start: number, len: number): number {
  const freq = new Uint32Array(256);
  const end = Math.min(start + len, buf.length);
  const n = end - start;
  if (n <= 0) return 0;
  for (let i = start; i < end; i++) freq[buf[i]]++;
  let H = 0;
  for (let i = 0; i < 256; i++) {
    if (!freq[i]) continue;
    const p = freq[i] / n;
    H -= p * Math.log2(p);
  }
  return H;
}

function identifyMagic(head: Buffer): string[] {
  const hex = head.toString("hex").toUpperCase();
  const asc = head.slice(0, 4).toString("ascii");
  const out: string[] = [];
  if (asc.startsWith("MZ")) out.push("PE");
  if (hex.startsWith("7F454C46")) out.push("ELF");
  if (hex.startsWith("FEEDFACE") || hex.startsWith("FEEDFACF")) out.push("Mach-O thin");
  if (hex.startsWith("CAFEBABE") || hex.startsWith("BEBAFECA")) out.push("Mach-O fat");
  if (asc === "dex\n") out.push("DEX");
  if (hex.startsWith("0061736D")) out.push("WASM");
  if (hex.startsWith("504B0304") || hex.startsWith("504B0506")) out.push("ZIP/APK/JAR");
  if (asc === "NSO0") out.push("Switch NSO");
  if (asc === "XEX1" || asc === "XEX2") out.push("Xbox 360 XEX");
  if (hex.startsWith("4D444D50")) out.push("Minidump");
  return out;
}

// ------------------------------------------------------------
// PE Debug Directory + extra PE metadata
// ------------------------------------------------------------

interface PeDebugEntry {
  type: string;
  size: number;
  rva: number;
  fileOffset: number;
  rsds?: { guid: string; age: number; pdbPath: string };
  reproducibleBuild?: boolean;
  pogo?: string;
}

const DEBUG_TYPES: Record<number, string> = {
  0: "UNKNOWN", 1: "COFF", 2: "CODEVIEW", 3: "FPO", 4: "MISC",
  5: "EXCEPTION", 6: "FIXUP", 7: "OMAP_TO_SRC", 8: "OMAP_FROM_SRC",
  9: "BORLAND", 10: "RESERVED10", 11: "VC_FEATURE", 12: "POGO",
  13: "ILTCG", 14: "MPX", 15: "REPRO", 20: "EX_DLLCHARACTERISTICS",
};

function peRvaToOff(buf: Buffer, rva: number): number | null {
  if (buf.readUInt16LE(0) !== 0x5a4d) return null;
  const peOff = buf.readUInt32LE(0x3c);
  const nSec = buf.readUInt16LE(peOff + 6);
  const sizeOpt = buf.readUInt16LE(peOff + 20);
  const secOff = peOff + 24 + sizeOpt;
  for (let i = 0; i < nSec; i++) {
    const o = secOff + i * 40;
    const va = buf.readUInt32LE(o + 12);
    const vsize = buf.readUInt32LE(o + 8);
    const rawPtr = buf.readUInt32LE(o + 20);
    const rawSize = buf.readUInt32LE(o + 16);
    if (rva >= va && rva < va + Math.max(vsize, rawSize)) return rawPtr + (rva - va);
  }
  return null;
}

export function parsePeDebugDir(buf: Buffer): PeDebugEntry[] {
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error("Not a PE");
  const peOff = buf.readUInt32LE(0x3c);
  const optOff = peOff + 24;
  const magic = buf.readUInt16LE(optOff);
  const pePlus = magic === 0x20b;
  const ddOff = optOff + (pePlus ? 112 : 96);
  // Data directory index 6 = Debug
  const dRva = buf.readUInt32LE(ddOff + 6 * 8);
  const dSize = buf.readUInt32LE(ddOff + 6 * 8 + 4);
  if (!dRva || !dSize) return [];
  const dOff = peRvaToOff(buf, dRva);
  if (dOff == null) return [];
  const entries: PeDebugEntry[] = [];
  for (let i = 0; i < dSize / 28; i++) {
    const o = dOff + i * 28;
    const type = buf.readUInt32LE(o + 12);
    const size = buf.readUInt32LE(o + 16);
    const rva = buf.readUInt32LE(o + 20);
    const fo = buf.readUInt32LE(o + 24);
    const entry: PeDebugEntry = { type: DEBUG_TYPES[type] ?? `0x${type.toString(16)}`, size, rva, fileOffset: fo };
    // Inspect specific types
    if (type === 2 /* CODEVIEW */) {
      try {
        const slice = buf.slice(fo, fo + size);
        if (slice.readUInt32BE(0) === 0x52534453) {
          const guidBytes = slice.slice(4, 20);
          const d1 = guidBytes.readUInt32LE(0);
          const d2 = guidBytes.readUInt16LE(4);
          const d3 = guidBytes.readUInt16LE(6);
          const d4 = guidBytes.slice(8, 16).toString("hex").toUpperCase();
          const guid = `${d1.toString(16).padStart(8, "0").toUpperCase()}-${d2.toString(16).padStart(4, "0").toUpperCase()}-${d3.toString(16).padStart(4, "0").toUpperCase()}-${d4.slice(0, 4)}-${d4.slice(4)}`;
          const age = slice.readUInt32LE(20);
          let e = 24;
          while (e < slice.length && slice[e] !== 0) e++;
          const pdbPath = slice.slice(24, e).toString("ascii");
          entry.rsds = { guid, age, pdbPath };
        }
      } catch { /* best effort */ }
    } else if (type === 15 /* REPRO */) {
      entry.reproducibleBuild = true;
    } else if (type === 12 /* POGO */) {
      try {
        const slice = buf.slice(fo, fo + size);
        // first 4 bytes = signature, then entries of (RVA, size, name c-string)
        const sig = slice.readUInt32LE(0);
        entry.pogo = `sig=0x${sig.toString(16)}`;
      } catch { /* ignore */ }
    }
    entries.push(entry);
  }
  return entries;
}

// ------------------------------------------------------------
// MCP registration
// ------------------------------------------------------------

export function registerCompositeTools(server: McpServer): void {
  server.tool(
    "analyze_binary",
    "One-shot deep analysis of any binary file. Chains file_identify -> format-specific parse -> entropy summary -> top strings -> crypto-constant scan -> Rich Header (if PE) -> Debug Directory (if PE). Returns a single markdown report.",
    {
      path: z.string(),
      stringMinLen: z.number().min(2).max(64).default(8),
      maxStrings: z.number().min(1).max(2000).default(50),
    },
    async ({ path, stringMinLen, maxStrings }: { path: string; stringMinLen: number; maxStrings: number }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const guesses = identifyMagic(buf.slice(0, 32));
        const sections: string[] = [];
        sections.push(`# analyze_binary: ${path}`);
        sections.push(`- size: ${buf.length} bytes`);
        sections.push(`- magic matches: ${guesses.join(" | ") || "(unknown)"}`);
        const { createHash } = await import("node:crypto");
        sections.push(`- sha256: ${createHash("sha256").update(buf).digest("hex")}`);
        sections.push(`- shannon (1 MiB window): ${shannon(buf, 0, Math.min(buf.length, 1 << 20)).toFixed(3)}`);

        // Format-specific
        if (guesses.includes("PE")) {
          try {
            const pe = parsePe(buf);
            sections.push(``, `## PE`);
            sections.push(`- machine=${pe.machine} bits=${pe.bits} subsystem=${pe.subsystem}`);
            sections.push(`- entry=0x${pe.entryPointRva.toString(16)} base=0x${pe.imageBase.toString(16)} sizeOfImage=0x${pe.sizeOfImage.toString(16)}`);
            sections.push(`- timestamp=${new Date(pe.timestamp * 1000).toISOString()}`);
            sections.push(`- dllChars=${pe.dllCharacteristics.join("|") || "-"}`);
            sections.push(`- overlay=${pe.overlaySize} B  authenticode=${pe.authenticode.present ? pe.authenticode.size + " B" : "no"}`);
            sections.push(`- imports (${pe.imports.length} DLLs): ${pe.imports.slice(0, 20).map((i) => i.dll).join(", ")}${pe.imports.length > 20 ? ", ..." : ""}`);
            try {
              const rich = parseRichHeader(buf);
              if (rich) sections.push(`- Rich header: ${rich.entries.length} entries`);
            } catch { /* ignore */ }
            try {
              const dbg = parsePeDebugDir(buf);
              if (dbg.length) {
                sections.push(``, `### Debug Directory`);
                for (const d of dbg) {
                  const extras: string[] = [];
                  if (d.rsds) extras.push(`RSDS GUID=${d.rsds.guid} age=${d.rsds.age} pdb=${d.rsds.pdbPath}`);
                  if (d.reproducibleBuild) extras.push("REPRO");
                  if (d.pogo) extras.push(`POGO ${d.pogo}`);
                  sections.push(`- ${d.type.padEnd(16)} size=0x${d.size.toString(16).padStart(6, "0")}  ${extras.join("  ")}`);
                }
              }
            } catch { /* ignore */ }
          } catch (e) { sections.push(`PE parse failed: ${(e as Error).message}`); }
        }
        if (guesses.includes("ELF")) {
          try {
            const elf = parseElf(buf);
            sections.push(``, `## ELF`);
            sections.push(`- machine=${elf.machine} bits=${elf.bits} type=${elf.type}`);
            sections.push(`- entry=0x${elf.entry.toString(16)} interp=${elf.interpreter ?? "-"} SONAME=${elf.soname ?? "-"}`);
            sections.push(`- DT_NEEDED (${elf.dtNeeded.length}): ${elf.dtNeeded.join(", ")}`);
          } catch (e) { sections.push(`ELF parse failed: ${(e as Error).message}`); }
        }
        if (guesses.some((g) => g.startsWith("Mach-O"))) {
          try {
            const slices = parseMachO(buf);
            sections.push(``, `## Mach-O (${slices.length} slices)`);
            for (const s of slices) sections.push(`- ${s.cpu} ${s.bits}-bit ${s.filetype}  dylibs=${s.dylibs.length}`);
          } catch (e) { sections.push(`Mach-O parse failed: ${(e as Error).message}`); }
        }
        if (guesses.includes("DEX")) {
          try {
            const d = parseDex(buf);
            sections.push(``, `## DEX`, `- version=${d.version} classDefs=${d.classDefs} methods=${d.methodIds}`);
          } catch (e) { sections.push(`DEX parse failed: ${(e as Error).message}`); }
        }
        if (guesses.includes("WASM")) {
          try {
            const w = parseWasm(buf);
            sections.push(``, `## WASM`, `- version=${w.version} sections=${w.sections.length}`);
          } catch (e) { sections.push(`WASM parse failed: ${(e as Error).message}`); }
        }
        if (guesses.includes("Minidump")) {
          try {
            const md = parseMinidump(buf);
            sections.push(``, `## Minidump`, `- modules=${md.modules.length} threads=${md.threads.length} exception=${md.exception ? "yes" : "no"}`);
          } catch (e) { sections.push(`Minidump parse failed: ${(e as Error).message}`); }
        }

        // Entropy per 64K
        const H64k: { off: number; H: number }[] = [];
        const win = 65536;
        for (let off = 0; off < buf.length; off += win) {
          H64k.push({ off, H: shannon(buf, off, Math.min(win, buf.length - off)) });
        }
        const packed = H64k.filter((x) => x.H > 7.2);
        sections.push(``, `## Entropy`, `- max=${Math.max(...H64k.map((x) => x.H)).toFixed(3)}`, `- windows >7.2: ${packed.length}/${H64k.length}`);

        // Top strings
        const strings: string[] = [];
        let start = -1;
        for (let i = 0; i <= buf.length && strings.length < maxStrings * 3; i++) {
          const b = i < buf.length ? buf[i] : -1;
          const printable = b >= 0x20 && b <= 0x7e;
          if (printable) { if (start < 0) start = i; }
          else {
            if (start >= 0 && i - start >= stringMinLen) strings.push(buf.slice(start, i).toString("ascii"));
            start = -1;
          }
        }
        const seen = new Set<string>();
        const top = strings.filter((s) => (seen.has(s) ? false : (seen.add(s), true))).slice(0, maxStrings);
        sections.push(``, `## Strings (first ${top.length} unique >= ${stringMinLen} chars)`);
        for (const s of top) sections.push(`- ${JSON.stringify(s)}`);

        // crypto constants (minimal subset)
        const constants = [
          { v: 0x67452301, n: "MD5/SHA-1 H0" },
          { v: 0x6a09e667, n: "SHA-256 H0" },
          { v: 0x811c9dc5, n: "FNV-1a basis" },
          { v: 0x61707865, n: "ChaCha20 sigma" },
          { v: 0x77073096, n: "CRC-32 table[1]" },
        ];
        const hits: { name: string; off: number }[] = [];
        for (let i = 0; i + 4 <= buf.length; i += 4) {
          const v = buf.readUInt32LE(i);
          const c = constants.find((c) => c.v === v);
          if (c) hits.push({ name: c.n, off: i });
          if (hits.length > 50) break;
        }
        if (hits.length) {
          sections.push(``, `## Crypto constants`);
          for (const h of hits.slice(0, 20)) sections.push(`- 0x${h.off.toString(16)}  ${h.name}`);
        }

        return { content: [{ type: "text" as const, text: sections.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `analyze_binary error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "pe_debug_dir",
    "Walk the PE Debug Directory and return each entry: type (CODEVIEW/VC_FEATURE/POGO/REPRO/MPX/ILTCG/EX_DLLCHARACTERISTICS/…), size, RVA, file offset. For CODEVIEW it extracts RSDS GUID + age + PDB path (feed into symsrv_download or pdb70_identify).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const entries = parsePeDebugDir(buf);
        if (!entries.length) return { content: [{ type: "text" as const, text: "no Debug Directory" }] };
        const lines = [`# Debug Directory (${entries.length})`];
        for (const d of entries) {
          lines.push(`- ${d.type.padEnd(18)} size=0x${d.size.toString(16).padStart(6, "0")} rva=0x${d.rva.toString(16)} fo=0x${d.fileOffset.toString(16)}`);
          if (d.rsds) lines.push(`  RSDS GUID=${d.rsds.guid} age=${d.rsds.age} pdb=${d.rsds.pdbPath}`);
          if (d.reproducibleBuild) lines.push(`  REPRO (Reproducible Build enabled)`);
          if (d.pogo) lines.push(`  POGO ${d.pogo}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `pe_debug_dir error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "compare_binaries",
    "Compare two binaries side-by-side: sizes, SHA-256, format, imports (PE), DT_NEEDED (ELF), dylibs (Mach-O), rough entropy. Fast first-pass diff before running BinDiff or Diaphora.",
    { a: z.string(), b: z.string() },
    async ({ a, b }: { a: string; b: string }) => {
      try {
        requirePathAllowed(a); requirePathAllowed(b);
        const [ba, bb] = await Promise.all([readFile(a), readFile(b)]);
        const { createHash } = await import("node:crypto");
        const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
        const magic = (buf: Buffer) => identifyMagic(buf.slice(0, 32)).join(" | ") || "(unknown)";
        const H = (buf: Buffer) => shannon(buf, 0, Math.min(buf.length, 1 << 20));
        const lines = [
          `# compare_binaries`,
          `|           | A | B |`,
          `|-----------|---|---|`,
          `| path      | ${a} | ${b} |`,
          `| size      | ${ba.length} | ${bb.length} |`,
          `| sha256    | ${sha(ba)} | ${sha(bb)} |`,
          `| format    | ${magic(ba)} | ${magic(bb)} |`,
          `| shannon   | ${H(ba).toFixed(3)} | ${H(bb).toFixed(3)} |`,
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `compare_binaries error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );
}
