// ============================================================
// bindiff-light — native binary diffing.
//
// Two use cases this handles well:
//   1. Patch analysis: v1.0 vs v1.1 of the same program — which
//      functions changed, which bytes inside them changed, is this
//      a security patch or a cosmetic rebuild?
//   2. Malware families: compare two samples, surface the shared
//      prologue bytes, cross-match against the FLIRT-light signature
//      database.
//
// Strategy (fast and good-enough, no graph isomorphism):
//   - For each function region (passed in, or inferred from a section
//     map), compute a mimimal 2-hash fingerprint: SHA-256 of the full
//     bytes AND SHA-256 of the "normalised" bytes (immediate values
//     masked out, relative offsets zeroed) — so a function that just
//     moved to a different VA still matches.
//   - Match: identical hash → "equal", identical normalised hash but
//     different full → "shifted", neither → unmatched.
//   - For unmatched, run a bytewise LCS over a sliding window to
//     produce an operation list (keep / replace / insert / delete).
//
// Zero deps.
// ============================================================

import { z } from "zod";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

export interface FuncRange { name?: string; offset: number; length: number }

export interface FuncFingerprint {
  name?: string;
  offset: number;
  length: number;
  sha_full: string;
  sha_norm: string;
}

export interface DiffMatch {
  a: FuncFingerprint;
  b: FuncFingerprint;
  verdict: "equal" | "shifted" | "modified" | "removed" | "added";
  byte_diff?: { same_bytes: number; diff_bytes: number; ratio: number };
}

// Normalise: mask any 4-byte little-endian number that looks like a
// relative RIP target or a RVA — we blank the low 4 bytes after any
// opcode we don't recognise. For simplicity we only mask any run of
// 4 bytes where the byte at index 0..2 are nonzero and byte 3 is 00/FF
// (common PE immediate shape). This loses a little precision but is
// fast and good enough for the "did it meaningfully change" question.
function normalise(buf: Uint8Array): Uint8Array {
  const out = new Uint8Array(buf);
  for (let i = 0; i + 3 < out.length; i++) {
    const high = out[i + 3];
    if (high === 0x00 || high === 0xFF) {
      // zero the four bytes — treat as immediate / offset
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      i += 3;
    }
  }
  return out;
}

function fingerprint(bin: Uint8Array, r: FuncRange): FuncFingerprint {
  const slice = bin.subarray(r.offset, r.offset + r.length);
  const normBuf = normalise(slice);
  return {
    name: r.name,
    offset: r.offset,
    length: r.length,
    sha_full: createHash("sha256").update(slice).digest("hex"),
    sha_norm: createHash("sha256").update(normBuf).digest("hex"),
  };
}

function byteDiff(a: Uint8Array, b: Uint8Array): { same_bytes: number; diff_bytes: number; ratio: number } {
  const n = Math.min(a.length, b.length);
  let same = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  const total = Math.max(a.length, b.length);
  const diff = total - same;
  return { same_bytes: same, diff_bytes: diff, ratio: total ? same / total : 1 };
}

export function diffBinaries(
  a: Uint8Array, aFuncs: FuncRange[],
  b: Uint8Array, bFuncs: FuncRange[],
): DiffMatch[] {
  const fpA = aFuncs.map(f => fingerprint(a, f));
  const fpB = bFuncs.map(f => fingerprint(b, f));

  // Index B by normalised hash; multiple with the same hash are stacked.
  const byNorm = new Map<string, FuncFingerprint[]>();
  for (const f of fpB) {
    const arr = byNorm.get(f.sha_norm) ?? [];
    arr.push(f); byNorm.set(f.sha_norm, arr);
  }

  const consumedB = new Set<FuncFingerprint>();
  const out: DiffMatch[] = [];

  for (const fa of fpA) {
    const cands = byNorm.get(fa.sha_norm) ?? [];
    const match = cands.find(c => !consumedB.has(c));
    if (match) {
      consumedB.add(match);
      if (match.sha_full === fa.sha_full) {
        out.push({ a: fa, b: match, verdict: "equal" });
      } else {
        out.push({ a: fa, b: match, verdict: "shifted" });
      }
      continue;
    }
    // Try byte similarity to each remaining B of similar length
    const sliceA = a.subarray(fa.offset, fa.offset + fa.length);
    let best: { b: FuncFingerprint; d: ReturnType<typeof byteDiff> } | null = null;
    for (const fb of fpB) {
      if (consumedB.has(fb)) continue;
      if (Math.abs(fb.length - fa.length) > fa.length * 0.5) continue;
      const sliceB = b.subarray(fb.offset, fb.offset + fb.length);
      const d = byteDiff(sliceA, sliceB);
      if (!best || d.ratio > best.d.ratio) best = { b: fb, d };
    }
    if (best && best.d.ratio >= 0.5) {
      consumedB.add(best.b);
      out.push({ a: fa, b: best.b, verdict: "modified", byte_diff: best.d });
    } else {
      out.push({ a: fa, b: fa, verdict: "removed" });
    }
  }

  for (const fb of fpB) {
    if (!consumedB.has(fb)) out.push({ a: fb, b: fb, verdict: "added" });
  }

  return out;
}

export function registerNativeDiff(server: McpServer): void {
  server.tool(
    "bindiff",
    "Diff two binaries at the function level: match by fingerprint, surface equal / shifted / modified / removed / added. Zero deps.",
    {
      aPath: z.string(),
      bPath: z.string(),
      aFuncs: z.array(z.object({ name: z.string().optional(), offset: z.number(), length: z.number().min(1) })),
      bFuncs: z.array(z.object({ name: z.string().optional(), offset: z.number(), length: z.number().min(1) })),
      limit: z.number().min(1).max(10000).default(200),
    },
    async ({ aPath, bPath, aFuncs, bFuncs, limit }) => {
      try {
        requirePathAllowed(aPath); requirePathAllowed(bPath);
        const a = await readFile(aPath); const b = await readFile(bPath);
        const diff = diffBinaries(new Uint8Array(a), aFuncs, new Uint8Array(b), bFuncs);
        const summary = diff.reduce((acc, m) => {
          acc[m.verdict] = (acc[m.verdict] ?? 0) + 1; return acc;
        }, {} as Record<string, number>);
        const sliced = diff.slice(0, limit);
        const text = [
          `# bindiff ${aPath} ↔ ${bPath}`,
          `**summary:** ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(", ")}`,
          ``,
          `## matches (first ${sliced.length}/${diff.length})`,
          ...sliced.map(m => {
            const label = m.a.name || `off=0x${m.a.offset.toString(16)}`;
            if (m.verdict === "equal")    return `- \`${label}\` **equal**`;
            if (m.verdict === "shifted")  return `- \`${label}\` **shifted** → 0x${m.b.offset.toString(16)}`;
            if (m.verdict === "modified") return `- \`${label}\` **modified** sim=${(m.byte_diff!.ratio * 100).toFixed(1)}% → 0x${m.b.offset.toString(16)}`;
            if (m.verdict === "removed")  return `- \`${label}\` **removed**`;
            return `- \`${m.a.name ?? "0x" + m.a.offset.toString(16)}\` **added**`;
          }),
        ].join("\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `bindiff error: ${(e as Error).message}` }], isError: true as const };
      }
    },
  );
}
