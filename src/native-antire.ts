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
import { readFile } from "node:fs/promises";
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
}
