// ============================================================
// Native ReClass.NET project parser → C/C++ header emitter.
//
// ReClass.NET writes classes as XML. Format highlights (observed in
// stock files + the vendored ReClass.NET-MCP source):
//
//   <reclass version="x.y">
//     <custom_data>...</custom_data>
//     <classes>
//       <class name="CMyClass" uuid="..." address_formula="..." comment="">
//         <node type="Hex64" name="pNext"       offset="0x00" comment=""/>
//         <node type="UTF8Text" name="szName"   offset="0x08" length="32"/>
//         <node type="Array"   name="children"  offset="0x30"
//               type_count="8" class_uuid="..."/>
//         <node type="ClassPtr" name="pOwner"   offset="0x40" class_uuid="..."/>
//       </class>
//     </classes>
//   </reclass>
//
// We don't try to render every node kind — just the common ones that
// show up in game-RE projects: Hex8/16/32/64, Int*, UInt*, Float, Double,
// Vector*, Matrix*, Utf8Text, Utf16Text, Bool, FunctionPtr, ClassPtr,
// ClassInstance, Array.
//
// Output: a C header with `#pragma pack(push, 1)` + inline accessors.
// ============================================================

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

interface ReclassNode {
  type: string;
  name: string;
  offset: number;
  length?: number;
  typeCount?: number;
  classUuid?: string;
  comment?: string;
}

interface ReclassClass {
  name: string;
  uuid: string;
  comment?: string;
  nodes: ReclassNode[];
}

export function parseReclassProject(xml: string): ReclassClass[] {
  // Minimal XML parser — enough for ReClass.NET's layout.
  const classes: ReclassClass[] = [];
  const classRe = /<class\s+([^>]+)>([\s\S]*?)<\/class>/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(xml)) != null) {
    const attrs = parseAttrs(m[1]);
    const body = m[2];
    const nodes: ReclassNode[] = [];
    const nodeRe = /<node\s+([^/]+)\/>/g;
    let nm: RegExpExecArray | null;
    while ((nm = nodeRe.exec(body)) != null) {
      const a = parseAttrs(nm[1]);
      nodes.push({
        type: a.type ?? "Hex8",
        name: a.name ?? `field_${nodes.length}`,
        offset: Number(a.offset ?? "0") || parseInt(a.offset ?? "0", 16) || 0,
        length: a.length ? Number(a.length) : undefined,
        typeCount: a.type_count ? Number(a.type_count) : undefined,
        classUuid: a.class_uuid,
        comment: a.comment,
      });
    }
    nodes.sort((a, b) => a.offset - b.offset);
    classes.push({
      name: attrs.name ?? "Unnamed",
      uuid: attrs.uuid ?? "",
      comment: attrs.comment,
      nodes,
    });
  }
  return classes;
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) != null) out[m[1]] = m[2];
  return out;
}

const TYPE_MAP: Record<string, { c: string; size: number } | null> = {
  Hex8:      { c: "uint8_t",  size: 1 },
  Hex16:     { c: "uint16_t", size: 2 },
  Hex32:     { c: "uint32_t", size: 4 },
  Hex64:     { c: "uint64_t", size: 8 },
  Int8:      { c: "int8_t",   size: 1 },
  Int16:     { c: "int16_t",  size: 2 },
  Int32:     { c: "int32_t",  size: 4 },
  Int64:     { c: "int64_t",  size: 8 },
  UInt8:     { c: "uint8_t",  size: 1 },
  UInt16:    { c: "uint16_t", size: 2 },
  UInt32:    { c: "uint32_t", size: 4 },
  UInt64:    { c: "uint64_t", size: 8 },
  Float:     { c: "float",    size: 4 },
  Double:    { c: "double",   size: 8 },
  Bool:      { c: "bool",     size: 1 },
  Vector2:   { c: "float",    size: 8 },   // 2 * 4
  Vector3:   { c: "float",    size: 12 },  // 3 * 4
  Vector4:   { c: "float",    size: 16 },  // 4 * 4
  Matrix3x3: { c: "float",    size: 36 },
  Matrix3x4: { c: "float",    size: 48 },
  Matrix4x4: { c: "float",    size: 64 },
  FunctionPtr: { c: "void*",  size: 8 },
  ClassPtr:  { c: "void*",    size: 8 },
};

export function emitHeader(classes: ReclassClass[], ns: string): string {
  const lines: string[] = [];
  lines.push("// Generated from ReClass.NET project. Do not edit by hand.");
  lines.push("#pragma once");
  lines.push("#include <cstdint>");
  lines.push("#include <cstddef>");
  lines.push("");
  if (ns) { lines.push(`namespace ${ns} {`); lines.push(""); }
  // Forward decls so ClassPtr references work regardless of order.
  for (const c of classes) lines.push(`struct ${c.name};`);
  lines.push("");
  for (const c of classes) {
    lines.push(`#pragma pack(push, 1)`);
    lines.push(`struct ${c.name} {`);
    let cursor = 0;
    for (const n of c.nodes) {
      if (n.offset > cursor) {
        lines.push(`    uint8_t _pad_${cursor.toString(16)}[0x${(n.offset - cursor).toString(16)}];`);
      }
      cursor = n.offset;
      const line = renderNode(n, classes);
      lines.push(`    ${line}   // 0x${n.offset.toString(16)}${n.comment ? "  // " + n.comment : ""}`);
      cursor += sizeOfNode(n);
    }
    lines.push(`};`);
    lines.push(`#pragma pack(pop)`);
    lines.push("");
  }
  if (ns) lines.push(`} // namespace ${ns}`);
  return lines.join("\n");
}

function renderNode(n: ReclassNode, classes: ReclassClass[]): string {
  if (n.type === "Utf8Text")  return `char     ${n.name}[${n.length ?? 32}];`;
  if (n.type === "Utf16Text") return `wchar_t  ${n.name}[${n.length ?? 32}];`;
  if (n.type === "Array") {
    const targetCls = classes.find((c) => c.uuid === n.classUuid);
    const t = targetCls?.name ?? "uint8_t";
    return `${t}  ${n.name}[${n.typeCount ?? 1}];`;
  }
  if (n.type === "ClassInstance") {
    const targetCls = classes.find((c) => c.uuid === n.classUuid);
    const t = targetCls?.name ?? "uint8_t[8]";
    return `${t}  ${n.name};`;
  }
  if (n.type === "ClassPtr") {
    const targetCls = classes.find((c) => c.uuid === n.classUuid);
    const t = targetCls?.name ?? "void";
    return `${t}* ${n.name};`;
  }
  if (n.type === "Vector2") return `float ${n.name}[2];`;
  if (n.type === "Vector3") return `float ${n.name}[3];`;
  if (n.type === "Vector4") return `float ${n.name}[4];`;
  const m = TYPE_MAP[n.type];
  if (m) return `${m.c} ${n.name};`;
  return `uint8_t ${n.name};   // unknown reclass type: ${n.type}`;
}

function sizeOfNode(n: ReclassNode): number {
  if (n.type === "Utf8Text")  return n.length ?? 32;
  if (n.type === "Utf16Text") return (n.length ?? 32) * 2;
  if (n.type === "Array" || n.type === "ClassInstance") {
    const m = TYPE_MAP[n.type];
    return m ? m.size * (n.typeCount ?? 1) : (n.typeCount ?? 1);
  }
  const m = TYPE_MAP[n.type];
  return m?.size ?? 1;
}

export function registerNativeReclass(server: McpServer): void {
  server.tool(
    "reclass_parse",
    "Parse a ReClass.NET project (.rcnet / .reclass XML) and return the class list + node layout.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const xml = await readFile(path, "utf8");
        const classes = parseReclassProject(xml);
        const lines = [`# reclass_parse ${path}`, `classes: ${classes.length}`, ``];
        for (const c of classes) {
          lines.push(`## ${c.name}  (uuid=${c.uuid})${c.comment ? "  — " + c.comment : ""}`);
          for (const n of c.nodes) {
            lines.push(`  0x${n.offset.toString(16).padStart(4, "0")}  ${n.type.padEnd(14)} ${n.name}${n.length ? ` [${n.length}]` : ""}${n.typeCount ? ` [count=${n.typeCount}]` : ""}`);
          }
          lines.push("");
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `reclass_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "reclass_to_cpp",
    "Emit a C/C++ header from a ReClass.NET project. Produces `#pragma pack(push,1)` struct { ... } blocks with offset comments, forward declarations, pad bytes between offsets, and ClassPtr forwarding resolved by uuid.",
    { path: z.string(), namespace: z.string().default("sdk") },
    async ({ path, namespace }: { path: string; namespace: string }) => {
      try {
        requirePathAllowed(path);
        const xml = await readFile(path, "utf8");
        const classes = parseReclassProject(xml);
        const header = emitHeader(classes, namespace);
        return { content: [{ type: "text" as const, text: header }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `reclass_to_cpp error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );
}
