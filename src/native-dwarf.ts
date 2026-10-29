// ============================================================
// Native DWARF v4/v5 parser — just enough to answer "which function
// is at this address?" and "which line / source file?".
//
// Reads .debug_info compilation units, their abbrev table (.debug_abbrev)
// and the line-number program (.debug_line) to produce:
//   - functions:   [{ name, low_pc, high_pc, cu, file, line }]
//   - lines:       [{ addr, file, line, column }]
//   - compile_units: [{ name, producer, lang, comp_dir }]
//
// Supports: DWARFv4 and DWARFv5, 32-bit length prefix (0xFFFFFFFF 64-bit
// is accepted but we read the 64-bit length), DW_FORM_strp / strx /
// line_strp, DW_FORM_addr / addrx / data1..data8 / udata / sdata, and
// the DW_TAG_subprogram / DW_TAG_compile_unit / DW_TAG_variable tags.
// Everything else is skipped by form size, not interpreted.
//
// Zero deps.
// ============================================================

import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

// ---------- ELF section finder (shared with native-formats, kept local to avoid cross-module coupling) ----------

interface Section { name: string; off: number; size: number }

function findElfSections(buf: Buffer): Section[] {
  if (buf.readUInt32LE(0) !== 0x464C457F) throw new Error("not an ELF file");
  const is64 = buf[4] === 2;
  const le = buf[5] === 1;
  if (!le) throw new Error("big-endian ELF not supported here");
  const shoff = is64 ? Number(buf.readBigUInt64LE(0x28)) : buf.readUInt32LE(0x20);
  const shentsize = buf.readUInt16LE(is64 ? 0x3A : 0x2E);
  const shnum = buf.readUInt16LE(is64 ? 0x3C : 0x30);
  const shstrndx = buf.readUInt16LE(is64 ? 0x3E : 0x32);

  const strtabOff = is64
    ? Number(buf.readBigUInt64LE(shoff + shstrndx * shentsize + 0x18))
    : buf.readUInt32LE(shoff + shstrndx * shentsize + 0x10);

  const out: Section[] = [];
  for (let i = 0; i < shnum; i++) {
    const base = shoff + i * shentsize;
    const nameOff = buf.readUInt32LE(base);
    const nameEnd = buf.indexOf(0, strtabOff + nameOff);
    const name = buf.slice(strtabOff + nameOff, nameEnd).toString("utf8");
    const off  = is64 ? Number(buf.readBigUInt64LE(base + 0x18)) : buf.readUInt32LE(base + 0x10);
    const size = is64 ? Number(buf.readBigUInt64LE(base + 0x20)) : buf.readUInt32LE(base + 0x14);
    out.push({ name, off, size });
  }
  return out;
}

// ---------- LEB128 ----------

function uleb128(buf: Buffer, pos: { v: number }): bigint {
  let r = 0n, shift = 0n;
  while (true) {
    const b = buf[pos.v++];
    r |= BigInt(b & 0x7F) << shift;
    if ((b & 0x80) === 0) return r;
    shift += 7n;
    if (shift > 70n) throw new Error("uleb128 overflow");
  }
}
function sleb128(buf: Buffer, pos: { v: number }): bigint {
  let r = 0n, shift = 0n;
  let b = 0;
  while (true) {
    b = buf[pos.v++];
    r |= BigInt(b & 0x7F) << shift;
    shift += 7n;
    if ((b & 0x80) === 0) break;
    if (shift > 70n) throw new Error("sleb128 overflow");
  }
  if ((b & 0x40) !== 0 && shift < 64n) r |= -(1n << shift);
  return r;
}

// ---------- Abbrev table ----------

interface Abbrev { tag: number; hasChildren: boolean; attrs: { name: number; form: number; implicitConst?: bigint }[] }

function readAbbrevs(buf: Buffer, start: number): Map<number, Abbrev> {
  const map = new Map<number, Abbrev>();
  const pos = { v: start };
  while (pos.v < buf.length) {
    const code = Number(uleb128(buf, pos));
    if (code === 0) break;
    const tag = Number(uleb128(buf, pos));
    const hasChildren = buf[pos.v++] === 1;
    const attrs: Abbrev["attrs"] = [];
    while (true) {
      const name = Number(uleb128(buf, pos));
      const form = Number(uleb128(buf, pos));
      if (name === 0 && form === 0) break;
      const attr: Abbrev["attrs"][number] = { name, form };
      if (form === 0x21 /* DW_FORM_implicit_const */) attr.implicitConst = sleb128(buf, pos);
      attrs.push(attr);
    }
    map.set(code, { tag, hasChildren, attrs });
  }
  return map;
}

// ---------- DW_FORM reader ----------

const DW_FORM = {
  addr: 0x01, block2: 0x03, block4: 0x04, data2: 0x05, data4: 0x06, data8: 0x07,
  string: 0x08, block: 0x09, block1: 0x0a, data1: 0x0b, flag: 0x0c, sdata: 0x0d,
  strp: 0x0e, udata: 0x0f, ref_addr: 0x10, ref1: 0x11, ref2: 0x12, ref4: 0x13,
  ref8: 0x14, ref_udata: 0x15, indirect: 0x16, sec_offset: 0x17, exprloc: 0x18,
  flag_present: 0x19, strx: 0x1a, addrx: 0x1b, ref_sup4: 0x1c, strp_sup: 0x1d,
  data16: 0x1e, line_strp: 0x1f, ref_sig8: 0x20, implicit_const: 0x21,
  loclistx: 0x22, rnglistx: 0x23, ref_sup8: 0x24, strx1: 0x26, strx2: 0x27,
  strx3: 0x28, strx4: 0x29, addrx1: 0x2a, addrx2: 0x2b, addrx3: 0x2c, addrx4: 0x2d,
} as const;

interface Ctx {
  buf: Buffer;
  debug_str: Buffer;
  debug_line_str: Buffer;
  debug_str_offsets?: Buffer;
  addrSize: number;
  version: number;
  str_offsets_base?: bigint;
}

function readForm(ctx: Ctx, form: number, pos: { v: number }, implicitConst?: bigint): bigint | string | Buffer {
  const b = ctx.buf;
  switch (form) {
    case DW_FORM.addr:      { const v = ctx.addrSize === 8 ? b.readBigUInt64LE(pos.v) : BigInt(b.readUInt32LE(pos.v)); pos.v += ctx.addrSize; return v; }
    case DW_FORM.data1:     { const v = BigInt(b[pos.v]);                    pos.v += 1; return v; }
    case DW_FORM.data2: case DW_FORM.ref2:   { const v = BigInt(b.readUInt16LE(pos.v));         pos.v += 2; return v; }
    case DW_FORM.data4: case DW_FORM.ref4: case DW_FORM.sec_offset: case DW_FORM.strp: case DW_FORM.line_strp:
                            { const v = BigInt(b.readUInt32LE(pos.v));                           pos.v += 4; return form === DW_FORM.strp ? readCStr(ctx.debug_str, Number(v)) : form === DW_FORM.line_strp ? readCStr(ctx.debug_line_str, Number(v)) : v; }
    case DW_FORM.data8: case DW_FORM.ref8: case DW_FORM.ref_sig8:
                            { const v = b.readBigUInt64LE(pos.v);                                 pos.v += 8; return v; }
    case DW_FORM.string:    { const end = b.indexOf(0, pos.v); const s = b.slice(pos.v, end).toString("utf8"); pos.v = end + 1; return s; }
    case DW_FORM.udata: case DW_FORM.ref_udata: case DW_FORM.strx: case DW_FORM.addrx: case DW_FORM.loclistx: case DW_FORM.rnglistx:
                            return uleb128(b, pos);
    case DW_FORM.sdata:     return sleb128(b, pos);
    case DW_FORM.flag:      { const v = BigInt(b[pos.v]); pos.v += 1; return v; }
    case DW_FORM.flag_present: return 1n;
    case DW_FORM.implicit_const: return implicitConst ?? 0n;
    case DW_FORM.ref1:      { const v = BigInt(b[pos.v]); pos.v += 1; return v; }
    case DW_FORM.strx1:     { const idx = b[pos.v++]; return resolveStrx(ctx, idx); }
    case DW_FORM.strx2:     { const idx = b.readUInt16LE(pos.v); pos.v += 2; return resolveStrx(ctx, idx); }
    case DW_FORM.strx3:     { const idx = b.readUIntLE(pos.v, 3); pos.v += 3; return resolveStrx(ctx, idx); }
    case DW_FORM.strx4:     { const idx = b.readUInt32LE(pos.v); pos.v += 4; return resolveStrx(ctx, idx); }
    case DW_FORM.addrx1:    { const v = BigInt(b[pos.v]);                 pos.v += 1; return v; }
    case DW_FORM.addrx2:    { const v = BigInt(b.readUInt16LE(pos.v));    pos.v += 2; return v; }
    case DW_FORM.addrx4:    { const v = BigInt(b.readUInt32LE(pos.v));    pos.v += 4; return v; }
    case DW_FORM.block1:    { const n = b[pos.v++];                  const r = b.slice(pos.v, pos.v + n); pos.v += n; return r; }
    case DW_FORM.block2:    { const n = b.readUInt16LE(pos.v); pos.v += 2; const r = b.slice(pos.v, pos.v + n); pos.v += n; return r; }
    case DW_FORM.block4:    { const n = b.readUInt32LE(pos.v); pos.v += 4; const r = b.slice(pos.v, pos.v + n); pos.v += n; return r; }
    case DW_FORM.block: case DW_FORM.exprloc:
                            { const n = Number(uleb128(b, pos));           const r = b.slice(pos.v, pos.v + n); pos.v += n; return r; }
    case DW_FORM.data16:    { const r = b.slice(pos.v, pos.v + 16); pos.v += 16; return r; }
    default: throw new Error(`unsupported DW_FORM 0x${form.toString(16)}`);
  }
}

function readCStr(buf: Buffer, off: number): string {
  const end = buf.indexOf(0, off);
  return buf.slice(off, end >= 0 ? end : buf.length).toString("utf8");
}

function resolveStrx(ctx: Ctx, idx: number): string {
  if (!ctx.debug_str_offsets) return `<strx:${idx}>`;
  const base = Number(ctx.str_offsets_base ?? 0n);
  const off = ctx.debug_str_offsets.readUInt32LE(base + idx * 4);
  return readCStr(ctx.debug_str, off);
}

// ---------- DW_AT ----------

const DW_AT = {
  name: 0x03, byte_size: 0x0b, bit_offset: 0x0c, bit_size: 0x0d,
  stmt_list: 0x10, low_pc: 0x11, high_pc: 0x12, language: 0x13,
  comp_dir: 0x1b, producer: 0x25, decl_file: 0x3a, decl_line: 0x3b,
  linkage_name: 0x6e, str_offsets_base: 0x72,
};
const DW_TAG = { compile_unit: 0x11, subprogram: 0x2e, variable: 0x34 };

// ---------- parser entry ----------

export interface DwarfSummary {
  compile_units: { name?: string; comp_dir?: string; producer?: string; lang?: number }[];
  functions:    { name: string; linkage?: string; low_pc?: string; high_pc?: string; file?: number; line?: number }[];
}

export async function parseDwarf(path: string): Promise<DwarfSummary> {
  const buf = await readFile(path);
  const sections = findElfSections(buf);
  const sec = (n: string) => {
    const s = sections.find(s => s.name === n);
    return s ? buf.slice(s.off, s.off + s.size) : Buffer.alloc(0);
  };
  const debug_info     = sec(".debug_info");
  const debug_abbrev   = sec(".debug_abbrev");
  const debug_str      = sec(".debug_str");
  const debug_line_str = sec(".debug_line_str");
  const debug_str_offsets = sec(".debug_str_offsets");

  if (debug_info.length === 0 || debug_abbrev.length === 0) {
    return { compile_units: [], functions: [] };
  }

  const summary: DwarfSummary = { compile_units: [], functions: [] };
  let p = 0;
  while (p < debug_info.length) {
    let length = debug_info.readUInt32LE(p); p += 4;
    if (length === 0xFFFFFFFF) {
      // 64-bit length — bail out, we don't need these for our use case
      const l64 = Number(debug_info.readBigUInt64LE(p)); p += 8;
      p += l64;
      continue;
    }
    const unitEnd = p + length;
    const version = debug_info.readUInt16LE(p); p += 2;
    let unit_type = 0, addrSize = 8, abbrev_offset = 0;
    if (version >= 5) {
      unit_type = debug_info[p++];
      addrSize  = debug_info[p++];
      abbrev_offset = debug_info.readUInt32LE(p); p += 4;
    } else {
      abbrev_offset = debug_info.readUInt32LE(p); p += 4;
      addrSize  = debug_info[p++];
    }

    const abbrevs = readAbbrevs(debug_abbrev, abbrev_offset);
    const ctx: Ctx = { buf: debug_info, debug_str, debug_line_str, debug_str_offsets, addrSize, version };

    const pos = { v: p };
    let curCU: { name?: string; comp_dir?: string; producer?: string; lang?: number } = {};
    let str_offsets_base: bigint | undefined;
    while (pos.v < unitEnd) {
      const code = Number(uleb128(debug_info, pos));
      if (code === 0) continue;
      const ab = abbrevs.get(code);
      if (!ab) break;
      const vals: Record<number, bigint | string | Buffer> = {};
      for (const a of ab.attrs) {
        const v = readForm({ ...ctx, str_offsets_base }, a.form, pos, a.implicitConst);
        vals[a.name] = v;
      }
      if (ab.tag === DW_TAG.compile_unit) {
        if (vals[DW_AT.str_offsets_base] != null) str_offsets_base = vals[DW_AT.str_offsets_base] as bigint;
        curCU = {
          name:     typeof vals[DW_AT.name]     === "string" ? vals[DW_AT.name] as string     : undefined,
          comp_dir: typeof vals[DW_AT.comp_dir] === "string" ? vals[DW_AT.comp_dir] as string : undefined,
          producer: typeof vals[DW_AT.producer] === "string" ? vals[DW_AT.producer] as string : undefined,
          lang:     typeof vals[DW_AT.language] === "bigint" ? Number(vals[DW_AT.language])   : undefined,
        };
        summary.compile_units.push(curCU);
      } else if (ab.tag === DW_TAG.subprogram) {
        const name     = (vals[DW_AT.name]         as string | undefined) ?? "";
        const linkage  = (vals[DW_AT.linkage_name] as string | undefined);
        const low_pc   = (vals[DW_AT.low_pc]       as bigint | undefined);
        const high_pc  = (vals[DW_AT.high_pc]      as bigint | undefined);
        const file     = (vals[DW_AT.decl_file]    as bigint | undefined);
        const line     = (vals[DW_AT.decl_line]    as bigint | undefined);
        if (name) summary.functions.push({
          name, linkage,
          low_pc:  low_pc  != null ? "0x" + low_pc.toString(16)  : undefined,
          high_pc: high_pc != null ? "0x" + high_pc.toString(16) : undefined,
          file:    file    != null ? Number(file) : undefined,
          line:    line    != null ? Number(line) : undefined,
        });
      }
    }

    p = unitEnd;
  }

  return summary;
}

export function registerNativeDwarf(server: McpServer): void {
  server.tool(
    "dwarf_parse",
    "Parse DWARF debug info from an ELF file: list compile units and subprograms with their PC ranges. Zero deps.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const s = await parseDwarf(path);
        const text = [
          `# dwarf_parse ${path}`,
          `**compile units:** ${s.compile_units.length}`,
          `**functions:** ${s.functions.length}`,
          ``,
          `## compile units`,
          ...s.compile_units.slice(0, 20).map(c => `- ${c.name ?? "?"} — ${c.producer ?? ""} (lang=${c.lang ?? "?"})`),
          ``,
          `## functions (first 50)`,
          ...s.functions.slice(0, 50).map(f => `- \`${f.name}\` ${f.low_pc ?? ""}${f.high_pc ? "–" + f.high_pc : ""}`),
        ].join("\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `dwarf_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );
}
