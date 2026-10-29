// ============================================================
// Native PDB (Microsoft MSF) parser — just enough to:
//   - read the Superblock (MSF header)
//   - read the stream directory
//   - locate the PDB Info (stream #1) and dump its GUID + age
//   - locate the DBI stream (#3) and list source modules + section contribs
//
// This is NOT a full symbol decoder; TPI/IPI/CodeView record streaming
// is out of scope. For "which function is at this address" use the
// DIA SDK or symsrv — see native-tool-clients.ts :: symsrv_download.
//
// What this is good for:
//   - verifying a PDB matches a PE (compare GUID + age against pe_debug_dir)
//   - listing the modules (object files) that contributed to the binary
//
// Zero deps.
// ============================================================

import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

const MSF_MAGIC = "Microsoft C/C++ MSF 7.00\r\n\x1aDS\x00\x00\x00";

interface PdbSuperblock {
  blockSize: number;
  numBlocks: number;
  numDirBytes: number;
  blockMapAddr: number;
}

export interface PdbSummary {
  blockSize: number;
  numBlocks: number;
  streams: number[];           // size per stream
  info?: { version: number; signature: number; age: number; guid: string };
  dbi?:  { machine: number; moduleCount: number; sectionCount: number; modules: { name: string; obj: string }[] };
}

function readSuperblock(buf: Buffer): PdbSuperblock {
  if (buf.toString("binary", 0, MSF_MAGIC.length) !== MSF_MAGIC) {
    throw new Error("not an MSF/PDB file");
  }
  return {
    blockSize:    buf.readUInt32LE(32),
    numBlocks:    buf.readUInt32LE(40),
    numDirBytes:  buf.readUInt32LE(44),
    blockMapAddr: buf.readUInt32LE(52),
  };
}

function blocksOf(buf: Buffer, blockMapAddr: number, blockSize: number, totalBytes: number, dirBlockMap: Buffer): Buffer {
  // dirBlockMap contains uint32[] of block indices for the directory stream
  const nBlocks = Math.ceil(totalBytes / blockSize);
  const parts: Buffer[] = [];
  for (let i = 0; i < nBlocks; i++) {
    const bi = dirBlockMap.readUInt32LE(i * 4);
    parts.push(buf.slice(bi * blockSize, (bi + 1) * blockSize));
  }
  return Buffer.concat(parts).slice(0, totalBytes);
}

function readStreamBlocks(dir: Buffer, offset: number, nBlocks: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < nBlocks; i++) out.push(dir.readUInt32LE(offset + i * 4));
  return out;
}

function assembleStream(buf: Buffer, blockSize: number, blocks: number[], size: number): Buffer {
  const parts: Buffer[] = [];
  for (const bi of blocks) parts.push(buf.slice(bi * blockSize, (bi + 1) * blockSize));
  return Buffer.concat(parts).slice(0, size);
}

function readGuid(buf: Buffer, off: number): string {
  const d1 = buf.readUInt32LE(off);
  const d2 = buf.readUInt16LE(off + 4);
  const d3 = buf.readUInt16LE(off + 6);
  const d4 = buf.slice(off + 8, off + 16);
  return `${d1.toString(16).padStart(8, "0")}-${d2.toString(16).padStart(4, "0")}-${d3.toString(16).padStart(4, "0")}-` +
         `${d4.slice(0, 2).toString("hex")}-${d4.slice(2, 8).toString("hex")}`;
}

export async function parsePdb(path: string): Promise<PdbSummary> {
  const buf = await readFile(path);
  const sb = readSuperblock(buf);

  // The directory itself is addressed by a block map at blockMapAddr; the block map holds
  // block indices for all directory bytes.
  const dirBlockMap = buf.slice(sb.blockMapAddr * sb.blockSize, sb.blockMapAddr * sb.blockSize + Math.ceil(sb.numDirBytes / sb.blockSize) * 4);
  const dir = blocksOf(buf, sb.blockMapAddr, sb.blockSize, sb.numDirBytes, dirBlockMap);

  let p = 0;
  const numStreams = dir.readUInt32LE(p); p += 4;
  const sizes: number[] = [];
  for (let i = 0; i < numStreams; i++) { sizes.push(dir.readUInt32LE(p)); p += 4; }
  const streamBlocks: number[][] = [];
  for (let i = 0; i < numStreams; i++) {
    const sz = sizes[i];
    const n = sz === 0xFFFFFFFF ? 0 : Math.ceil(sz / sb.blockSize);
    streamBlocks.push(readStreamBlocks(dir, p, n));
    p += n * 4;
  }

  const result: PdbSummary = { blockSize: sb.blockSize, numBlocks: sb.numBlocks, streams: sizes };

  // Stream 1 — PDB info
  if (sizes.length > 1 && streamBlocks[1].length > 0) {
    const s = assembleStream(buf, sb.blockSize, streamBlocks[1], sizes[1]);
    if (s.length >= 28) {
      result.info = {
        version:   s.readUInt32LE(0),
        signature: s.readUInt32LE(4),
        age:       s.readUInt32LE(8),
        guid:      readGuid(s, 12),
      };
    }
  }

  // Stream 3 — DBI (if present)
  if (sizes.length > 3 && streamBlocks[3].length > 0) {
    const s = assembleStream(buf, sb.blockSize, streamBlocks[3], sizes[3]);
    if (s.length >= 64) {
      const header = {
        machine:        s.readUInt16LE(48),
        gssymStream:    s.readInt16LE(16),  // dummy — we don't follow globals here
        modInfoSize:    s.readInt32LE(24),
        sectionContrSize: s.readInt32LE(28),
      };
      const modules: { name: string; obj: string }[] = [];
      let mp = 64; // start of ModInfo substream after the fixed DBI header
      const modEnd = mp + Math.max(0, header.modInfoSize);
      while (mp + 2 < Math.min(modEnd, s.length)) {
        // ModInfo layout: 64 fixed bytes, then two null-terminated names (module, object)
        if (mp + 64 > s.length) break;
        const nameStart = mp + 64;
        const n1 = s.indexOf(0, nameStart);
        if (n1 < 0 || n1 > modEnd) break;
        const module = s.slice(nameStart, n1).toString("utf8");
        const n2 = s.indexOf(0, n1 + 1);
        if (n2 < 0 || n2 > modEnd) break;
        const obj = s.slice(n1 + 1, n2).toString("utf8");
        modules.push({ name: module, obj });
        // round to 4
        let next = n2 + 1;
        next = (next + 3) & ~3;
        if (next <= mp) break;
        mp = next;
        if (modules.length > 10_000) break; // guard rail
      }
      result.dbi = {
        machine: header.machine,
        moduleCount: modules.length,
        sectionCount: Math.max(0, Math.floor(header.sectionContrSize / 28)),
        modules,
      };
    }
  }

  return result;
}

export function registerNativePdb(server: McpServer): void {
  server.tool(
    "pdb_info",
    "Read a Microsoft .pdb file natively: Superblock, PDB-Info stream (GUID/age), and DBI module list. Zero deps; no DIA SDK.",
    { path: z.string(), modulesLimit: z.number().min(1).max(5000).default(50) },
    async ({ path, modulesLimit }: { path: string; modulesLimit: number }) => {
      try {
        requirePathAllowed(path);
        const s = await parsePdb(path);
        const lines: string[] = [
          `# pdb_info ${path}`,
          `**block size:** ${s.blockSize}  **blocks:** ${s.numBlocks}  **streams:** ${s.streams.length}`,
        ];
        if (s.info) lines.push(``, `## PDB Info`, `- version: ${s.info.version}`, `- signature: 0x${s.info.signature.toString(16)}`, `- age: ${s.info.age}`, `- GUID: ${s.info.guid}`);
        if (s.dbi) {
          lines.push(``, `## DBI`, `- machine: 0x${s.dbi.machine.toString(16)}`, `- modules: ${s.dbi.moduleCount}`, `- section contribs: ${s.dbi.sectionCount}`, ``, `### modules (first ${modulesLimit})`);
          for (const m of s.dbi.modules.slice(0, modulesLimit)) lines.push(`- \`${m.name}\`  ← ${m.obj}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `pdb_info error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );
}
