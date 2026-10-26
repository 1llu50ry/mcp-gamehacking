// Native TS parsers for container / archive / CLR formats.
//   - ZIP central directory (works for ZIP, APK, AAB, JAR, DOCX, XPI, EPUB)
//   - APK AndroidManifest + v2/v3 signature block offset locator
//   - .NET CLR header + metadata root + streams
//   - Windows Catalog (.cat) PKCS#7 outer envelope (header level)

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

// ============================================================
// ZIP central directory parser (EOCD anchor at the tail)
// ============================================================

interface ZipEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export function parseZip(buf: Buffer): { entries: ZipEntry[]; comment: string; cdOffset: number; cdSize: number } {
  // Locate EOCD (end of central directory): 0x06054b50, within last 65k+22 bytes
  const EOCD = 0x06054b50;
  const EOCD64_LOCATOR = 0x07064b50;
  const start = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP (EOCD not found)");
  const nEntries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const commentLen = buf.readUInt16LE(eocd + 20);
  const comment = buf.slice(eocd + 22, eocd + 22 + commentLen).toString("utf8");

  // Zip64 enhancement if cdSize == 0xffffffff
  let effectiveCdOffset = cdOffset;
  let effectiveCdSize = cdSize;
  if (cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // find ZIP64 locator
    for (let i = eocd - 20; i >= start; i--) {
      if (buf.readUInt32LE(i) === EOCD64_LOCATOR) {
        const z64 = Number(buf.readBigUInt64LE(i + 8));
        if (buf.readUInt32LE(z64) === 0x06064b50) {
          effectiveCdSize = Number(buf.readBigUInt64LE(z64 + 40));
          effectiveCdOffset = Number(buf.readBigUInt64LE(z64 + 48));
        }
        break;
      }
    }
  }

  // Walk central directory
  const entries: ZipEntry[] = [];
  let p = effectiveCdOffset;
  for (let i = 0; i < nEntries && p < effectiveCdOffset + effectiveCdSize; i++) {
    const sig = buf.readUInt32LE(p);
    if (sig !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const crc32 = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({ name, method, crc32, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, comment, cdOffset: effectiveCdOffset, cdSize: effectiveCdSize };
}

// APK v2+ signature block sits before the EOCD. The block ends with magic
// "APK Sig Block 42". Return offset + size if present.
export function findApkSigningBlock(buf: Buffer): { offset: number; size: number } | null {
  const EOCD = 0x06054b50;
  const start = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset < 24) return null;
  const magic = buf.slice(cdOffset - 16, cdOffset).toString("ascii");
  if (magic !== "APK Sig Block 42") return null;
  const size = Number(buf.readBigUInt64LE(cdOffset - 24));
  return { offset: cdOffset - 8 - Number(size), size };
}

// ============================================================
// .NET CLR header + metadata root
// ============================================================

interface DotnetInfo {
  clrHeader: { cb: number; majorRuntime: number; minorRuntime: number; metadataRva: number; metadataSize: number; flags: number; entryPoint: number };
  metadata: { signature: string; majorVersion: number; minorVersion: number; versionString: string; streams: { name: string; offset: number; size: number }[] };
}

export function parseDotnet(buf: Buffer): DotnetInfo {
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error("Not a PE (and so not .NET)");
  const peOff = buf.readUInt32LE(0x3c);
  const optOff = peOff + 24;
  const magic = buf.readUInt16LE(optOff);
  const pePlus = magic === 0x20b;
  const ddOff = optOff + (pePlus ? 112 : 96);
  // CLR header is at data directory #14 (COM_DESCRIPTOR)
  const comRva = buf.readUInt32LE(ddOff + 14 * 8);
  const comSize = buf.readUInt32LE(ddOff + 14 * 8 + 4);
  if (!comRva || !comSize) throw new Error("No CLR header -- not a .NET assembly");
  // RVA -> file offset: walk section headers
  const nSec = buf.readUInt16LE(peOff + 6);
  const sizeOpt = buf.readUInt16LE(peOff + 20);
  const secOff = optOff + sizeOpt;
  const sections = Array.from({ length: nSec }, (_, i) => {
    const o = secOff + i * 40;
    return { va: buf.readUInt32LE(o + 12), vsize: buf.readUInt32LE(o + 8), rawPtr: buf.readUInt32LE(o + 20), rawSize: buf.readUInt32LE(o + 16) };
  });
  const toOff = (rva: number) => {
    for (const s of sections) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return s.rawPtr + (rva - s.va);
    return null;
  };
  const clrFileOff = toOff(comRva);
  if (clrFileOff == null) throw new Error("CLR header RVA not in any section");

  const clrHeader = {
    cb: buf.readUInt32LE(clrFileOff),
    majorRuntime: buf.readUInt16LE(clrFileOff + 4),
    minorRuntime: buf.readUInt16LE(clrFileOff + 6),
    metadataRva: buf.readUInt32LE(clrFileOff + 8),
    metadataSize: buf.readUInt32LE(clrFileOff + 12),
    flags: buf.readUInt32LE(clrFileOff + 16),
    entryPoint: buf.readUInt32LE(clrFileOff + 20),
  };

  const metaFileOff = toOff(clrHeader.metadataRva);
  if (metaFileOff == null) throw new Error("Metadata RVA not in any section");
  const signature = buf.readUInt32LE(metaFileOff);
  if (signature !== 0x424a5342 /* BSJB */) throw new Error("Metadata signature mismatch");
  const majorVersion = buf.readUInt16LE(metaFileOff + 4);
  const minorVersion = buf.readUInt16LE(metaFileOff + 6);
  const versionLen = buf.readUInt32LE(metaFileOff + 12);
  const versionString = buf.slice(metaFileOff + 16, metaFileOff + 16 + versionLen).toString("utf8").replace(/\0+$/, "");
  let p = metaFileOff + 16 + ((versionLen + 3) & ~3);
  // flags(2) + numStreams(2)
  p += 2;
  const numStreams = buf.readUInt16LE(p);
  p += 2;
  const streams: { name: string; offset: number; size: number }[] = [];
  for (let i = 0; i < numStreams; i++) {
    const offset = buf.readUInt32LE(p);
    const size = buf.readUInt32LE(p + 4);
    let e = p + 8;
    while (buf[e] !== 0) e++;
    const name = buf.slice(p + 8, e).toString("ascii");
    streams.push({ name, offset, size });
    p = (e + 4) & ~3;
  }
  return { clrHeader, metadata: { signature: "BSJB", majorVersion, minorVersion, versionString, streams } };
}

// ============================================================
// Catalog (.cat) PKCS#7 envelope sniff
// ============================================================

export function sniffCat(buf: Buffer): { signatureOID?: string; size: number; isPkcs7: boolean } {
  // Catalog is a PKCS#7 SignedData blob. ASN.1 outer SEQUENCE 0x30 then signed-data OID 1.2.840.113549.1.7.2
  if (buf[0] !== 0x30) return { size: buf.length, isPkcs7: false };
  // Scan for OID bytes
  const SIGNED_DATA_OID_BYTES = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
  const idx = buf.indexOf(SIGNED_DATA_OID_BYTES);
  const isPkcs7 = idx > 0 && idx < 64;
  return { signatureOID: isPkcs7 ? "1.2.840.113549.1.7.2 (signedData)" : undefined, size: buf.length, isPkcs7 };
}

// ============================================================
// MCP registration
// ============================================================

export function registerContainerParsers(server: McpServer): void {
  server.tool(
    "zip_parse",
    "Parse a ZIP-family archive (ZIP / JAR / APK / AAB / DOCX / XPI / EPUB). Returns the central directory entries: name, method, crc, sizes, local-header offset. Supports ZIP64.",
    { path: z.string(), maxEntries: z.number().min(1).max(100000).default(500) },
    async ({ path, maxEntries }: { path: string; maxEntries: number }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const z = parseZip(buf);
        const apk = findApkSigningBlock(buf);
        const lines = [`# ZIP: ${path}`, `- entries: ${z.entries.length}`, `- central dir: 0x${z.cdOffset.toString(16)} size 0x${z.cdSize.toString(16)}`, `- comment: ${z.comment || "(none)"}`];
        if (apk) lines.push(`- APK Signing Block: offset 0x${apk.offset.toString(16)} size 0x${apk.size.toString(16)}`);
        lines.push(``, `## entries (first ${maxEntries})`);
        for (const e of z.entries.slice(0, maxEntries)) {
          lines.push(`- ${e.name.padEnd(60)} method=${e.method} csize=${e.compressedSize} usize=${e.uncompressedSize} off=0x${e.localHeaderOffset.toString(16)}`);
        }
        if (z.entries.length > maxEntries) lines.push(`...(+${z.entries.length - maxEntries} more)`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `zip_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "apk_scan",
    "Convenience: run zip_parse and also report AndroidManifest.xml presence, META-INF signatures, DEX file list, native lib ABIs.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const z = parseZip(buf);
        const apk = findApkSigningBlock(buf);
        const hasManifest = z.entries.some((e) => e.name === "AndroidManifest.xml");
        const dexes = z.entries.filter((e) => e.name.endsWith(".dex")).map((e) => e.name);
        const nativeAbis = new Set<string>();
        for (const e of z.entries) {
          const m = /^lib\/([^/]+)\//.exec(e.name);
          if (m) nativeAbis.add(m[1]);
        }
        const metaInf = z.entries.filter((e) => e.name.startsWith("META-INF/")).map((e) => e.name);
        return {
          content: [{
            type: "text" as const,
            text: `# APK: ${path}\n- AndroidManifest.xml: ${hasManifest ? "present" : "MISSING"}\n- DEX files: ${dexes.join(", ") || "(none)"}\n- native ABIs: ${[...nativeAbis].join(", ") || "(none)"}\n- APK Sig Block v2+: ${apk ? "yes" : "no"}\n- META-INF: ${metaInf.join(", ")}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `apk_scan error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "dotnet_parse",
    "Parse a .NET assembly (PE with CLR header). Returns CLR header, metadata root, version string ('v4.0.30319'), and the stream table (#~, #Strings, #Blob, #GUID, #US).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const info = parseDotnet(buf);
        const lines = [
          `# .NET: ${path}`,
          `## CLR header`,
          `- cb=${info.clrHeader.cb}`,
          `- runtime v${info.clrHeader.majorRuntime}.${info.clrHeader.minorRuntime}`,
          `- metadata RVA=0x${info.clrHeader.metadataRva.toString(16)} size=0x${info.clrHeader.metadataSize.toString(16)}`,
          `- flags=0x${info.clrHeader.flags.toString(16)}`,
          `- entryPoint=0x${info.clrHeader.entryPoint.toString(16)}`,
          ``,
          `## Metadata`,
          `- signature=${info.metadata.signature}`,
          `- v${info.metadata.majorVersion}.${info.metadata.minorVersion} runtime=${info.metadata.versionString}`,
          `- streams:`,
          ...info.metadata.streams.map((s) => `  - ${s.name.padEnd(10)} offset=0x${s.offset.toString(16)} size=0x${s.size.toString(16)}`),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `dotnet_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "cat_sniff",
    "Sniff a Windows catalog (.cat) PKCS#7 envelope. Reports whether it looks like a valid SignedData blob.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const info = sniffCat(buf);
        return { content: [{ type: "text" as const, text: `# cat: ${path}\n- size=${info.size}\n- PKCS#7 SignedData: ${info.isPkcs7}${info.signatureOID ? `\n- OID: ${info.signatureOID}` : ""}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `cat_sniff error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );
}
