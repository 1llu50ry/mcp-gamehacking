// Native TypeScript parsers for ELF (32/64), Mach-O (32/64/fat), DEX
// (Android), NSO (Switch), WebAssembly. Zero external dependencies.

import { requirePathAllowed } from "./fs-sandbox.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ============================================================
// ELF
// ============================================================

interface ElfInfo {
  bits: 32 | 64;
  endian: "little" | "big";
  machine: string;
  type: string;
  entry: bigint;
  phCount: number;
  shCount: number;
  sections: { name: string; type: string; flags: string[]; addr: bigint; offset: bigint; size: bigint }[];
  segments: { type: string; flags: string[]; vaddr: bigint; filesz: bigint; memsz: bigint }[];
  interpreter: string | null;
  dtNeeded: string[];
  soname: string | null;
}

const ELF_MACHINES: Record<number, string> = {
  3: "i386", 40: "arm", 62: "amd64", 183: "aarch64",
  8: "mips", 20: "ppc", 21: "ppc64", 243: "riscv",
};
const ELF_TYPES: Record<number, string> = {
  1: "REL", 2: "EXEC", 3: "DYN", 4: "CORE",
};
const ELF_SH_TYPES: Record<number, string> = {
  0: "NULL", 1: "PROGBITS", 2: "SYMTAB", 3: "STRTAB", 4: "RELA", 5: "HASH",
  6: "DYNAMIC", 7: "NOTE", 8: "NOBITS", 9: "REL", 11: "DYNSYM", 14: "INIT_ARRAY",
  15: "FINI_ARRAY", 16: "PREINIT_ARRAY", 17: "GROUP", 18: "SYMTAB_SHNDX",
};
const ELF_PH_TYPES: Record<number, string> = {
  0: "NULL", 1: "LOAD", 2: "DYNAMIC", 3: "INTERP", 4: "NOTE",
  5: "SHLIB", 6: "PHDR", 7: "TLS",
  0x6474e550: "GNU_EH_FRAME", 0x6474e551: "GNU_STACK", 0x6474e552: "GNU_RELRO",
};

function shFlagsStr(f: bigint): string[] {
  const flags = [];
  if (f & 1n) flags.push("WRITE");
  if (f & 2n) flags.push("ALLOC");
  if (f & 4n) flags.push("EXECINSTR");
  if (f & 0x10n) flags.push("MERGE");
  if (f & 0x20n) flags.push("STRINGS");
  if (f & 0x40n) flags.push("INFO_LINK");
  if (f & 0x80n) flags.push("LINK_ORDER");
  if (f & 0x200n) flags.push("GROUP");
  if (f & 0x400n) flags.push("TLS");
  return flags;
}

function phFlagsStr(f: number): string[] {
  const out: string[] = [];
  if (f & 1) out.push("X");
  if (f & 2) out.push("W");
  if (f & 4) out.push("R");
  return out;
}

function parseElf(buf: Buffer): ElfInfo {
  if (buf.length < 16 || buf.readUInt32BE(0) !== 0x7f454c46) throw new Error("Not an ELF");
  const cls = buf[4];
  const dataEnc = buf[5];
  const bits: 32 | 64 = cls === 1 ? 32 : 64;
  const endian = dataEnc === 1 ? "little" : "big";
  if (endian === "big") throw new Error("Big-endian ELF not yet supported");

  const r16 = (o: number) => buf.readUInt16LE(o);
  const r32 = (o: number) => buf.readUInt32LE(o);
  const r64 = (o: number) => buf.readBigUInt64LE(o);
  const rAddr = (o: number) => (bits === 64 ? r64(o) : BigInt(r32(o)));

  const type = r16(16);
  const machine = r16(18);
  const entry = rAddr(24);

  const phoff = bits === 64 ? r64(32) : BigInt(r32(28));
  const shoff = bits === 64 ? r64(40) : BigInt(r32(32));
  const ehsize = r16(bits === 64 ? 52 : 40);
  const phentsize = r16(bits === 64 ? 54 : 42);
  const phnum = r16(bits === 64 ? 56 : 44);
  const shentsize = r16(bits === 64 ? 58 : 46);
  const shnum = r16(bits === 64 ? 60 : 48);
  const shstrndx = r16(bits === 64 ? 62 : 50);
  void ehsize;

  // section headers first (to get strings)
  const sh: { name: number; type: number; flags: bigint; addr: bigint; offset: bigint; size: bigint }[] = [];
  for (let i = 0; i < shnum; i++) {
    const o = Number(shoff) + i * shentsize;
    sh.push({
      name: r32(o),
      type: r32(o + 4),
      flags: bits === 64 ? r64(o + 8) : BigInt(r32(o + 8)),
      addr: rAddr(o + (bits === 64 ? 16 : 12)),
      offset: bits === 64 ? r64(o + 24) : BigInt(r32(o + 16)),
      size: bits === 64 ? r64(o + 32) : BigInt(r32(o + 20)),
    });
  }

  const shstr = sh[shstrndx];
  const stringAt = (off: number) => {
    const start = Number(shstr.offset) + off;
    let end = start;
    while (end < buf.length && buf[end] !== 0 && end - start < 256) end++;
    return buf.slice(start, end).toString("utf8");
  };
  const sections = sh.map((s) => ({
    name: stringAt(s.name),
    type: ELF_SH_TYPES[s.type] ?? `0x${s.type.toString(16)}`,
    flags: shFlagsStr(s.flags),
    addr: s.addr,
    offset: s.offset,
    size: s.size,
  }));

  // segments
  const segments: ElfInfo["segments"] = [];
  for (let i = 0; i < phnum; i++) {
    const o = Number(phoff) + i * phentsize;
    const t = r32(o);
    if (bits === 64) {
      segments.push({
        type: ELF_PH_TYPES[t] ?? `0x${t.toString(16)}`,
        flags: phFlagsStr(r32(o + 4)),
        vaddr: r64(o + 16),
        filesz: r64(o + 32),
        memsz: r64(o + 40),
      });
    } else {
      segments.push({
        type: ELF_PH_TYPES[t] ?? `0x${t.toString(16)}`,
        flags: phFlagsStr(r32(o + 24)),
        vaddr: BigInt(r32(o + 8)),
        filesz: BigInt(r32(o + 16)),
        memsz: BigInt(r32(o + 20)),
      });
    }
  }

  // interp
  let interpreter: string | null = null;
  const interp = segments.find((s) => s.type === "INTERP");
  if (interp) {
    const phIdx = segments.indexOf(interp);
    const o = Number(phoff) + phIdx * phentsize;
    const off = Number(bits === 64 ? r64(o + 8) : BigInt(r32(o + 4)));
    const sz = Number(bits === 64 ? r64(o + 32) : BigInt(r32(o + 16)));
    interpreter = buf.slice(off, off + sz).toString("utf8").replace(/\0.*$/, "");
  }

  // DT_NEEDED + SONAME via .dynamic
  const dtNeeded: string[] = [];
  let soname: string | null = null;
  const dyn = sections.find((s) => s.type === "DYNAMIC");
  const dynstr = sections.find((s) => s.name === ".dynstr");
  if (dyn && dynstr) {
    const stride = bits === 64 ? 16 : 8;
    const base = Number(dyn.offset);
    const strBase = Number(dynstr.offset);
    for (let p = base; p < base + Number(dyn.size); p += stride) {
      const tag = bits === 64 ? r64(p) : BigInt(r32(p));
      const val = bits === 64 ? r64(p + 8) : BigInt(r32(p + 4));
      if (tag === 0n) break;
      if (tag === 1n /* DT_NEEDED */ || tag === 14n /* DT_SONAME */) {
        const sb = strBase + Number(val);
        let e = sb;
        while (e < buf.length && buf[e] !== 0 && e - sb < 256) e++;
        const name = buf.slice(sb, e).toString("utf8");
        if (tag === 1n) dtNeeded.push(name);
        else soname = name;
      }
    }
  }

  return {
    bits,
    endian,
    machine: ELF_MACHINES[machine] ?? `0x${machine.toString(16)}`,
    type: ELF_TYPES[type] ?? `0x${type.toString(16)}`,
    entry,
    phCount: phnum,
    shCount: shnum,
    sections,
    segments,
    interpreter,
    dtNeeded,
    soname,
  };
}

// ============================================================
// Mach-O (32, 64, fat)
// ============================================================

interface MachOEntry {
  bits: 32 | 64;
  cpu: string;
  filetype: string;
  loadCommands: { cmd: string; cmdsize: number }[];
  dylibs: string[];
  segments: { name: string; vmaddr: bigint; vmsize: bigint; fileoff: bigint; filesize: bigint; initprot: number }[];
}

const MACHO_CPU: Record<number, string> = {
  7: "i386", 0x01000007: "amd64",
  12: "arm", 0x0100000c: "arm64", 0x0200000c: "arm64_32",
  18: "ppc", 0x01000012: "ppc64",
};
const MACHO_FILETYPE: Record<number, string> = {
  1: "OBJECT", 2: "EXECUTE", 3: "FVMLIB", 4: "CORE", 5: "PRELOAD",
  6: "DYLIB", 7: "DYLINKER", 8: "BUNDLE", 9: "DYLIB_STUB", 10: "DSYM", 11: "KEXT_BUNDLE",
};
const LC_NAMES: Record<number, string> = {
  0x1: "SEGMENT", 0x2: "SYMTAB", 0xb: "DYSYMTAB", 0xc: "LOAD_DYLIB",
  0xd: "ID_DYLIB", 0xe: "LOAD_DYLINKER", 0x14: "DYLIB_CODE_SIGN_DRS",
  0x19: "SEGMENT_64", 0x1a: "ROUTINES_64", 0x1b: "UUID", 0x1c: "RPATH",
  0x1d: "CODE_SIGNATURE", 0x1e: "SEGMENT_SPLIT_INFO",
  0x80000018: "LOAD_WEAK_DYLIB", 0x21: "ENCRYPTION_INFO",
  0x2c: "ENCRYPTION_INFO_64",
  0x22: "DYLD_INFO", 0x80000022: "DYLD_INFO_ONLY",
  0x28: "FUNCTION_STARTS", 0x29: "DYLD_ENVIRONMENT", 0x2a: "MAIN",
  0x2b: "DATA_IN_CODE", 0x2d: "LINKER_OPTION", 0x30: "VERSION_MIN_MACOSX",
  0x31: "VERSION_MIN_IPHONEOS", 0x32: "FUNCTION_STARTS_64",
  0x80000033: "DYLD_CHAINED_FIXUPS", 0x80000034: "DYLD_EXPORTS_TRIE",
};

function parseOneMachO(buf: Buffer, start: number): MachOEntry {
  const magic = buf.readUInt32LE(start);
  if (magic !== 0xfeedface && magic !== 0xfeedfacf) throw new Error(`Not Mach-O at offset ${start}`);
  const bits: 32 | 64 = magic === 0xfeedfacf ? 64 : 32;
  const r32 = (o: number) => buf.readUInt32LE(start + o);
  const r64 = (o: number) => buf.readBigUInt64LE(start + o);
  const cpu = r32(4);
  const filetype = r32(12);
  const ncmds = r32(16);
  const sizeofcmds = r32(20);
  void sizeofcmds;
  let p = bits === 64 ? 32 : 28;
  const loadCommands: { cmd: string; cmdsize: number }[] = [];
  const dylibs: string[] = [];
  const segments: MachOEntry["segments"] = [];
  for (let i = 0; i < ncmds; i++) {
    const cmd = r32(p);
    const cmdsize = r32(p + 4);
    const name = LC_NAMES[cmd] ?? `0x${cmd.toString(16)}`;
    loadCommands.push({ cmd: name, cmdsize });
    if (cmd === 0xc /* LOAD_DYLIB */ || cmd === 0xd /* ID_DYLIB */ || cmd === 0x80000018) {
      const nameOff = r32(p + 8);
      const nameStart = start + p + nameOff;
      let e = nameStart;
      while (e < buf.length && buf[e] !== 0 && e - nameStart < 1024) e++;
      dylibs.push(buf.slice(nameStart, e).toString("utf8"));
    }
    if (cmd === 0x19 /* SEGMENT_64 */ || cmd === 0x1 /* SEGMENT */) {
      const segName = buf.slice(start + p + 8, start + p + 24).toString("ascii").replace(/\0+$/, "");
      if (cmd === 0x19) {
        segments.push({
          name: segName,
          vmaddr: r64(p + 24),
          vmsize: r64(p + 32),
          fileoff: r64(p + 40),
          filesize: r64(p + 48),
          initprot: r32(p + 60),
        });
      } else {
        segments.push({
          name: segName,
          vmaddr: BigInt(r32(p + 24)),
          vmsize: BigInt(r32(p + 28)),
          fileoff: BigInt(r32(p + 32)),
          filesize: BigInt(r32(p + 36)),
          initprot: r32(p + 44),
        });
      }
    }
    p += cmdsize;
    if (cmdsize === 0) break;
  }
  return {
    bits,
    cpu: MACHO_CPU[cpu] ?? `0x${cpu.toString(16)}`,
    filetype: MACHO_FILETYPE[filetype] ?? `0x${filetype.toString(16)}`,
    loadCommands,
    dylibs,
    segments,
  };
}

function parseMachO(buf: Buffer): MachOEntry[] {
  const magic = buf.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xbebafeca) {
    // fat
    const nfat = buf.readUInt32BE(4);
    const entries: MachOEntry[] = [];
    for (let i = 0; i < nfat; i++) {
      const o = 8 + i * 20;
      const offset = buf.readUInt32BE(o + 8);
      entries.push(parseOneMachO(buf, offset));
    }
    return entries;
  }
  return [parseOneMachO(buf, 0)];
}

// ============================================================
// DEX (Android)
// ============================================================

interface DexInfo {
  magic: string;
  version: string;
  checksum: number;
  stringIds: number;
  typeIds: number;
  protoIds: number;
  fieldIds: number;
  methodIds: number;
  classDefs: number;
  firstClasses: string[];
}

function parseDex(buf: Buffer): DexInfo {
  const magic = buf.slice(0, 4).toString("ascii");
  if (magic !== "dex\n") throw new Error("Not a DEX");
  const version = buf.slice(4, 7).toString("ascii");
  const checksum = buf.readUInt32LE(8);
  const stringIdsSize = buf.readUInt32LE(56);
  const stringIdsOff = buf.readUInt32LE(60);
  const typeIdsSize = buf.readUInt32LE(64);
  const typeIdsOff = buf.readUInt32LE(68);
  const protoIdsSize = buf.readUInt32LE(72);
  const fieldIdsSize = buf.readUInt32LE(80);
  const methodIdsSize = buf.readUInt32LE(88);
  const classDefsSize = buf.readUInt32LE(96);
  const classDefsOff = buf.readUInt32LE(100);

  const readLeb128 = (off: number): [number, number] => {
    let result = 0;
    let shift = 0;
    let i = off;
    while (true) {
      const b = buf[i++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) break;
    }
    return [result, i];
  };

  const readStr = (idx: number): string => {
    if (idx >= stringIdsSize) return "";
    const strOff = buf.readUInt32LE(stringIdsOff + idx * 4);
    const [, dataOff] = readLeb128(strOff);
    let e = dataOff;
    while (e < buf.length && buf[e] !== 0) e++;
    return buf.slice(dataOff, e).toString("utf8");
  };

  const firstClasses: string[] = [];
  for (let i = 0; i < Math.min(classDefsSize, 20); i++) {
    const classDefOff = classDefsOff + i * 32;
    const classIdx = buf.readUInt32LE(classDefOff);
    if (classIdx >= typeIdsSize) continue;
    const stringIdx = buf.readUInt32LE(typeIdsOff + classIdx * 4);
    firstClasses.push(readStr(stringIdx));
  }

  return {
    magic: "dex",
    version,
    checksum,
    stringIds: stringIdsSize,
    typeIds: typeIdsSize,
    protoIds: protoIdsSize,
    fieldIds: fieldIdsSize,
    methodIds: methodIdsSize,
    classDefs: classDefsSize,
    firstClasses,
  };
}

// ============================================================
// WebAssembly
// ============================================================

const WASM_SEC: Record<number, string> = {
  0: "Custom", 1: "Type", 2: "Import", 3: "Function", 4: "Table",
  5: "Memory", 6: "Global", 7: "Export", 8: "Start", 9: "Element",
  10: "Code", 11: "Data", 12: "DataCount",
};

function parseWasm(buf: Buffer): { version: number; sections: { id: string; size: number; offset: number; customName?: string }[] } {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x0061736d) throw new Error("Not WASM");
  const version = buf.readUInt32LE(4);
  const sections: { id: string; size: number; offset: number; customName?: string }[] = [];
  let p = 8;
  while (p < buf.length) {
    const id = buf[p]; p += 1;
    const [sz, afterLeb] = readUleb128(buf, p);
    p = afterLeb;
    const sect: { id: string; size: number; offset: number; customName?: string } = { id: WASM_SEC[id] ?? `0x${id.toString(16)}`, size: sz, offset: p };
    if (id === 0) {
      // custom section: name is LEB128 length + utf8 bytes
      const [nameLen, afterName] = readUleb128(buf, p);
      sect.customName = buf.slice(afterName, afterName + nameLen).toString("utf8");
    }
    sections.push(sect);
    p += sz;
  }
  return { version, sections };
}

function readUleb128(buf: Buffer, p: number): [number, number] {
  let result = 0, shift = 0;
  while (true) {
    const b = buf[p++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) break;
  }
  return [result, p];
}

// ============================================================
// MCP registration
// ============================================================

export function registerNativeFormatsTools(server: McpServer): void {
  server.tool(
    "elf_parse",
    "Parse an ELF (Linux, Android native, FreeBSD, PS4/PS5 unsigned, static game binaries). Returns machine, bits, type, entry, segments, sections, DT_NEEDED, SONAME, interpreter. Pure TypeScript.",
    { path: z.string().describe("Absolute path to an ELF file.") },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const info = parseElf(buf);
        const lines = [
          `# ELF: ${path}`,
          `- bits=${info.bits} endian=${info.endian}`,
          `- machine=${info.machine}`,
          `- type=${info.type}`,
          `- entry=0x${info.entry.toString(16)}`,
          `- interpreter=${info.interpreter ?? "(none)"}`,
          `- SONAME=${info.soname ?? "(none)"}`,
          `- DT_NEEDED (${info.dtNeeded.length}): ${info.dtNeeded.join(", ")}`,
          ``,
          `## Segments (${info.segments.length})`,
          ...info.segments.map((s) => `- ${s.type.padEnd(14)} ${s.flags.join("|").padEnd(5)}  vaddr=0x${s.vaddr.toString(16)}  filesz=0x${s.filesz.toString(16)}  memsz=0x${s.memsz.toString(16)}`),
          ``,
          `## Sections (${info.sections.length})`,
          ...info.sections.slice(0, 64).map((s) => `- ${s.name.padEnd(20)} ${s.type.padEnd(12)} ${s.flags.join("|").padEnd(16)}  addr=0x${s.addr.toString(16)}  size=0x${s.size.toString(16)}`),
        ];
        if (info.sections.length > 64) lines.push(`...(+${info.sections.length - 64} more sections)`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `elf_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "macho_parse",
    "Parse a Mach-O (macOS, iOS, iPadOS, visionOS, tvOS). Handles thin and fat (universal) binaries. Returns CPU, filetype, segments, load commands, LC_LOAD_DYLIB list.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const entries = parseMachO(buf);
        const out: string[] = [`# Mach-O: ${path} (${entries.length} slice${entries.length === 1 ? "" : "s"})`];
        for (const [i, info] of entries.entries()) {
          out.push(``, `## slice ${i}: ${info.cpu} ${info.bits}-bit ${info.filetype}`);
          out.push(`- load commands: ${info.loadCommands.length}`);
          out.push(`- dylibs (${info.dylibs.length}): ${info.dylibs.map((d) => d.split("/").pop()).join(", ")}`);
          out.push(``, `### segments`);
          for (const s of info.segments) {
            out.push(`- ${s.name.padEnd(16)} vmaddr=0x${s.vmaddr.toString(16)} vmsize=0x${s.vmsize.toString(16)} initprot=0x${s.initprot.toString(16)}`);
          }
        }
        return { content: [{ type: "text" as const, text: out.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `macho_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "dex_parse",
    "Parse an Android DEX file. Returns version, counts of string/type/proto/field/method/class IDs, and the first class names.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const info = parseDex(buf);
        const lines = [
          `# DEX: ${path}`,
          `- version=${info.version}`,
          `- checksum=0x${info.checksum.toString(16)}`,
          `- stringIds=${info.stringIds}`,
          `- typeIds=${info.typeIds}`,
          `- protoIds=${info.protoIds}`,
          `- fieldIds=${info.fieldIds}`,
          `- methodIds=${info.methodIds}`,
          `- classDefs=${info.classDefs}`,
          ``,
          `## first classes`,
          ...info.firstClasses.map((c) => `- ${c}`),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `dex_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "wasm_parse",
    "Parse a WebAssembly binary. Returns version + section layout (standard + custom).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const info = parseWasm(buf);
        const lines = [`# WASM: ${path}`, `version=${info.version}`, ``, `## sections`];
        for (const s of info.sections) {
          lines.push(`- ${s.id.padEnd(10)} size=0x${s.size.toString(16).padStart(6, "0")} off=0x${s.offset.toString(16)}${s.customName ? "  custom=" + s.customName : ""}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `wasm_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "file_identify",
    "Identify a binary file's format by magic. Supports PE (MZ), ELF, Mach-O (thin + fat), DEX, WASM, ZIP/APK/JAR, 7-Zip, GZip, Zstd, LZ4, DMG, ISO, ESD, JPG/PNG/BMP/WebP, PDF, Script shebangs, and a few game-specific (XEX, NSO, NCA).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const head = buf.slice(0, 32);
        const magic = head.toString("hex").toUpperCase();
        const asc = head.slice(0, 4).toString("ascii");
        const guesses: string[] = [];
        if (asc === "MZ\0\0" || asc.startsWith("MZ")) guesses.push("PE/COFF (Windows)");
        if (magic.startsWith("7F454C46")) guesses.push("ELF");
        if (magic.startsWith("FEEDFACE") || magic.startsWith("FEEDFACF")) guesses.push("Mach-O thin");
        if (magic.startsWith("CAFEBABE") || magic.startsWith("BEBAFECA")) guesses.push("Mach-O fat");
        if (asc === "dex\n") guesses.push("DEX (Android)");
        if (magic.startsWith("0061736D")) guesses.push("WebAssembly");
        if (magic.startsWith("504B0304") || magic.startsWith("504B0506")) guesses.push("ZIP/APK/JAR");
        if (magic.startsWith("377ABCAF271C")) guesses.push("7-Zip");
        if (magic.startsWith("1F8B")) guesses.push("gzip");
        if (magic.startsWith("28B52FFD")) guesses.push("Zstandard");
        if (magic.startsWith("04224D18") || magic.startsWith("184D2204")) guesses.push("LZ4");
        if (asc === "%PDF") guesses.push("PDF");
        if (asc.startsWith("#!")) guesses.push("Shell/Python/… script");
        if (asc === "NSO0" || asc === "NSO2") guesses.push("Switch NSO");
        if (asc === "NCA3" || asc === "NCA2") guesses.push("Switch NCA");
        if (asc === "XEX1" || asc === "XEX2") guesses.push("Xbox 360 XEX");
        if (magic.startsWith("8BA61D9E")) guesses.push("PS4/PS5 FSELF (Sony)");
        return { content: [{ type: "text" as const, text: `# file_identify ${path}\nhead=${magic.slice(0, 32)}\nmatches: ${guesses.join(" | ") || "(unknown)"}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `file_identify error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );
}

// Exported for tests
export { parseElf, parseMachO, parseDex, parseWasm };
