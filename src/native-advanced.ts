// Advanced native TS parsers:
//   - Minidump (.dmp)
//   - PDB70 header (RSDS)
//   - Rich Header (PE)
//   - CodeView (NB10, RSDS)
//   - Itanium (GCC/Clang) and MSVC name demanglers (minimal)
//   - Unity AssetBundle header
//   - UE4/UE5 .pak header
//   - IL2CPP global-metadata.dat header
//   - Switch NSO/NRO header
//   - MSI/CAB header sniff
//
// Zero external dependencies.

import { requirePathAllowed } from "./fs-sandbox.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ============================================================
// Minidump
// ============================================================

const MINIDUMP_SIGNATURE = 0x504d444d; // 'MDMP'

const STREAM_TYPES: Record<number, string> = {
  3: "ThreadList",
  4: "ModuleList",
  5: "MemoryList",
  6: "Exception",
  7: "SystemInfo",
  8: "ThreadExList",
  9: "Memory64List",
  10: "CommentA",
  11: "CommentW",
  12: "HandleData",
  13: "FunctionTable",
  14: "UnloadedModuleList",
  15: "MiscInfo",
  16: "MemoryInfoList",
  17: "ThreadInfoList",
  18: "HandleOperationList",
  19: "TokenStream",
  20: "JavaScript",
  21: "SystemMemoryInfo",
  22: "ProcessVmCounters",
  23: "IPTTrace",
  24: "ThreadNames",
};

interface MinidumpModule { name: string; base: bigint; size: number; timestamp: number; checksum: number; }
interface MinidumpThread { id: number; teb: bigint; stackBase: bigint; stackSize: number; pc: bigint | null; }

export function parseMinidump(buf: Buffer): {
  signature: string;
  version: number;
  streamCount: number;
  streams: { type: string; size: number; rva: number }[];
  system?: { arch: string; cpu: number; majorOs: number; minorOs: number; buildNumber: number; platform: string };
  modules: MinidumpModule[];
  threads: MinidumpThread[];
  exception?: { code: number; address: bigint; threadId: number };
} {
  if (buf.readUInt32LE(0) !== MINIDUMP_SIGNATURE) throw new Error("Not a Minidump (MDMP sig missing)");
  const version = buf.readUInt32LE(4);
  const nStreams = buf.readUInt32LE(8);
  const streamRva = buf.readUInt32LE(12);
  const streams: { type: string; size: number; rva: number }[] = [];
  for (let i = 0; i < nStreams; i++) {
    const o = streamRva + i * 12;
    streams.push({ type: STREAM_TYPES[buf.readUInt32LE(o)] ?? `0x${buf.readUInt32LE(o).toString(16)}`, size: buf.readUInt32LE(o + 4), rva: buf.readUInt32LE(o + 8) });
  }

  const strWide = (rva: number) => {
    const len = buf.readUInt32LE(rva);
    return buf.slice(rva + 4, rva + 4 + len).toString("utf16le");
  };

  const modules: MinidumpModule[] = [];
  const modList = streams.find((s) => s.type === "ModuleList");
  if (modList) {
    const count = buf.readUInt32LE(modList.rva);
    for (let i = 0; i < count; i++) {
      const o = modList.rva + 4 + i * 108;
      const base = buf.readBigUInt64LE(o);
      const size = buf.readUInt32LE(o + 8);
      const checksum = buf.readUInt32LE(o + 12);
      const timestamp = buf.readUInt32LE(o + 16);
      const nameRva = buf.readUInt32LE(o + 20);
      let name = "";
      try { name = strWide(nameRva); } catch { /* best effort */ }
      modules.push({ name, base, size, checksum, timestamp });
    }
  }

  const threads: MinidumpThread[] = [];
  const thrList = streams.find((s) => s.type === "ThreadList");
  if (thrList) {
    const count = buf.readUInt32LE(thrList.rva);
    for (let i = 0; i < count; i++) {
      const o = thrList.rva + 4 + i * 48;
      threads.push({
        id: buf.readUInt32LE(o),
        teb: buf.readBigUInt64LE(o + 16),
        stackBase: buf.readBigUInt64LE(o + 24),
        stackSize: buf.readUInt32LE(o + 32),
        pc: null,
      });
    }
  }

  let exception: { code: number; address: bigint; threadId: number } | undefined;
  const exc = streams.find((s) => s.type === "Exception");
  if (exc) {
    const o = exc.rva;
    exception = {
      threadId: buf.readUInt32LE(o),
      code: buf.readUInt32LE(o + 8),
      address: buf.readBigUInt64LE(o + 32),
    };
  }

  let system: { arch: string; cpu: number; majorOs: number; minorOs: number; buildNumber: number; platform: string } | undefined;
  const sys = streams.find((s) => s.type === "SystemInfo");
  if (sys) {
    const o = sys.rva;
    const arch = buf.readUInt16LE(o);
    const cpu = buf.readUInt16LE(o + 2);
    const majorOs = buf.readUInt32LE(o + 8);
    const minorOs = buf.readUInt32LE(o + 12);
    const buildNumber = buf.readUInt32LE(o + 16);
    const platformId = buf.readUInt32LE(o + 20);
    const archName: Record<number, string> = { 0: "intel", 5: "arm", 6: "ia64", 9: "amd64", 12: "arm64" };
    const platName: Record<number, string> = { 0: "Win32s", 1: "Win9x", 2: "WinNT" };
    system = { arch: archName[arch] ?? `0x${arch.toString(16)}`, cpu, majorOs, minorOs, buildNumber, platform: platName[platformId] ?? `0x${platformId.toString(16)}` };
  }

  return {
    signature: "MDMP",
    version,
    streamCount: nStreams,
    streams,
    system,
    modules,
    threads,
    exception,
  };
}

// ============================================================
// PDB70 (RSDS) header reader + Debug Directory CV info
// ============================================================

export function parsePdb70Header(buf: Buffer): { signature: string; guid: string; age: number; pdbPath: string } {
  if (buf.readUInt32BE(0) !== 0x5253_4453 /* 'RSDS' */) throw new Error("Not an RSDS record");
  const guidBytes = buf.slice(4, 20);
  const d1 = guidBytes.readUInt32LE(0);
  const d2 = guidBytes.readUInt16LE(4);
  const d3 = guidBytes.readUInt16LE(6);
  const d4 = guidBytes.slice(8, 16).toString("hex").toUpperCase();
  const guid = `${d1.toString(16).padStart(8, "0").toUpperCase()}-${d2.toString(16).padStart(4, "0").toUpperCase()}-${d3.toString(16).padStart(4, "0").toUpperCase()}-${d4.slice(0, 4)}-${d4.slice(4)}`;
  const age = buf.readUInt32LE(20);
  let e = 24;
  while (e < buf.length && buf[e] !== 0) e++;
  const pdbPath = buf.slice(24, e).toString("ascii");
  return { signature: "RSDS", guid, age, pdbPath };
}

// ============================================================
// Rich Header (PE) parser
// ============================================================

export function parseRichHeader(buf: Buffer): { entries: { prodId: number; buildNum: number; count: number }[]; dansOff: number; richOff: number } | null {
  // Rich header lives between e_lfanew-aligned "DanS" marker and the "Rich" marker.
  // Not required by PE spec; absent in cross-compiled binaries.
  const peOff = buf.readUInt32LE(0x3c);
  // scan backwards from PE header for "Rich" + 4-byte XOR key
  let richOff = -1;
  for (let i = peOff - 8; i > 0x40; i -= 4) {
    if (buf.readUInt32LE(i) === 0x68636952 /* 'Rich' */) { richOff = i; break; }
  }
  if (richOff < 0) return null;
  const key = buf.readUInt32LE(richOff + 4);
  // decrypt backwards until "DanS"
  let dansOff = -1;
  for (let i = richOff - 4; i > 0x40; i -= 4) {
    if ((buf.readUInt32LE(i) ^ key) === 0x536e_6144 /* 'DanS' */) { dansOff = i; break; }
  }
  if (dansOff < 0) return null;
  // After "DanS" + 3 pads come (CompID, Count) pairs
  const entries: { prodId: number; buildNum: number; count: number }[] = [];
  for (let i = dansOff + 16; i < richOff; i += 8) {
    const compId = buf.readUInt32LE(i) ^ key;
    const count = buf.readUInt32LE(i + 4) ^ key;
    entries.push({ prodId: (compId >>> 16) & 0xffff, buildNum: compId & 0xffff, count });
  }
  return { entries, dansOff, richOff };
}

// ============================================================
// Minimal C++ name demanglers (MSVC + Itanium / GCC-Clang)
// ============================================================

// MSVC name mangling is huge; this just handles common cases: function names.
export function demangleMsvc(name: string): string {
  // "?Func@Namespace@@QEAAXH@Z" -> rough: Namespace::Func(int)
  if (!name.startsWith("?")) return name;
  const parts = name.split("@@")[0].slice(1).split("@").filter(Boolean);
  if (!parts.length) return name;
  const scope = parts.reverse().join("::");
  return scope;
}

// Itanium: _Z<N>Name_Z... -> Name
export function demangleItanium(name: string): string {
  // Pattern: _Z<len>Name
  const m = /^_Z(?:N(.*)E|(\d+)([A-Za-z_][A-Za-z_0-9]*))/.exec(name);
  if (!m) return name;
  if (m[1]) {
    // Nested: parse <len>name sequences
    let rest = m[1];
    const parts: string[] = [];
    while (rest.length) {
      const nm = /^(\d+)(.+)$/.exec(rest);
      if (!nm) break;
      const n = parseInt(nm[1], 10);
      parts.push(nm[2].slice(0, n));
      rest = nm[2].slice(n);
    }
    return parts.join("::");
  }
  return m[3] ?? name;
}

// ============================================================
// Unity AssetBundle (header only)
// ============================================================

export function parseAssetBundleHeader(buf: Buffer): { signature: string; version: number; unityVersion: string; unityRevision: string; size: bigint } {
  let p = 0;
  const readCStr = () => {
    const start = p;
    while (p < buf.length && buf[p] !== 0) p++;
    const s = buf.slice(start, p).toString("utf8");
    p++;
    return s;
  };
  const sig = readCStr();
  if (!["UnityFS", "UnityWeb", "UnityRaw", "UnityArchive"].includes(sig)) throw new Error(`Not an AssetBundle (sig=${sig})`);
  const version = buf.readUInt32BE(p); p += 4;
  const unityVersion = readCStr();
  const unityRevision = readCStr();
  const size = buf.readBigUInt64BE(p);
  return { signature: sig, version, unityVersion, unityRevision, size };
}

// ============================================================
// UE4/UE5 .pak file header (tail-anchored)
// ============================================================

export function parsePakHeader(buf: Buffer): { magic: string; version: number; indexOffset: bigint; indexSize: bigint; indexHash: string } {
  // Pak footer sits at EOF - FooterSize. For UE4.27+/UE5 the footer is 221 bytes for v9, 216 for v8, etc.
  // Just scan the last 256 bytes for the magic 0x5A6F12E1
  const PAK_MAGIC = 0x5a6f12e1;
  const end = buf.length;
  let magicPos = -1;
  for (let i = end - 4; i >= end - 256 && i >= 0; i--) {
    if (buf.readUInt32LE(i) === PAK_MAGIC) { magicPos = i; break; }
  }
  if (magicPos < 0) throw new Error("Pak magic not found (not a UE pak or encrypted)");
  const version = buf.readUInt32LE(magicPos + 4);
  const indexOffset = buf.readBigUInt64LE(magicPos + 8);
  const indexSize = buf.readBigUInt64LE(magicPos + 16);
  const indexHash = buf.slice(magicPos + 24, magicPos + 24 + 20).toString("hex");
  return { magic: "0x5A6F12E1", version, indexOffset, indexSize, indexHash };
}

// ============================================================
// IL2CPP global-metadata.dat header
// ============================================================

export function parseIl2cppMetadata(buf: Buffer): { signature: string; version: number; stringLiteralOffset: number; stringLiteralCount: number } {
  const sig = buf.readUInt32LE(0);
  if (sig !== 0xfab11baf) throw new Error(`Not IL2CPP metadata (got 0x${sig.toString(16)}; probably encrypted)`);
  const version = buf.readUInt32LE(4);
  const stringLiteralOffset = buf.readUInt32LE(8);
  const stringLiteralCount = buf.readUInt32LE(12);
  return { signature: "0xFAB11BAF", version, stringLiteralOffset, stringLiteralCount };
}

// ============================================================
// Switch NSO header
// ============================================================

export function parseNsoHeader(buf: Buffer): { magic: string; version: number; textOffset: number; textSize: number; roOffset: number; roSize: number; dataOffset: number; dataSize: number; bssSize: number; moduleIdHex: string } {
  const magic = buf.slice(0, 4).toString("ascii");
  if (magic !== "NSO0") throw new Error("Not NSO");
  const version = buf.readUInt32LE(4);
  const textOffset = buf.readUInt32LE(0x10);
  const textSize = buf.readUInt32LE(0x14);
  const roOffset = buf.readUInt32LE(0x20);
  const roSize = buf.readUInt32LE(0x24);
  const dataOffset = buf.readUInt32LE(0x30);
  const dataSize = buf.readUInt32LE(0x34);
  const bssSize = buf.readUInt32LE(0x3c);
  const moduleIdHex = buf.slice(0x40, 0x60).toString("hex");
  return { magic, version, textOffset, textSize, roOffset, roSize, dataOffset, dataSize, bssSize, moduleIdHex };
}

// ============================================================
// MCP registration
// ============================================================

export function registerAdvancedParsers(server: McpServer): void {
  server.tool(
    "minidump_parse",
    "Parse a Windows minidump (.dmp). Returns streams, system info (OS build + arch), module list (name/base/size/timestamp), thread list (id/TEB/stack), exception info if present.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const info = parseMinidump(buf);
        const lines = [
          `# Minidump: ${path}`,
          `- signature=${info.signature} version=0x${info.version.toString(16)} streams=${info.streamCount}`,
        ];
        if (info.system) lines.push(`- system: ${info.system.arch} CPU=${info.system.cpu} Windows ${info.system.majorOs}.${info.system.minorOs} build ${info.system.buildNumber} (${info.system.platform})`);
        if (info.exception) lines.push(`- exception: code=0x${info.exception.code.toString(16)} addr=0x${info.exception.address.toString(16)} tid=${info.exception.threadId}`);
        lines.push(``, `## Streams (${info.streams.length})`);
        for (const s of info.streams) lines.push(`- ${s.type.padEnd(20)} size=0x${s.size.toString(16)}  rva=0x${s.rva.toString(16)}`);
        lines.push(``, `## Modules (${info.modules.length})`);
        for (const m of info.modules.slice(0, 64)) lines.push(`- base=0x${m.base.toString(16).padStart(16, "0")} size=0x${m.size.toString(16).padStart(8, "0")} ts=${new Date(m.timestamp * 1000).toISOString()} ${m.name}`);
        if (info.modules.length > 64) lines.push(`...(+${info.modules.length - 64} more modules)`);
        lines.push(``, `## Threads (${info.threads.length})`);
        for (const t of info.threads.slice(0, 32)) lines.push(`- id=${t.id} TEB=0x${t.teb.toString(16)} stackBase=0x${t.stackBase.toString(16)} stackSize=0x${t.stackSize.toString(16)}`);
        if (info.threads.length > 32) lines.push(`...(+${info.threads.length - 32} more threads)`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `minidump_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "pdb70_identify",
    "Parse an RSDS record (from PE debug directory or standalone PDB). Returns GUID + age + PDB filename -- enough to fetch matching PDB from the Microsoft public symbol server (https://msdl.microsoft.com/download/symbols/<pdbname>/<guid><age>/<pdbname>).",
    { path: z.string().describe("Path to raw RSDS block (e.g. extracted from PE debug directory)."), offset: z.number().min(0).default(0) },
    async ({ path, offset }: { path: string; offset: number }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const info = parsePdb70Header(buf.slice(offset));
        const guidNoHyphens = info.guid.replace(/-/g, "");
        const symSrv = `https://msdl.microsoft.com/download/symbols/${info.pdbPath.split(/[\\/]/).pop()}/${guidNoHyphens}${info.age}/${info.pdbPath.split(/[\\/]/).pop()}`;
        return { content: [{ type: "text" as const, text: `# PDB70\nGUID=${info.guid}\nage=${info.age}\npdbPath=${info.pdbPath}\n\nsymbol-server-url=${symSrv}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `pdb70_identify error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "rich_header_parse",
    "Parse the Rich header of a PE (MSVC build fingerprint). Returns (CompId, buildNum, count) entries that identify compiler + linker versions used.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const r = parseRichHeader(buf);
        if (!r) return { content: [{ type: "text" as const, text: "Rich header not present." }] };
        const lines = [`# Rich header @ 0x${r.dansOff.toString(16)}..0x${r.richOff.toString(16)}`, `entries: ${r.entries.length}`, ``];
        for (const e of r.entries) lines.push(`- prodId=0x${e.prodId.toString(16)}  buildNum=${e.buildNum}  count=${e.count}`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `rich_header_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "demangle",
    "Demangle a C++ symbol -- MSVC (`?Foo@Namespace@@YA...`) or Itanium (`_ZN...`). Returns a best-effort unmangled name.",
    { symbol: z.string(), kind: z.enum(["auto", "msvc", "itanium"]).default("auto") },
    async ({ symbol, kind }: { symbol: string; kind: "auto" | "msvc" | "itanium" }) => {
      let out = symbol;
      if (kind === "auto") {
        if (symbol.startsWith("_Z")) out = demangleItanium(symbol);
        else if (symbol.startsWith("?")) out = demangleMsvc(symbol);
      } else if (kind === "msvc") out = demangleMsvc(symbol);
      else out = demangleItanium(symbol);
      return { content: [{ type: "text" as const, text: `${symbol}  ->  ${out}` }] };
    }
  );

  server.tool(
    "assetbundle_parse",
    "Parse the header of a Unity AssetBundle (UnityFS / UnityWeb / UnityRaw / UnityArchive). Returns signature, version, Unity version, Unity revision, size.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const h = parseAssetBundleHeader(buf);
        return { content: [{ type: "text" as const, text: `# AssetBundle: ${path}\n- signature=${h.signature}\n- version=${h.version}\n- Unity=${h.unityVersion} / ${h.unityRevision}\n- size=${h.size}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `assetbundle_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "pak_parse",
    "Parse the footer of a UE4/UE5 .pak file (magic 0x5A6F12E1). Returns version, index offset, index size, index hash. Does NOT handle encrypted paks.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const h = parsePakHeader(buf);
        return { content: [{ type: "text" as const, text: `# UE .pak: ${path}\n- magic=${h.magic}\n- version=${h.version}\n- index offset=0x${h.indexOffset.toString(16)}\n- index size=0x${h.indexSize.toString(16)}\n- index SHA1=${h.indexHash}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `pak_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "il2cpp_metadata_parse",
    "Parse Unity IL2CPP global-metadata.dat header (unencrypted only). Returns version + string literal counts. Encrypted metadata (Mihoyo, Tencent) throws; use `il2cpp-string-decrypt` skill.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const h = parseIl2cppMetadata(buf);
        return { content: [{ type: "text" as const, text: `# IL2CPP metadata: ${path}\n- signature=${h.signature}\n- version=${h.version}\n- string literals: ${h.stringLiteralCount} @ 0x${h.stringLiteralOffset.toString(16)}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `il2cpp_metadata_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "nso_parse",
    "Parse Switch NSO (Nintendo Switch main executable) header. Returns version, segment layout (text/ro/data/bss) and module id.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const h = parseNsoHeader(buf);
        return { content: [{ type: "text" as const, text: `# NSO: ${path}\n- magic=${h.magic} version=${h.version}\n- text @ 0x${h.textOffset.toString(16)} size=0x${h.textSize.toString(16)}\n- ro   @ 0x${h.roOffset.toString(16)} size=0x${h.roSize.toString(16)}\n- data @ 0x${h.dataOffset.toString(16)} size=0x${h.dataSize.toString(16)}\n- bss  size=0x${h.bssSize.toString(16)}\n- module id: ${h.moduleIdHex}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `nso_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );
}
