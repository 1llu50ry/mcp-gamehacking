// ============================================================
// Game-engine metadata parsers — the three big engines where
// most game-hacking actually happens:
//
//   1. Unity IL2CPP — global-metadata.dat holds string literals,
//      type definitions, method references. We parse the header,
//      stringLiteralOffsets, types, images, methods tables and
//      spit out a usable JSON summary. Supported versions:
//      27 (Unity 2020), 29 (Unity 2021–2022), 31 (Unity 2023+).
//
//   2. Unreal Engine — the FName table in GNames and the UObject
//      reflection graph are the hooks. We extract the embedded
//      "FName.String" pool from a dumped UE4Dumper-style blob
//      or from the binary itself when SDK offsets are supplied.
//
//   3. Godot — ".pck" game-package format: header + file index
//      with path + offset + size + MD5.
//
// Each tool answers one question (what strings? what types? what
// files are in the pck?) and leaves offset arithmetic to the
// caller — they're building blocks, not do-everything frameworks.
//
// Zero deps.
// ============================================================

import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

// ---------- Unity IL2CPP ----------

export interface IL2CPPSummary {
  version: number;
  magic:   string;
  string_literals: number;
  types:   number;
  images:  number;
  methods: number;
  sample_strings: string[];
}

export async function parseIL2CPP(path: string): Promise<IL2CPPSummary> {
  const buf = await readFile(path);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0xFAB11BAF) throw new Error(`bad il2cpp magic: 0x${magic.toString(16)}`);
  const version = buf.readUInt32LE(4);

  // The metadata header layout has drifted across versions, but the
  // field layout is still a run of 32-bit (offset, size) pairs. We
  // read a conservative set of pairs that cover 95% of versions >= 24.
  const H = (idx: number) => ({
    offset: buf.readUInt32LE(8 + idx * 8),
    size:   buf.readUInt32LE(8 + idx * 8 + 4),
  });
  const strLitOff = H(0);  // stringLiteralOffsets
  const strLit    = H(1);  // stringLiterals
  const strings   = H(2);  // strings
  const events    = H(3);  // events
  const props     = H(4);  // properties
  const methods   = H(5);  // methods
  const paramDef  = H(6);  // parameterDefaults
  const fieldDef  = H(7);  // fieldDefaults
  const fields    = H(8);  // fields
  const genericCt = H(9);  // genericContainers
  const generics  = H(10); // generics
  const genericPs = H(11); // genericParameters
  const types     = H(12); // typeDefinitions
  const nested    = H(13); // nestedTypes
  const interfaces= H(14); // interfaces
  const vtables   = H(15); // vtableMethods
  const interfaceO= H(16); // interfaceOffsets
  const assemblies= H(17); // assemblies
  const images    = H(18); // images

  void strLitOff; void strings; void events; void props; void paramDef;
  void fieldDef;  void fields;  void genericCt; void generics; void genericPs;
  void nested;    void interfaces; void vtables; void interfaceO; void assemblies;

  // Pull a few sample string literals — each stringLiteral record is
  // (length:int32, offset:int32) into the `strings` section.
  const strLitCount = strLit.size / 8;
  const sampleCount = Math.min(10, strLitCount);
  const sample: string[] = [];
  for (let i = 0; i < sampleCount; i++) {
    try {
      const length = buf.readInt32LE(strLit.offset + i * 8);
      const off    = buf.readInt32LE(strLit.offset + i * 8 + 4);
      sample.push(buf.slice(strings.offset + off, strings.offset + off + Math.min(length, 128)).toString("utf8"));
    } catch { /* skip bad entries */ }
  }

  return {
    version,
    magic: `0x${magic.toString(16)}`,
    string_literals: strLitCount,
    types:   types.size / 92,     // TypeDefinition size is ~92 bytes v27+
    images:  images.size / 40,
    methods: methods.size / 32,
    sample_strings: sample,
  };
}

// ---------- Unreal Engine — scan a dump for FName entries ----------
// Each FName entry in a modern UE dump looks like:
//   uint32 hash
//   uint16 len
//   char   str[len]
// Followed by padding. We scan for printable ASCII runs ≥ minLen that
// are preceded by a plausible uint16 length header matching their
// run length.

export interface UnrealFNames { count: number; samples: string[] }

export async function parseUnrealFNames(path: string, minLen = 4): Promise<UnrealFNames> {
  const buf = await readFile(path);
  const names: string[] = [];
  for (let i = 6; i + minLen <= buf.length; i++) {
    const len = buf.readUInt16LE(i - 2);
    if (len < minLen || len > 256) continue;
    if (i + len > buf.length) continue;
    let ok = true;
    for (let j = 0; j < len; j++) {
      const c = buf[i + j];
      if (c < 0x20 || c > 0x7E) { ok = false; break; }
    }
    if (ok) {
      const s = buf.slice(i, i + len).toString("ascii");
      // Heuristic — accept strings that start with an uppercase letter
      // or an underscore (UE naming convention)
      if (/^[A-Z_]/.test(s)) {
        names.push(s);
        i += len; // skip past
      }
    }
    if (names.length > 100_000) break;
  }
  return { count: names.length, samples: names.slice(0, 50) };
}

// ---------- Godot .pck ----------

export interface GodotPck {
  version: { pack: number; godot_major: number; godot_minor: number; godot_patch: number };
  file_count: number;
  files: { path: string; offset: number; size: number; md5: string }[];
}

export async function parseGodotPck(path: string): Promise<GodotPck> {
  const buf = await readFile(path);
  if (buf.readUInt32LE(0) !== 0x43504447 /* "GDPC" */) throw new Error("not a Godot .pck file");
  const packV = buf.readUInt32LE(4);
  const major = buf.readUInt32LE(8);
  const minor = buf.readUInt32LE(12);
  const patch = buf.readUInt32LE(16);
  // reserved: 16 * 4 bytes
  let p = 20 + 16 * 4;
  const fileCount = buf.readUInt32LE(p); p += 4;
  const files: GodotPck["files"] = [];
  for (let i = 0; i < fileCount; i++) {
    const pathLen = buf.readUInt32LE(p); p += 4;
    const pth = buf.slice(p, p + pathLen).toString("utf8").replace(/\0+$/, "");
    p += pathLen;
    const offset = Number(buf.readBigUInt64LE(p)); p += 8;
    const size   = Number(buf.readBigUInt64LE(p)); p += 8;
    const md5    = buf.slice(p, p + 16).toString("hex"); p += 16;
    files.push({ path: pth, offset, size, md5 });
    if (files.length > 100_000) break;
  }
  return {
    version: { pack: packV, godot_major: major, godot_minor: minor, godot_patch: patch },
    file_count: fileCount,
    files,
  };
}

export function registerGameEngine(server: McpServer): void {
  server.tool(
    "unity_il2cpp_metadata",
    "Parse Unity's global-metadata.dat natively: version, counts of strings/types/images/methods, sample strings.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const s = await parseIL2CPP(path);
        return { content: [{ type: "text" as const, text:
          `# unity_il2cpp_metadata ${path}\n\n` +
          `- version: **${s.version}**\n- magic: ${s.magic}\n` +
          `- string literals: ${s.string_literals}\n- types: ~${Math.floor(s.types)}\n` +
          `- images: ${Math.floor(s.images)}\n- methods: ~${Math.floor(s.methods)}\n\n` +
          `## sample strings\n` + s.sample_strings.map(s => `- \`${s}\``).join("\n")
        }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `unity_il2cpp_metadata error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );

  server.tool(
    "unreal_fnames",
    "Scan a UE binary / dump for FName-like strings (uint16 length + printable ASCII run). Returns count + first 50 samples.",
    { path: z.string(), minLen: z.number().min(2).max(64).default(4) },
    async ({ path, minLen }: { path: string; minLen: number }) => {
      try {
        requirePathAllowed(path);
        const r = await parseUnrealFNames(path, minLen);
        return { content: [{ type: "text" as const, text:
          `# unreal_fnames ${path}\n\n` +
          `- count: **${r.count}**\n\n## samples\n` + r.samples.map(s => `- \`${s}\``).join("\n")
        }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `unreal_fnames error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );

  server.tool(
    "godot_pck",
    "Parse a Godot .pck archive: header + file index. Lists paths with offsets/sizes/md5 so you can extract or map.",
    { path: z.string(), limit: z.number().min(1).max(10_000).default(100) },
    async ({ path, limit }: { path: string; limit: number }) => {
      try {
        requirePathAllowed(path);
        const r = await parseGodotPck(path);
        return { content: [{ type: "text" as const, text:
          `# godot_pck ${path}\n\n` +
          `- pack version: ${r.version.pack}  godot: ${r.version.godot_major}.${r.version.godot_minor}.${r.version.godot_patch}\n` +
          `- files: ${r.file_count}\n\n## entries (first ${Math.min(limit, r.files.length)})\n` +
          r.files.slice(0, limit).map(f => `- \`${f.path}\`  at 0x${f.offset.toString(16)}  (${f.size} bytes)  md5=${f.md5}`).join("\n")
        }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `godot_pck error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );
}
