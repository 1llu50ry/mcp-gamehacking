// ============================================================
// Native .pcap reader (classic libpcap + minimal pcapng).
//
// What it does:
//   - decode the file header (magic / endian / link type)
//   - walk every packet
//   - for Ethernet + IPv4 + TCP/UDP: extract 5-tuple + payload
//   - carve HTTP request lines, DNS query names, TLS SNI from
//     the payload of appropriate flows
//
// What it does NOT do:
//   - full TCP reassembly across packets (payload per packet only)
//   - decryption of TLS past the handshake
//   - IPv6 (left for a future pass; most malware C2 is IPv4 anyway)
//
// Zero deps.
// ============================================================

import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

interface Packet {
  ts: string;
  len: number;
  proto: "tcp" | "udp" | "other";
  src?: string;
  dst?: string;
  sport?: number;
  dport?: number;
  payload: Uint8Array;
}

const PCAP_MAGIC_LE = 0xA1B2C3D4;
const PCAP_MAGIC_BE = 0xD4C3B2A1;
const PCAP_NANO_LE  = 0xA1B23C4D;
const PCAPNG_SHB    = 0x0A0D0D0A;

function readIp(b: Buffer, off: number): string {
  return `${b[off]}.${b[off + 1]}.${b[off + 2]}.${b[off + 3]}`;
}

export function parsePcap(buf: Uint8Array): Packet[] {
  const b = Buffer.from(buf);
  if (b.length < 24) return [];
  const magic = b.readUInt32LE(0);
  if (magic === PCAPNG_SHB) return parsePcapNg(b);
  const le = magic === PCAP_MAGIC_LE || magic === PCAP_NANO_LE;
  if (!le && magic !== PCAP_MAGIC_BE) return [];
  const u16 = le ? "readUInt16LE" : "readUInt16BE";
  const u32 = le ? "readUInt32LE" : "readUInt32BE";
  const linkType = b[u32](20);
  if (linkType !== 1) return []; // we only decode Ethernet (DLT_EN10MB)

  const out: Packet[] = [];
  let p = 24;
  while (p + 16 <= b.length) {
    const ts_sec   = b[u32](p);
    const ts_usec  = b[u32](p + 4);
    const incl_len = b[u32](p + 8);
    p += 16;
    if (p + incl_len > b.length) break;
    const packet = b.subarray(p, p + incl_len);
    p += incl_len;
    const parsed = parseEthernet(packet, u16, le ? "readUInt16LE" : "readUInt16BE");
    if (parsed) out.push({ ts: new Date(ts_sec * 1000 + Math.floor(ts_usec / 1000)).toISOString(), len: incl_len, ...parsed });
  }
  return out;
}

function parsePcapNg(b: Buffer): Packet[] {
  // Minimum viable pcapng: walk blocks, decode EPB (type 6) and SPB (type 3).
  // Link type comes from the first IDB (type 1); default to 1 (Ethernet).
  const out: Packet[] = [];
  let p = 0;
  let linkType = 1;
  while (p + 8 <= b.length) {
    const blockType = b.readUInt32LE(p);
    const blockLen  = b.readUInt32LE(p + 4);
    if (blockLen < 12 || p + blockLen > b.length) break;
    if (blockType === 1) {
      // Interface Description Block: link type at +8, snaplen at +12
      if (p + 12 <= b.length) linkType = b.readUInt16LE(p + 8);
    } else if (blockType === 6 /* EPB */) {
      if (p + 32 > b.length) { p += blockLen; continue; }
      const incl = b.readUInt32LE(p + 20);
      const packet = b.subarray(p + 28, p + 28 + incl);
      const parsed = linkType === 1 ? parseEthernet(packet, "readUInt16LE", "readUInt16BE") : null;
      if (parsed) {
        const tsH = b.readUInt32LE(p + 12);
        const tsL = b.readUInt32LE(p + 16);
        const ts  = Number((BigInt(tsH) << 32n) | BigInt(tsL)) / 1e6;
        out.push({ ts: new Date(ts).toISOString(), len: incl, ...parsed });
      }
    } else if (blockType === 3 /* SPB */) {
      if (p + 16 > b.length) { p += blockLen; continue; }
      const incl = b.readUInt32LE(p + 8);
      const packet = b.subarray(p + 12, p + 12 + incl);
      const parsed = linkType === 1 ? parseEthernet(packet, "readUInt16LE", "readUInt16BE") : null;
      if (parsed) out.push({ ts: "", len: incl, ...parsed });
    }
    p += blockLen;
    if (blockLen % 4 !== 0) p += 4 - (blockLen % 4);
  }
  return out;
}

function parseEthernet(b: Buffer, _u16LE: "readUInt16LE" | "readUInt16BE", _u16BE: "readUInt16LE" | "readUInt16BE"): Omit<Packet, "ts" | "len"> | null {
  if (b.length < 14) return null;
  const etherType = b.readUInt16BE(12);
  if (etherType !== 0x0800) return null; // IPv4 only for now
  const ipHdr = 14;
  const ihl = (b[ipHdr] & 0x0F) * 4;
  if (ihl < 20 || ipHdr + ihl > b.length) return null;
  const proto = b[ipHdr + 9];
  const src = readIp(b, ipHdr + 12);
  const dst = readIp(b, ipHdr + 16);
  const totalLen = b.readUInt16BE(ipHdr + 2);
  const l4Start = ipHdr + ihl;
  const l4End   = Math.min(ipHdr + totalLen, b.length);
  if (proto === 6 /* TCP */) {
    if (l4Start + 20 > b.length) return null;
    const sport = b.readUInt16BE(l4Start);
    const dport = b.readUInt16BE(l4Start + 2);
    const dataOff = (b[l4Start + 12] >> 4) * 4;
    const payload = b.subarray(l4Start + dataOff, l4End);
    return { proto: "tcp", src, dst, sport, dport, payload: new Uint8Array(payload) };
  }
  if (proto === 17 /* UDP */) {
    if (l4Start + 8 > b.length) return null;
    const sport = b.readUInt16BE(l4Start);
    const dport = b.readUInt16BE(l4Start + 2);
    const payload = b.subarray(l4Start + 8, l4End);
    return { proto: "udp", src, dst, sport, dport, payload: new Uint8Array(payload) };
  }
  return { proto: "other", src, dst, payload: new Uint8Array() };
}

function carveHttp(packets: Packet[]): string[] {
  const out: string[] = [];
  for (const p of packets) {
    if (p.proto !== "tcp" || p.payload.length === 0) continue;
    const s = Buffer.from(p.payload).toString("binary").slice(0, 2000);
    const req = s.match(/^([A-Z]{3,7}) ([^ ]+) HTTP\/\d\.\d\r?\nHost: ([^\r\n]+)/);
    if (req) out.push(`${p.ts}  ${p.src}:${p.sport} → ${p.dst}:${p.dport}  ${req[1]} http://${req[3]}${req[2]}`);
  }
  return out;
}

function carveDns(packets: Packet[]): string[] {
  const out: string[] = [];
  for (const p of packets) {
    if (p.proto !== "udp" || (p.sport !== 53 && p.dport !== 53)) continue;
    const b = Buffer.from(p.payload);
    if (b.length < 12) continue;
    const qd = b.readUInt16BE(4);
    let off = 12;
    for (let i = 0; i < qd && off < b.length; i++) {
      const name: string[] = [];
      let safety = 0;
      while (off < b.length && b[off] !== 0 && safety++ < 64) {
        const n = b[off++];
        if ((n & 0xC0) === 0xC0) { off++; break; } // pointer
        if (off + n > b.length) break;
        name.push(b.subarray(off, off + n).toString("ascii"));
        off += n;
      }
      off++;
      if (off + 4 > b.length) break;
      const qType = b.readUInt16BE(off); off += 4;
      const t = qType === 1 ? "A" : qType === 28 ? "AAAA" : qType === 5 ? "CNAME" : qType === 16 ? "TXT" : `t${qType}`;
      if (name.length) out.push(`${p.ts}  ${p.src}:${p.sport} → ${p.dst}:${p.dport}  ${t} ${name.join(".")}`);
    }
  }
  return out;
}

function carveTlsSni(packets: Packet[]): string[] {
  const out: string[] = [];
  for (const p of packets) {
    if (p.proto !== "tcp" || p.payload.length < 50) continue;
    const b = Buffer.from(p.payload);
    // Expect TLS record: 0x16 (handshake), 0x03 0x01+, length. Inside:
    // handshake type 0x01 (ClientHello).
    if (b[0] !== 0x16 || b[5] !== 0x01) continue;
    // Skip: record header(5) + hs header(4) + legacy_version(2) + random(32)
    let off = 5 + 4 + 2 + 32;
    if (off + 1 > b.length) continue;
    off += 1 + b[off];                      // session id
    if (off + 2 > b.length) continue;
    off += 2 + b.readUInt16BE(off);         // cipher suites
    if (off + 1 > b.length) continue;
    off += 1 + b[off];                      // compression methods
    if (off + 2 > b.length) continue;
    const extLen = b.readUInt16BE(off); off += 2;
    const extEnd = Math.min(off + extLen, b.length);
    while (off + 4 <= extEnd) {
      const type = b.readUInt16BE(off);
      const len  = b.readUInt16BE(off + 2);
      if (type === 0 /* server_name */) {
        if (off + 4 + 5 > extEnd) break;
        const sniLen = b.readUInt16BE(off + 4 + 3);
        const name   = b.subarray(off + 4 + 5, off + 4 + 5 + sniLen).toString("ascii");
        out.push(`${p.ts}  ${p.src}:${p.sport} → ${p.dst}:${p.dport}  SNI ${name}`);
        break;
      }
      off += 4 + len;
    }
  }
  return out;
}

export function registerNativePcap(server: McpServer): void {
  server.tool(
    "pcap_summary",
    "Parse a .pcap or minimal .pcapng (Ethernet + IPv4 + TCP/UDP) and return per-packet 5-tuples + a count by protocol.",
    { path: z.string(), limit: z.number().min(1).max(100_000).default(200) },
    async ({ path, limit }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const packets = parsePcap(new Uint8Array(buf));
      const tally = packets.reduce((acc, p) => { acc[p.proto] = (acc[p.proto] ?? 0) + 1; return acc; }, {} as Record<string, number>);
      const shown = packets.slice(0, limit);
      return { content: [{ type: "text" as const, text:
        `# pcap_summary ${path}\n\n**total:** ${packets.length}  (${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(", ")})\n\n` +
        shown.map(p => `- ${p.ts}  ${p.proto} ${p.src}:${p.sport ?? "-"} → ${p.dst}:${p.dport ?? "-"}  len=${p.len}`).join("\n")
      }] };
    });

  server.tool(
    "pcap_http",
    "Extract HTTP request lines (method + Host: + path) from a PCAP's TCP payloads.",
    { path: z.string(), limit: z.number().min(1).max(10_000).default(500) },
    async ({ path, limit }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const lines = carveHttp(parsePcap(new Uint8Array(buf)));
      return { content: [{ type: "text" as const, text: `# pcap_http ${path}\n\n**requests:** ${lines.length}\n\n${lines.slice(0, limit).join("\n")}` }] };
    });

  server.tool(
    "pcap_dns",
    "Extract DNS queries (names + type) from a PCAP's UDP :53 payloads.",
    { path: z.string(), limit: z.number().min(1).max(10_000).default(500) },
    async ({ path, limit }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const lines = carveDns(parsePcap(new Uint8Array(buf)));
      return { content: [{ type: "text" as const, text: `# pcap_dns ${path}\n\n**queries:** ${lines.length}\n\n${lines.slice(0, limit).join("\n")}` }] };
    });

  server.tool(
    "pcap_tls_sni",
    "Extract Server Name Indication (SNI) from TLS ClientHello packets in a PCAP.",
    { path: z.string(), limit: z.number().min(1).max(10_000).default(500) },
    async ({ path, limit }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const lines = carveTlsSni(parsePcap(new Uint8Array(buf)));
      return { content: [{ type: "text" as const, text: `# pcap_tls_sni ${path}\n\n**SNIs:** ${lines.length}\n\n${lines.slice(0, limit).join("\n")}` }] };
    });
}
