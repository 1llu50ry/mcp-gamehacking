// ============================================================
// Chainable byte-decoder stack (CyberChef-light).
//
// A decoding operation is a {op, arg?} pair. A chain is an array of
// those applied in order. Example:
//    [{op:"base64"},{op:"xor",arg:"0x42"},{op:"zlib"}]
// is "base64-decode -> xor every byte with 0x42 -> inflate". Each
// step consumes `Uint8Array` and produces `Uint8Array` so arbitrary
// pipelines compose.
//
// Zero deps beyond node:zlib (included). The MCP tool takes either
// an inline hex / text input or a path to a file.
//
// Supported ops:
//   base64 / base64url / base32 / hex / url  — codec decoders
//   gzip / inflate / deflate_raw / br        — compression decoders
//   xor:<key>  add:<n>  sub:<n>              — byte transforms
//   rot:<n>                                  — ASCII rotate
//   reverse                                  — byte reverse
//   utf8 / utf16le                           — final text render
//   strings:<min>                            — extract printable runs
// ============================================================

import { z } from "zod";
import { readFile } from "node:fs/promises";
import { gunzipSync, inflateSync, inflateRawSync, brotliDecompressSync } from "node:zlib";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

type Step = { op: string; arg?: string };

function parseBytes(hex: string): Uint8Array {
  const toks = hex.replace(/\s|,/g, "").match(/[0-9a-fA-F]{2}/g) ?? [];
  return new Uint8Array(toks.map(h => parseInt(h, 16)));
}

function parseKeyBytes(arg: string): Uint8Array {
  // arg can be: 0xAA, hex string "AA BB CC", or UTF-8 "key"
  const s = arg.trim();
  if (/^0x[0-9a-fA-F]+$/.test(s)) return parseBytes(s.slice(2));
  if (/^[0-9a-fA-F ]+$/.test(s) && s.replace(/\s/g, "").length >= 2) return parseBytes(s);
  return new Uint8Array(Buffer.from(s, "utf8"));
}

const BASE32_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const bytes: number[] = [];
  let buffer = 0, bits = 0;
  for (const c of clean) {
    const v = BASE32_ALPHA.indexOf(c);
    if (v < 0) continue;
    buffer = (buffer << 5) | v;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xFF); }
  }
  return new Uint8Array(bytes);
}

export function applyStep(input: Uint8Array, step: Step): Uint8Array {
  const b = Buffer.from(input);
  switch (step.op) {
    case "base64":    return new Uint8Array(Buffer.from(b.toString("ascii"), "base64"));
    case "base64url": return new Uint8Array(Buffer.from(b.toString("ascii"), "base64url"));
    case "base32":    return base32Decode(b.toString("ascii"));
    case "hex":       return parseBytes(b.toString("ascii"));
    case "url":       return new Uint8Array(Buffer.from(decodeURIComponent(b.toString("binary")), "binary"));
    case "gzip":      return new Uint8Array(gunzipSync(b));
    case "inflate":   return new Uint8Array(inflateSync(b));
    case "deflate_raw": return new Uint8Array(inflateRawSync(b));
    case "br":        return new Uint8Array(brotliDecompressSync(b));
    case "reverse":   return new Uint8Array(b.reverse());
    case "xor": {
      if (!step.arg) throw new Error("xor needs an arg (0xAA, hex bytes, or utf-8 key)");
      const key = parseKeyBytes(step.arg);
      if (key.length === 0) throw new Error("xor: empty key");
      const out = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) out[i] = input[i] ^ key[i % key.length];
      return out;
    }
    case "add": case "sub": {
      const n = parseInt(step.arg ?? "0", 10) & 0xFF;
      const out = new Uint8Array(input.length);
      const sign = step.op === "add" ? 1 : -1;
      for (let i = 0; i < input.length; i++) out[i] = (input[i] + sign * n + 256) & 0xFF;
      return out;
    }
    case "rot": {
      const n = ((parseInt(step.arg ?? "13", 10) % 26) + 26) % 26;
      const out = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (c >= 0x41 && c <= 0x5A) out[i] = ((c - 0x41 + n) % 26) + 0x41;
        else if (c >= 0x61 && c <= 0x7A) out[i] = ((c - 0x61 + n) % 26) + 0x61;
        else out[i] = c;
      }
      return out;
    }
    // Encoding passes let callers emit text at the END of a chain and
    // re-feed the output back as a different byte layout.
    case "utf8":    return new Uint8Array(Buffer.from(b.toString("utf8"), "utf8"));
    case "utf16le": return new Uint8Array(Buffer.from(b.toString("utf16le"), "utf8"));
    case "strings": {
      const min = parseInt(step.arg ?? "4", 10);
      const parts: string[] = [];
      let run = "";
      for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (c >= 0x20 && c < 0x7F) run += String.fromCharCode(c);
        else { if (run.length >= min) parts.push(run); run = ""; }
      }
      if (run.length >= min) parts.push(run);
      return new Uint8Array(Buffer.from(parts.join("\n"), "utf8"));
    }
    default: throw new Error(`unknown decoder op: ${step.op}`);
  }
}

export function applyChain(input: Uint8Array, chain: Step[]): Uint8Array {
  let cur = input;
  for (const step of chain) cur = applyStep(cur, step);
  return cur;
}

function hexPreview(buf: Uint8Array, n: number): string {
  const slice = Array.from(buf.slice(0, n));
  const hex = slice.map(b => b.toString(16).padStart(2, "0")).join(" ");
  const asc = slice.map(b => (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : ".").join("");
  return `${hex}\n${asc}`;
}

export function registerNativeDecoder(server: McpServer): void {
  server.tool(
    "decode_chain",
    "Chainable byte-decoder (CyberChef-style). Ops: base64, base64url, base32, hex, url, gzip, inflate, deflate_raw, br, xor:<key>, add:<n>, sub:<n>, rot:<n>, reverse, utf8, utf16le, strings:<min>.",
    {
      input:  z.string().describe("inline input text/hex, OR file path when `inputKind=path`"),
      inputKind: z.enum(["text", "hex", "base64", "path"]).default("text"),
      chain: z.array(z.object({ op: z.string(), arg: z.string().optional() })),
      previewBytes: z.number().min(16).max(4096).default(256),
    },
    async ({ input, inputKind, chain, previewBytes }) => {
      let bytes: Uint8Array;
      if (inputKind === "text")        bytes = new Uint8Array(Buffer.from(input, "utf8"));
      else if (inputKind === "hex")    bytes = parseBytes(input);
      else if (inputKind === "base64") bytes = new Uint8Array(Buffer.from(input, "base64"));
      else { requirePathAllowed(input); bytes = new Uint8Array(await readFile(input)); }

      const out = applyChain(bytes, chain);
      const asText = Buffer.from(out).toString("utf8");
      const printable = /^[\x09\x0A\x0D\x20-\x7E\u0080-￿]*$/.test(asText);
      const text = [
        `# decode_chain`,
        `**input:** ${bytes.length} bytes  **output:** ${out.length} bytes  **chain:** ${chain.map(c => c.op + (c.arg ? ":" + c.arg : "")).join(" | ")}`,
        ``,
        `## hex (first ${Math.min(previewBytes, out.length)} B)`,
        "```",
        hexPreview(out, previewBytes),
        "```",
        printable && out.length <= 32_000 ? `\n## utf-8 render\n\`\`\`\n${asText.slice(0, 32_000)}\n\`\`\`` : "",
      ].filter(Boolean).join("\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
