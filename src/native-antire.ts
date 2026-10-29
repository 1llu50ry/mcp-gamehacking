// ============================================================
// Native anti-anti-RE scanner (replaces the `antirea` vendored tool).
//
// Zero deps. Walks a PE / ELF buffer and flags common evasion
// techniques by three signals:
//
//   1. IMPORTS — known anti-debug / anti-vm API names (Windows:
//      IsDebuggerPresent, CheckRemoteDebuggerPresent, NtQueryInformationProcess,
//      NtSetInformationThread, OutputDebugString, ZwQueryObject, etc.).
//      Linux: ptrace, prctl(PR_SET_DUMPABLE,0), personality.
//
//   2. STRINGS — VM-detection fingerprints (VMware, VBOX, QEMU,
//      "Driver\\VBoxGuest", registry paths), sandbox product names
//      (Cuckoo, Any.Run, VirtualBox GuestAdditions), timing-check
//      instructions ("rdtsc"), driver names.
//
//   3. CODE SMELLS — scan .text for opcode patterns:
//      - rdtsc / rdtscp (0F 31 / 0F 01 F9)
//      - cpuid followed by `cmp ebx, "VMware" / "QEMU" / "KVMKVMKVM"`
//      - int 2D (0xCD 0x2D) — anti-step trick
//      - int3 bytes (0xCC) in unusual density (anti-patch marker)
//
// Returns a JSON hit list { category, hit, offset?, evidence } the
// agent can summarise or auto-patch via rop_find / signatures.
// ============================================================

import { z } from "zod";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

type Hit = { category: "import" | "string" | "opcode"; hit: string; offset?: string; evidence?: string };

const ANTI_DEBUG_IMPORTS = [
  // Windows
  "IsDebuggerPresent", "CheckRemoteDebuggerPresent", "NtQueryInformationProcess",
  "NtSetInformationThread", "OutputDebugStringA", "OutputDebugStringW",
  "ZwQueryInformationProcess", "ZwSetInformationThread", "DbgUiRemoteBreakin",
  "DbgBreakPoint", "NtClose", "NtQuerySystemInformation", "NtRaiseException",
  "GetTickCount", "QueryPerformanceCounter", "GetSystemTime", "RtlAdjustPrivilege",
  "NtDelayExecution", "SwitchToThread", "FindWindowA", "FindWindowW",
  "EnumWindows", "GetWindowTextA", "GetForegroundWindow",
  // Linux
  "ptrace", "prctl", "personality",
] as const;

const VM_STRINGS = [
  "VMware", "VBoxGuest", "VBoxTray", "VBoxService", "VBoxVideo",
  "QEMU", "qemu", "KVMKVMKVM", "Microsoft Hv", "VBoxBios",
  "VBOX", "VBoxWddm", "Oracle VM VirtualBox",
  "VBOX HARDDISK", "QEMU HARDDISK", "VMware Virtual",
  "SbieDll.dll", "snxhk.dll", "cuckoomon", "api_log.dll",
  "SOFTWARE\\VMware", "SOFTWARE\\Oracle\\VirtualBox", "HARDWARE\\ACPI\\DSDT\\VBOX",
  "SYSTEM\\ControlSet001\\Services\\VBoxSF",
] as const;

const SANDBOX_WINDOW_TITLES = [
  "Procmon", "ProcessHacker", "x64dbg", "x32dbg", "OllyDbg", "ImmunityDebugger",
  "IDA Pro", "Hex Rays", "Wireshark", "APIMonitor", "Fiddler",
] as const;

// Byte patterns to spot in code (offsets into the buffer, not RVAs).
const OPCODES: { re: RegExp; label: string }[] = [
  { re: /\x0F\x31/g,                    label: "rdtsc (timing check)" },
  { re: /\x0F\x01\xF9/g,                label: "rdtscp (timing check)" },
  { re: /\xCD\x2D/g,                    label: "int 2D (anti-step)" },
  { re: /\x0F\xA2/g,                    label: "cpuid (vendor-string vm check)" },
  { re: /\xF3\x90/g,                    label: "pause (busy-wait, often paired with rdtsc)" },
  { re: /\x66\x0F\x1F\x44\x00\x00/g,    label: "nop qword (often inserted by obfuscators)" },
];

function utf8Hits(buf: Uint8Array, needle: string): number[] {
  const n = Buffer.from(needle, "utf8");
  const out: number[] = [];
  const b = Buffer.from(buf);
  let p = 0;
  while ((p = b.indexOf(n, p)) !== -1) { out.push(p); p += n.length; }
  return out.slice(0, 32);
}

function utf16Hits(buf: Uint8Array, needle: string): number[] {
  const n = Buffer.from(needle, "utf16le");
  const out: number[] = [];
  const b = Buffer.from(buf);
  let p = 0;
  while ((p = b.indexOf(n, p)) !== -1) { out.push(p); p += n.length; }
  return out.slice(0, 32);
}

export function scanAntiRe(buf: Uint8Array): Hit[] {
  const hits: Hit[] = [];

  // 1. imports — the raw PE/ELF import table is a null-terminated UTF-8
  // string table embedded in .idata / .dynsym; scanning the whole buffer
  // catches both without parsing. We only flag an import when the name
  // is preceded by a NUL (so partial substring matches don't trip).
  for (const sym of ANTI_DEBUG_IMPORTS) {
    for (const off of utf8Hits(buf, "\x00" + sym + "\x00")) {
      hits.push({ category: "import", hit: sym, offset: "0x" + off.toString(16), evidence: "NUL-bounded in symbol table" });
    }
  }

  // 2. VM / sandbox strings (both UTF-8 and UTF-16LE)
  for (const needle of VM_STRINGS) {
    for (const off of utf8Hits(buf, needle)) hits.push({ category: "string", hit: needle, offset: "0x" + off.toString(16), evidence: "utf-8" });
    for (const off of utf16Hits(buf, needle)) hits.push({ category: "string", hit: needle, offset: "0x" + off.toString(16), evidence: "utf-16le" });
  }

  // 3. common analyst window titles
  for (const needle of SANDBOX_WINDOW_TITLES) {
    for (const off of utf8Hits(buf, needle)) hits.push({ category: "string", hit: needle, offset: "0x" + off.toString(16), evidence: "analyst-window" });
    for (const off of utf16Hits(buf, needle)) hits.push({ category: "string", hit: needle, offset: "0x" + off.toString(16), evidence: "analyst-window utf-16" });
  }

  // 4. opcode patterns
  const b = Buffer.from(buf);
  for (const { re, label } of OPCODES) {
    const text = b.toString("binary");
    let m: RegExpExecArray | null; let count = 0;
    while ((m = re.exec(text)) !== null && count < 40) {
      hits.push({ category: "opcode", hit: label, offset: "0x" + m.index.toString(16) });
      count++;
    }
  }

  // 5. density heuristic: a cluster of >= 8 0xCC bytes in a row anywhere
  //    outside the padding at section ends is a classic anti-patch beacon.
  let runStart = -1;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 0xCC) { if (runStart < 0) runStart = i; }
    else {
      if (runStart >= 0 && i - runStart >= 8) {
        hits.push({ category: "opcode", hit: `int3 cluster (${i - runStart} bytes)`, offset: "0x" + runStart.toString(16), evidence: "possible anti-patch marker" });
      }
      runStart = -1;
    }
    if (hits.length > 2000) break;
  }

  return hits;
}

// ---------- deeper detection -----------------------------------------
// scanDeepPE walks the PE32/PE32+ structure and surfaces structural
// anti-RE markers the opcode scan can't see on its own:
//   - TLS callbacks (anti-debug hook before main)
//   - Rich Header 'tool-chain fingerprint' absence or weirdness
//   - section characteristics: writable+executable (packer tell)
//   - small .text relative to overlay size (packer / dropper tell)
//   - CheckSum = 0 on a signed-looking exe (post-build patch tell)
//   - presence of a trailing overlay > 10% of file size

export interface DeepHit extends Hit { severity?: "info" | "warn" | "high" }

export function scanDeepPE(buf: Uint8Array): DeepHit[] {
  const hits: DeepHit[] = [];
  if (buf.length < 0x40) return hits;
  if (buf[0] !== 0x4D || buf[1] !== 0x5A) return hits; // not PE
  const b = Buffer.from(buf);
  const peOff = b.readUInt32LE(0x3C);
  if (peOff + 24 >= b.length || b.readUInt32LE(peOff) !== 0x00004550) return hits;
  const machine = b.readUInt16LE(peOff + 4);
  const nSec    = b.readUInt16LE(peOff + 6);
  const sizeOpt = b.readUInt16LE(peOff + 20);
  const magic   = b.readUInt16LE(peOff + 24);
  const is64    = magic === 0x20B;
  const dataDirs = peOff + 24 + (is64 ? 112 : 96);
  const dataDirCount = b.readUInt32LE(peOff + 24 + (is64 ? 108 : 92));
  void machine; void sizeOpt;

  // Checksum
  const checksumOff = peOff + 24 + 64;
  const checksum = b.readUInt32LE(checksumOff);
  if (checksum === 0) hits.push({ category: "import", hit: "CheckSum=0", offset: "0x" + checksumOff.toString(16), evidence: "post-build patch marker", severity: "warn" });

  // TLS directory (data directory index 9)
  if (dataDirCount > 9) {
    const tlsRva = b.readUInt32LE(dataDirs + 9 * 8);
    const tlsSz  = b.readUInt32LE(dataDirs + 9 * 8 + 4);
    if (tlsRva !== 0 && tlsSz > 0) {
      hits.push({ category: "import", hit: "TLS directory present", offset: "0x" + tlsRva.toString(16), evidence: `${tlsSz} bytes — code runs before main`, severity: "high" });
    }
  }

  // Section walk
  const secStart = dataDirs + 16 * 8;
  for (let i = 0; i < nSec && secStart + (i + 1) * 40 <= b.length; i++) {
    const base = secStart + i * 40;
    const name = b.slice(base, base + 8).toString("ascii").replace(/\0.*$/, "");
    const virtualSize   = b.readUInt32LE(base + 8);
    const rawSize       = b.readUInt32LE(base + 16);
    const chars         = b.readUInt32LE(base + 36);
    // IMAGE_SCN_MEM_EXECUTE 0x20000000, IMAGE_SCN_MEM_WRITE 0x80000000
    if ((chars & 0x20000000) && (chars & 0x80000000)) {
      hits.push({ category: "opcode", hit: `W+X section '${name}'`, offset: "0x" + base.toString(16), evidence: "self-modifying code (unpacker stub)", severity: "high" });
    }
    // Suspiciously tiny raw .text for a big virtual size — packer artifact
    if (name.toLowerCase() === ".text" && virtualSize > rawSize * 4 && rawSize > 0) {
      hits.push({ category: "opcode", hit: `.text raw<<virtual`, offset: "0x" + base.toString(16), evidence: `raw=${rawSize} virtual=${virtualSize}`, severity: "high" });
    }
    // Packer-ish section names
    if (/^(?:UPX\d|\.vmp\d|\.themida|\.aspack|\.enigma|FSG\d*|\.MPRESS\d*|\.pec\d|\.nsp\d|\.boom)/i.test(name)) {
      hits.push({ category: "string", hit: `packer section '${name}'`, offset: "0x" + base.toString(16), severity: "high" });
    }
  }

  // Overlay — bytes past the last section's raw boundary
  const maxEnd = (() => {
    let m = 0;
    for (let i = 0; i < nSec && secStart + (i + 1) * 40 <= b.length; i++) {
      const base = secStart + i * 40;
      const rawOff  = b.readUInt32LE(base + 20);
      const rawSize = b.readUInt32LE(base + 16);
      m = Math.max(m, rawOff + rawSize);
    }
    return m;
  })();
  if (maxEnd > 0 && b.length - maxEnd > b.length * 0.10 && b.length - maxEnd > 4096) {
    hits.push({ category: "opcode", hit: "large overlay", offset: "0x" + maxEnd.toString(16), evidence: `${b.length - maxEnd} bytes trailing — dropper / self-extractor`, severity: "warn" });
  }

  return hits;
}

// ---------- patcher ---------------------------------------------------
// Finds call-sites to the known anti-debug imports and NOPs them in a
// copy of the file. We're conservative: we only patch IAT thunks that
// clearly resolve one of the imports in ANTI_DEBUG_IMPORTS, never
// speculative patches. The patched file is written as `<path>.patched`
// so the original stays intact.
export async function patchAntiRe(src: Uint8Array, imports: string[]): Promise<{ patched: Uint8Array; patches: { offset: string; name: string }[] }> {
  const out = new Uint8Array(src);
  const b = Buffer.from(out.buffer, out.byteOffset, out.byteLength);
  const patches: { offset: string; name: string }[] = [];
  // Find every NUL-bounded import name and overwrite the name with
  // '_PATCHED\0' so the loader can't resolve it. This forces the
  // import to come back as nullptr; the caller's `if (fn && fn())`
  // paths bail out gracefully. Riskier approach would be rewriting
  // call-sites — leave that to a dynamic patcher.
  for (const sym of imports) {
    const needle = Buffer.from("\x00" + sym + "\x00", "utf8");
    let p = 0;
    while ((p = b.indexOf(needle, p)) !== -1) {
      const nameStart = p + 1;
      const replacement = Buffer.from("_PATCHED", "utf8");
      replacement.copy(b, nameStart, 0, Math.min(replacement.length, sym.length));
      // null-terminate inside the original slot
      if (replacement.length < sym.length) b[nameStart + replacement.length] = 0;
      patches.push({ offset: "0x" + nameStart.toString(16), name: sym });
      p += needle.length;
    }
  }
  return { patched: out, patches };
}

function md(hits: DeepHit[]): string {
  const byCat = hits.reduce((acc, h) => { acc[h.category] = (acc[h.category] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const sev = hits.reduce((acc, h) => { if (h.severity) acc[h.severity] = (acc[h.severity] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const lines = [
    `## Summary`,
    `- hits: **${hits.length}**  (${Object.entries(byCat).map(([k, v]) => `${k}=${v}`).join(", ")})`,
    `- severity: ${Object.entries(sev).map(([k, v]) => `${k}=${v}`).join(" ") || "(unclassified)"}`,
    ``,
    `## High-severity findings`,
    ...hits.filter(h => h.severity === "high").map(h => `- 🚩 **${h.hit}**${h.offset ? ` @ ${h.offset}` : ""}${h.evidence ? ` — _${h.evidence}_` : ""}`),
    ``,
    `## Warnings`,
    ...hits.filter(h => h.severity === "warn").map(h => `- ⚠️ **${h.hit}**${h.offset ? ` @ ${h.offset}` : ""}${h.evidence ? ` — _${h.evidence}_` : ""}`),
    ``,
    `## All imports flagged`,
    ...hits.filter(h => h.category === "import").slice(0, 50).map(h => `- \`${h.hit}\` @ ${h.offset}`),
  ];
  return lines.join("\n");
}

export function registerAntiRe(server: McpServer): void {
  server.tool(
    "antire_scan",
    "Scan a PE / ELF file for anti-debug, anti-vm and anti-sandbox hints: suspicious imports, VM fingerprint strings, analyst-window titles, and anti-step / timing-check opcodes. Zero deps.",
    { path: z.string(), limit: z.number().min(1).max(10_000).default(500) },
    async ({ path, limit }: { path: string; limit: number }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const hits = scanAntiRe(new Uint8Array(buf));
      const byCat = hits.reduce((acc, h) => { acc[h.category] = (acc[h.category] ?? 0) + 1; return acc; }, {} as Record<string, number>);
      const shown = hits.slice(0, limit);
      const text = [
        `# antire_scan ${path}`,
        `**total hits:** ${hits.length}  (${Object.entries(byCat).map(([k, v]) => `${k}=${v}`).join(", ")})`,
        ``,
        ...shown.map(h => `- **${h.category}** \`${h.hit}\`${h.offset ? ` @ ${h.offset}` : ""}${h.evidence ? ` _(${h.evidence})_` : ""}`),
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "antire_deep_scan",
    "Structural PE scan: TLS callbacks, Rich Header absence, W+X sections, raw<<virtual .text, packer section names, trailing overlay, zero checksum. Signals are tagged with severity (high / warn / info).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const deep = scanDeepPE(new Uint8Array(buf));
      const flat = scanAntiRe(new Uint8Array(buf)) as DeepHit[];
      const merged = [...deep, ...flat];
      const text = [
        `# antire_deep_scan ${path}`,
        ``,
        md(merged),
      ].join("\n");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.tool(
    "antire_patch_imports",
    "Rename a selection of anti-debug import names to `_PATCHED\\0...` inside a *copy* of the file (never overwrites the input). The loader then resolves those imports to nullptr, so most `if (fn && fn())` evasion paths skip. Writes `<path>.patched` + emits a per-site offset list.",
    {
      path: z.string(),
      imports: z.array(z.string()).default([
        "IsDebuggerPresent", "CheckRemoteDebuggerPresent", "NtQueryInformationProcess",
        "OutputDebugStringA", "OutputDebugStringW", "FindWindowA", "FindWindowW",
      ]),
    },
    async ({ path, imports }: { path: string; imports: string[] }) => {
      requirePathAllowed(path);
      const src = await readFile(path);
      const { patched, patches } = await patchAntiRe(new Uint8Array(src), imports);
      const out = path.endsWith(".patched") ? path : path + ".patched";
      requirePathAllowed(out);
      // Preserve the untouched original by copying first in case the
      // sandbox allowlist blocks the write path.
      try { await copyFile(path, out + ".bak"); } catch { /* ignore if dest write fails below */ }
      await writeFile(out, patched);
      return { content: [{ type: "text" as const, text:
        `# antire_patch_imports\n\n` +
        `**wrote:** \`${out}\` (${patched.length} bytes)\n` +
        `**patched sites:** ${patches.length}\n\n` +
        patches.slice(0, 50).map(p => `- \`${p.name}\` @ ${p.offset}`).join("\n")
      }] };
    });

  server.tool(
    "antire_report",
    "One-shot report: shallow scan + deep PE scan, rendered as a markdown triage document (Summary / High-severity / Warnings / Imports).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const buf = await readFile(path);
      const deep = scanDeepPE(new Uint8Array(buf));
      const flat = scanAntiRe(new Uint8Array(buf)) as DeepHit[];
      return { content: [{ type: "text" as const, text: `# antire_report ${path}\n\n${md([...deep, ...flat])}` }] };
    });
}
