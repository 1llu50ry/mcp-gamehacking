// ============================================================
// Native radare2 driver (replaces the `vibe-re` vendored wrapper).
//
// We don't bundle r2 — users install it themselves (brew, apt,
// scoop, choco, etc.) and we drive it as a subprocess over its
// headless `-q -c "<cmd>"` mode. That's the same interface
// r2pipe uses, just without the extra pipe layer.
//
// Tools exposed:
//   r2_version        — probe the installed radare2 binary
//   r2_info           — iIj (info) on a binary
//   r2_strings        — izj (strings) on a binary
//   r2_imports        — iij (imports)
//   r2_sections       — iSj (sections)
//   r2_functions      — aaa then aflj
//   r2_disasm         — pdj @ <addr>
//   r2_decompile      — pdc @ <addr>  (needs r2ghidra or r2dec)
//   r2_cmd            — raw command passthrough with safety guard
//
// Every call is bounded by a timeout and the output size cap set
// in call-site opts; the process is killed if either is exceeded.
// ============================================================

import { z } from "zod";
import { spawn } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

interface R2Opts {
  binary?: string;      // path to the sample
  timeoutMs?: number;
  maxBytes?: number;
}

/** Run one r2 command non-interactively; returns stdout as text. */
export async function r2Run(cmd: string, opts: R2Opts = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxBytes  = opts.maxBytes  ?? 4 * 1024 * 1024;
  const bin       = process.env.MCP_R2_BIN ?? "r2";
  const args      = ["-q0", "-c", cmd];
  if (opts.binary) args.push(opts.binary);
  else             args.push("-");  // stdin, used only for `r2_version`

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let total = 0;
    let killed = false;
    const timer = setTimeout(() => { killed = true; try { child.kill("SIGTERM"); } catch { /* already gone */ } }, timeoutMs);

    child.stdout.on("data", (b: Buffer) => {
      total += b.length;
      if (total > maxBytes) { killed = true; try { child.kill("SIGTERM"); } catch { /* ignore */ } }
      else chunks.push(b);
    });
    const errChunks: Buffer[] = [];
    child.stderr.on("data", (b: Buffer) => { if (errChunks.length < 20) errChunks.push(b); });

    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`spawn ${bin} failed: ${e.message}. Install radare2 and ensure it's on PATH, or set MCP_R2_BIN.`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return reject(new Error(`r2 ${timeoutMs/1000}s timeout or ${maxBytes}B cap exceeded`));
      if (code !== 0 && chunks.length === 0) {
        const stderr = Buffer.concat(errChunks).toString("utf8").slice(0, 400);
        return reject(new Error(`r2 exited ${code}: ${stderr}`));
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

// --- a tiny per-sample bulk helper: open once, run several cmds via `|`
async function r2Bulk(binary: string, cmds: string[], opts: R2Opts = {}): Promise<string[]> {
  // We join with `~!` which r2 treats as "pipe to grep -v" (no-op match)
  // so chained commands' outputs stay separated by a sentinel we strip.
  const SENTINEL = "###R2SEP###";
  const joined = cmds.map(c => `${c}; ?e ${SENTINEL}`).join("; ");
  const out = await r2Run(joined, { ...opts, binary });
  return out.split(SENTINEL).map(s => s.trim()).slice(0, cmds.length);
}

// --- command safety guard
const BLOCKED_CMDS = /^!|^#!|^\\.\\.|^q!?$|^wtf\\s|^dr=|^dp=|^omm=/;
function assertSafeCmd(c: string): void {
  if (BLOCKED_CMDS.test(c)) throw new Error(`refused: ${c} runs a shell / rewrites debuggee / exits r2`);
}

export function registerNativeR2(server: McpServer): void {
  server.tool(
    "r2_version",
    "Probe the installed radare2 binary (needs r2 on PATH or MCP_R2_BIN set).",
    {},
    async () => {
      const out = await r2Run("?V", { timeoutMs: 5_000 });
      return { content: [{ type: "text" as const, text: `# r2_version\n\n${out.trim()}` }] };
    },
  );

  server.tool(
    "r2_info",
    "r2 iIj — binary info (format, arch, bits, entry, class, nx/pic/canary/stripped).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const out = await r2Run("iIj", { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_info ${path}\n\n\`\`\`json\n${out.trim()}\n\`\`\`` }] };
    },
  );

  server.tool(
    "r2_strings",
    "r2 izj — strings in a binary with address, size, and section.",
    { path: z.string(), min: z.number().min(2).max(1024).default(6), limit: z.number().min(1).max(100_000).default(500) },
    async ({ path, min, limit }: { path: string; min: number; limit: number }) => {
      requirePathAllowed(path);
      const out = await r2Run(`e bin.minstr=${min}; izj~{[0:${limit}]}`, { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_strings ${path}\n\n\`\`\`json\n${out.trim()}\n\`\`\`` }] };
    },
  );

  server.tool(
    "r2_imports",
    "r2 iij — PE/ELF/Mach-O imports with address + ordinal.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const out = await r2Run("iij", { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_imports ${path}\n\n\`\`\`json\n${out.trim()}\n\`\`\`` }] };
    },
  );

  server.tool(
    "r2_sections",
    "r2 iSj — section layout + perms + size + hash.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const out = await r2Run("iSj", { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_sections ${path}\n\n\`\`\`json\n${out.trim()}\n\`\`\`` }] };
    },
  );

  server.tool(
    "r2_functions",
    "r2 aaa + aflj — full analysis then function list. First call is slow (seconds); r2's cache does the rest in <ms.",
    { path: z.string(), limit: z.number().min(1).max(10_000).default(500) },
    async ({ path, limit }: { path: string; limit: number }) => {
      requirePathAllowed(path);
      const [ , list ] = await r2Bulk(path, ["aaa", `aflj~{[0:${limit}]}`], { timeoutMs: 180_000 });
      return { content: [{ type: "text" as const, text: `# r2_functions ${path}\n\n\`\`\`json\n${list?.trim()}\n\`\`\`` }] };
    },
  );

  server.tool(
    "r2_disasm",
    "r2 pdj @ <addr> — disassemble N instructions at an address.",
    { path: z.string(), addr: z.string(), n: z.number().min(1).max(1024).default(32) },
    async ({ path, addr, n }: { path: string; addr: string; n: number }) => {
      requirePathAllowed(path);
      const out = await r2Run(`aa; pdj ${n} @ ${addr}`, { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_disasm ${path} @ ${addr}\n\n\`\`\`json\n${out.trim()}\n\`\`\`` }] };
    },
  );

  server.tool(
    "r2_decompile",
    "r2 pdc @ <addr> — decompile a function (needs r2ghidra or r2dec plugin installed in r2).",
    { path: z.string(), addr: z.string() },
    async ({ path, addr }: { path: string; addr: string }) => {
      requirePathAllowed(path);
      const out = await r2Run(`aaa; s ${addr}; af; pdc`, { binary: path, timeoutMs: 180_000 });
      return { content: [{ type: "text" as const, text: `# r2_decompile ${path} @ ${addr}\n\n\`\`\`c\n${out.trim() || "// empty output — is r2ghidra / r2dec installed?"}\n\`\`\`` }] };
    },
  );

  server.tool(
    "r2_cmd",
    "Pass-through: run any r2 command on a sample. Shell escapes (`!`, `#!`), file-write ops (wtf), register-set ops (dr=/dp=), and quits are refused.",
    { path: z.string(), cmd: z.string(), timeoutMs: z.number().min(1000).max(600_000).default(60_000) },
    async ({ path, cmd, timeoutMs }: { path: string; cmd: string; timeoutMs: number }) => {
      requirePathAllowed(path);
      assertSafeCmd(cmd.trim());
      const out = await r2Run(cmd, { binary: path, timeoutMs });
      return { content: [{ type: "text" as const, text: `# r2_cmd \`${cmd}\`\n\n${out.trim().slice(0, 100_000)}` }] };
    },
  );

  server.tool(
    "r2_libs",
    "r2 ilj — libraries the binary links against (PE imports table level, ELF DT_NEEDED, Mach-O LC_LOAD_DYLIB).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const out = await r2Run("ilj", { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_libs ${path}\n\n\`\`\`json\n${out.trim()}\n\`\`\`` }] };
    });

  server.tool(
    "r2_syms",
    "r2 isj — full symbol table (exports, defined, undefined). PE exports / ELF .dynsym+.symtab / Mach-O stabs.",
    { path: z.string(), limit: z.number().min(1).max(100_000).default(2000) },
    async ({ path, limit }: { path: string; limit: number }) => {
      requirePathAllowed(path);
      const out = await r2Run(`isj~{[0:${limit}]}`, { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_syms ${path}\n\n\`\`\`json\n${out.trim()}\n\`\`\`` }] };
    });

  server.tool(
    "r2_classes",
    "r2 icj — C++ / Obj-C / Swift / Java classes with RTTI. Use after r2_functions so analysis is primed.",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const [, cls] = await r2Bulk(path, ["aaa", "icj"], { timeoutMs: 180_000 });
      return { content: [{ type: "text" as const, text: `# r2_classes ${path}\n\n\`\`\`json\n${cls?.trim()}\n\`\`\`` }] };
    });

  server.tool(
    "r2_relocs",
    "r2 irj — relocations table. Reads PE .reloc or ELF SHT_REL/SHT_RELA.",
    { path: z.string(), limit: z.number().min(1).max(100_000).default(1000) },
    async ({ path, limit }: { path: string; limit: number }) => {
      requirePathAllowed(path);
      const out = await r2Run(`irj~{[0:${limit}]}`, { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_relocs ${path}\n\n\`\`\`json\n${out.trim()}\n\`\`\`` }] };
    });

  server.tool(
    "r2_entropy_sections",
    "r2 p=e — per-section Shannon entropy (packed sections have entropy > 7.0; UPX/VMP tells here).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const out = await r2Run("p=e", { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_entropy_sections ${path}\n\n\`\`\`\n${out.trim()}\n\`\`\`` }] };
    });

  server.tool(
    "r2_crypto_signatures",
    "r2 /c — scan for crypto constants (SHA-1 / MD5 / AES SBOX / RC4 init / CRC32 tables).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const out = await r2Run("/c", { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_crypto_signatures ${path}\n\n\`\`\`\n${out.trim() || "(no matches)"}\n\`\`\`` }] };
    });

  server.tool(
    "r2_search_pattern",
    "r2 /x — byte-pattern AoB search. Supports hex with `.` wildcards and masks via /c /i /e variants.",
    { path: z.string(), pattern: z.string(), mode: z.enum(["bytes", "ci-string", "regex"]).default("bytes") },
    async ({ path, pattern, mode }: { path: string; pattern: string; mode: "bytes" | "ci-string" | "regex" }) => {
      requirePathAllowed(path);
      const cmd = mode === "bytes" ? `/xj ${pattern}` : mode === "regex" ? `/ej ${pattern}` : `/ij ${pattern}`;
      const out = await r2Run(cmd, { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_search_pattern ${path} /${pattern}/\n\n\`\`\`json\n${out.trim() || "[]"}\n\`\`\`` }] };
    });

  server.tool(
    "r2_graph_fn",
    "r2 agfd — DOT-format control-flow graph for a function (feed into viz_cfg or Graphviz).",
    { path: z.string(), addr: z.string() },
    async ({ path, addr }: { path: string; addr: string }) => {
      requirePathAllowed(path);
      const [, dot] = await r2Bulk(path, ["aaa", `agfd @ ${addr}`], { timeoutMs: 180_000 });
      return { content: [{ type: "text" as const, text: `# r2_graph_fn ${path} @ ${addr}\n\n\`\`\`dot\n${dot?.trim() || "(empty)"}\n\`\`\`` }] };
    });

  server.tool(
    "r2_hooks",
    "r2 /ad — scan for indirect jmp/call sites (candidate hooking locations for Detours/MinHook/Frida).",
    { path: z.string(), limit: z.number().min(1).max(10_000).default(200) },
    async ({ path, limit }: { path: string; limit: number }) => {
      requirePathAllowed(path);
      const [, scan] = await r2Bulk(path, ["aa", `/ad call reg; /ad jmp reg`], { timeoutMs: 90_000 });
      const lines = (scan ?? "").split(/\r?\n/).filter(Boolean).slice(0, limit);
      return { content: [{ type: "text" as const, text: `# r2_hooks ${path}\n\n${lines.map(l => `- \`${l}\``).join("\n") || "(none)"}` }] };
    });

  server.tool(
    "r2_asm",
    "r2 pa — assemble one or more instructions for the detected arch (needs no sample; pass `arch`+`bits` if standalone).",
    { code: z.string(), arch: z.string().default("x86"), bits: z.number().min(8).max(64).default(64) },
    async ({ code, arch, bits }) => {
      const out = await r2Run(`e asm.arch=${arch}; e asm.bits=${bits}; pa ${code}`);
      return { content: [{ type: "text" as const, text: `# r2_asm ${arch} ${bits}\n\n\`\`\`\n${out.trim()}\n\`\`\`` }] };
    });

  server.tool(
    "r2_memdump",
    "r2 px <size> @ <addr> — hex dump of file bytes at an offset.",
    { path: z.string(), addr: z.string(), size: z.number().min(16).max(1 << 20).default(256) },
    async ({ path, addr, size }: { path: string; addr: string; size: number }) => {
      requirePathAllowed(path);
      const out = await r2Run(`px ${size} @ ${addr}`, { binary: path });
      return { content: [{ type: "text" as const, text: `# r2_memdump ${path} @ ${addr}\n\n\`\`\`\n${out.trim().slice(0, 50_000)}\n\`\`\`` }] };
    });
}
