// ============================================================
// Native LLDB driver (replaces `vscode-lldb` for the subset of
// workflows that only need batch commands, not an interactive
// DAP session). lldb is driven in `--batch -o <cmd>` mode so each
// tool call is a short-lived subprocess — no persistent session,
// no socket, no vscode debug-adapter protocol.
//
// Users install lldb themselves (Xcode command line tools on
// macOS, `apt install lldb` on Linux, llvm.org/releases on
// Windows). Point MCP_LLDB_BIN at the binary if it isn't on PATH.
//
// Tools:
//   lldb_version       — probe
//   lldb_image_list    — modules in the target binary
//   lldb_symbols       — matching symbols for a regex
//   lldb_disasm        — disassemble N instructions at an address or symbol
//   lldb_run_script    — multi-line lldb command script (safety-gated)
// ============================================================

import { z } from "zod";
import { spawn } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

interface LldbOpts { timeoutMs?: number; maxBytes?: number }

export async function lldbRun(cmds: string[], binary: string | null, opts: LldbOpts = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxBytes  = opts.maxBytes  ?? 4 * 1024 * 1024;
  const bin       = process.env.MCP_LLDB_BIN ?? "lldb";
  const args: string[] = ["--batch", "--no-lldbinit"];
  for (const c of cmds) { args.push("-o", c); }
  if (binary) args.push(binary);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let total = 0;
    let killed = false;
    const timer = setTimeout(() => { killed = true; try { child.kill("SIGTERM"); } catch { /* already gone */ } }, timeoutMs);

    child.stdout.on("data", (b: Buffer) => {
      total += b.length;
      if (total > maxBytes) { killed = true; try { child.kill("SIGTERM"); } catch { /* ignore */ } }
      else chunks.push(b);
    });
    child.stderr.on("data", (b: Buffer) => { if (errChunks.length < 20) errChunks.push(b); });

    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`spawn ${bin} failed: ${e.message}. Install lldb or set MCP_LLDB_BIN.`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return reject(new Error(`lldb ${timeoutMs/1000}s timeout or ${maxBytes}B cap exceeded`));
      const stdout = Buffer.concat(chunks).toString("utf8");
      if (code !== 0 && stdout.trim() === "") {
        const stderr = Buffer.concat(errChunks).toString("utf8").slice(0, 400);
        return reject(new Error(`lldb exited ${code}: ${stderr}`));
      }
      resolve(stdout);
    });
  });
}

// --- command safety guard: lldb's `script`, `shell`, `platform shell`,
// and `expression` with side-effecting calls can run arbitrary code
// outside the debuggee. Refuse them unless the user asked for the
// raw passthrough.
const BLOCKED = /^\s*(?:script|shell|platform\s+shell|target\s+(?:create|modules\s+load)\s+--|command\s+alias)/i;
function assertSafe(cmd: string): void {
  if (BLOCKED.test(cmd)) throw new Error(`refused: '${cmd.split(/\s+/, 2)[0]}' can execute arbitrary host code; use lldb_run_script with allowUnsafe=true if intentional`);
}

export function registerNativeLldb(server: McpServer): void {
  server.tool(
    "lldb_version",
    "Probe the installed lldb binary (needs lldb on PATH or MCP_LLDB_BIN set).",
    {},
    async () => {
      const out = await lldbRun(["version"], null, { timeoutMs: 5_000 });
      return { content: [{ type: "text" as const, text: `# lldb_version\n\n\`\`\`\n${out.trim()}\n\`\`\`` }] };
    },
  );

  server.tool(
    "lldb_image_list",
    "List loaded modules of a target binary (lldb `image list`).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const out = await lldbRun(["image list"], path);
      return { content: [{ type: "text" as const, text: `# lldb_image_list ${path}\n\n\`\`\`\n${out.trim().slice(0, 20_000)}\n\`\`\`` }] };
    },
  );

  server.tool(
    "lldb_symbols",
    "List symbols matching a regex (lldb `image lookup --regex`).",
    { path: z.string(), regex: z.string() },
    async ({ path, regex }: { path: string; regex: string }) => {
      requirePathAllowed(path);
      // Lightly validate the regex before handing to lldb so we fail
      // fast on operator typos instead of letting lldb print an
      // incomprehensible SBError.
      try { new RegExp(regex); } catch (e) { throw new Error(`bad regex: ${(e as Error).message}`); }
      const out = await lldbRun([`image lookup --regex -n ${JSON.stringify(regex)}`], path);
      return { content: [{ type: "text" as const, text: `# lldb_symbols ${path} /${regex}/\n\n\`\`\`\n${out.trim().slice(0, 50_000)}\n\`\`\`` }] };
    },
  );

  server.tool(
    "lldb_disasm",
    "Disassemble N instructions at a symbol or address (lldb `disassemble -s <addr> -c N` or `-n <symbol>`).",
    { path: z.string(), at: z.string(), count: z.number().min(1).max(1024).default(32) },
    async ({ path, at, count }: { path: string; at: string; count: number }) => {
      requirePathAllowed(path);
      const target = /^0x[0-9a-fA-F]+$|^\d+$/.test(at) ? `-s ${at}` : `-n ${JSON.stringify(at)}`;
      const out = await lldbRun([`disassemble ${target} -c ${count}`], path);
      return { content: [{ type: "text" as const, text: `# lldb_disasm ${path} @ ${at}\n\n\`\`\`\n${out.trim().slice(0, 50_000)}\n\`\`\`` }] };
    },
  );

  server.tool(
    "lldb_run_script",
    "Run a sequence of lldb commands against a binary in --batch mode. By default refuses `script`, `shell`, `platform shell`, and `command alias` (host-code vectors); pass allowUnsafe=true if that is intentional.",
    {
      path: z.string(),
      commands: z.array(z.string()).max(50),
      allowUnsafe: z.boolean().default(false),
      timeoutMs: z.number().min(1000).max(600_000).default(60_000),
    },
    async ({ path, commands, allowUnsafe, timeoutMs }) => {
      requirePathAllowed(path);
      if (!allowUnsafe) for (const c of commands) assertSafe(c);
      const out = await lldbRun(commands, path, { timeoutMs });
      return { content: [{ type: "text" as const, text: `# lldb_run_script ${path} (${commands.length} commands)\n\n\`\`\`\n${out.trim().slice(0, 100_000)}\n\`\`\`` }] };
    },
  );
}
