// ============================================================
// Native GDB driver — symmetric counterpart to native-lldb.ts.
//
// Users install gdb themselves (`apt install gdb`, `brew install gdb`,
// mingw-w64 toolchain on Windows). We drive it as a subprocess, two
// usage shapes:
//
//   1. Batch mode  — `gdb --batch -ex "<cmd>" -ex "<cmd>" <binary>`
//   2. Persistent  — long-lived gdb, interactive debugging over its
//                    MI (machine interface) line protocol
//
// Shutdown hook kills all live sessions on SIGTERM so docker-stop
// doesn't orphan them (same pattern as lldb-session).
// ============================================================

import { z } from "zod";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";
import { onShutdown } from "./shutdown.js";

// --- batch mode ---

interface GdbBatchOpts { timeoutMs?: number; maxBytes?: number }

async function gdbBatch(cmds: string[], binary: string | null, opts: GdbBatchOpts = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxBytes  = opts.maxBytes  ?? 4 * 1024 * 1024;
  const bin       = process.env.MCP_GDB_BIN ?? "gdb";
  const args: string[] = ["--batch", "--nx", "--quiet"];
  for (const c of cmds) args.push("-ex", c);
  if (binary) args.push(binary);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let total = 0; let killed = false;
    const errChunks: Buffer[] = [];
    const timer = setTimeout(() => { killed = true; try { child.kill("SIGTERM"); } catch { /* ignore */ } }, timeoutMs);
    child.stdout.on("data", (b: Buffer) => {
      total += b.length;
      if (total > maxBytes) { killed = true; try { child.kill("SIGTERM"); } catch { /* ignore */ } }
      else chunks.push(b);
    });
    child.stderr.on("data", (b: Buffer) => { if (errChunks.length < 20) errChunks.push(b); });
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`spawn ${bin} failed: ${e.message}. Install gdb or set MCP_GDB_BIN.`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return reject(new Error(`gdb ${timeoutMs/1000}s timeout or ${maxBytes}B cap exceeded`));
      const stdout = Buffer.concat(chunks).toString("utf8");
      if (code !== 0 && stdout.trim() === "") {
        return reject(new Error(`gdb exited ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 400)}`));
      }
      resolve(stdout);
    });
  });
}

// --- persistent sessions over stdin ---

interface GdbSession {
  id: string;
  proc: ChildProcessWithoutNullStreams;
  buffer: string;
  queue: { marker: string; resolve: (s: string) => void; reject: (e: Error) => void }[];
  closed: boolean;
}

const gdbSessions = new Map<string, GdbSession>();

function sendGdb(sess: GdbSession, cmd: string, timeoutMs: number): Promise<string> {
  if (sess.closed) throw new Error(`gdb session ${sess.id} already closed`);
  const marker = "__GDB_SENTINEL_" + randomBytes(6).toString("hex") + "__";
  // After the user's cmd, run `python print("<marker>")` so stdout gets
  // the sentinel on its own line. This works in CLI and MI mode (gdb's
  // python module is almost always compiled in).
  const script = `${cmd}\npython print("${marker}")\n`;
  return new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => {
      const i = sess.queue.findIndex(q => q.marker === marker);
      if (i >= 0) { sess.queue.splice(i, 1); reject(new Error(`gdb cmd timeout after ${timeoutMs}ms`)); }
    }, timeoutMs);
    sess.queue.push({ marker, resolve: (s) => { clearTimeout(t); resolve(s); }, reject: (e) => { clearTimeout(t); reject(e); } });
    sess.proc.stdin.write(script);
  });
}

function drainGdb(sess: GdbSession): void {
  while (sess.queue.length) {
    const head = sess.queue[0];
    const idx = sess.buffer.indexOf(head.marker);
    if (idx < 0) return;
    const chunk = sess.buffer.slice(0, idx);
    sess.buffer = sess.buffer.slice(idx + head.marker.length).replace(/^.*\n/, "");
    head.resolve(chunk.replace(/\(gdb\)\s*$/, "").trim());
    sess.queue.shift();
  }
}

async function openGdb(opts: { attachPid?: number; launch?: string }): Promise<string> {
  const bin = process.env.MCP_GDB_BIN ?? "gdb";
  const id = randomBytes(6).toString("hex");
  const args = ["--nx", "--quiet"]; // no .gdbinit, no banner
  if (opts.launch) args.push(opts.launch);
  const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
  const sess: GdbSession = { id, proc, buffer: "", queue: [], closed: false };
  proc.stdout.on("data", (b: Buffer) => { sess.buffer += b.toString("utf8"); drainGdb(sess); });
  proc.stderr.on("data", (b: Buffer) => { sess.buffer += b.toString("utf8"); drainGdb(sess); });
  proc.on("error", (e) => {
    sess.closed = true;
    for (const q of sess.queue) q.reject(new Error(`gdb died: ${e.message}`));
    sess.queue.length = 0; gdbSessions.delete(id);
  });
  proc.on("exit", () => {
    sess.closed = true;
    for (const q of sess.queue) q.reject(new Error("gdb exited"));
    sess.queue.length = 0; gdbSessions.delete(id);
  });
  gdbSessions.set(id, sess);
  await sendGdb(sess, "set confirm off", 5_000);
  await sendGdb(sess, "set pagination off", 5_000);
  if (opts.attachPid) await sendGdb(sess, `attach ${opts.attachPid}`, 30_000);
  return id;
}

onShutdown("gdb-sessions", async () => {
  await Promise.all(Array.from(gdbSessions.values()).map(async (sess) => {
    try { await sendGdb(sess, "quit", 3_000); } catch { /* already quitting */ }
    try { sess.proc.kill("SIGTERM"); } catch { /* ignore */ }
  }));
});

export function registerNativeGdb(server: McpServer): void {
  server.tool("gdb_version", "Probe the installed gdb binary.", {}, async () => {
    const out = await gdbBatch(["show version"], null, { timeoutMs: 5_000 });
    return { content: [{ type: "text" as const, text: `# gdb_version\n\n\`\`\`\n${out.split("\n").slice(0, 10).join("\n")}\n\`\`\`` }] };
  });

  server.tool("gdb_info",
    "gdb `info files` + `info functions` on a binary (batch mode).",
    { path: z.string() },
    async ({ path }: { path: string }) => {
      requirePathAllowed(path);
      const out = await gdbBatch(["info files", "info functions"], path);
      return { content: [{ type: "text" as const, text: `# gdb_info ${path}\n\n\`\`\`\n${out.slice(0, 50_000)}\n\`\`\`` }] };
    });

  server.tool("gdb_disasm",
    "gdb disassemble at a symbol or address range (batch).",
    { path: z.string(), at: z.string(), count: z.number().min(1).max(2048).default(32) },
    async ({ path, at, count }) => {
      requirePathAllowed(path);
      const expr = /^0x[0-9a-fA-F]+$/.test(at) ? `${at}, ${at}+${count * 8}` : at;
      const out = await gdbBatch([`disassemble /r ${expr}`], path);
      return { content: [{ type: "text" as const, text: `# gdb_disasm ${path} @ ${at}\n\n\`\`\`\n${out.slice(0, 50_000)}\n\`\`\`` }] };
    });

  server.tool("gdb_session_open",
    "Open a persistent gdb session. attachPid attaches to a running process; launch loads a binary without running it.",
    { attachPid: z.number().int().min(1).optional(), launch: z.string().optional() },
    async ({ attachPid, launch }) => {
      if (!attachPid && !launch) throw new Error("either attachPid or launch is required");
      if (launch) requirePathAllowed(launch);
      const id = await openGdb({ attachPid, launch });
      return { content: [{ type: "text" as const, text: `# gdb_session_open\n\n**session:** \`${id}\`` }] };
    });

  server.tool("gdb_session_cmd",
    "Run a command in a live gdb session. Shell escapes (`!`, `shell`) refused unless allowUnsafe=true.",
    { session: z.string(), cmd: z.string(), timeoutMs: z.number().min(1000).max(600_000).default(30_000), allowUnsafe: z.boolean().default(false) },
    async ({ session, cmd, timeoutMs, allowUnsafe }) => {
      if (!allowUnsafe && /^\s*(shell|\!|python\s+exec|python\s+import\s+os)/i.test(cmd)) {
        throw new Error("refused: shell/python-exec routes bypass the sandbox; pass allowUnsafe=true if intentional");
      }
      const sess = gdbSessions.get(session);
      if (!sess) throw new Error(`no such session: ${session}`);
      const out = await sendGdb(sess, cmd, timeoutMs);
      return { content: [{ type: "text" as const, text: `# gdb_session_cmd \`${cmd}\`\n\n\`\`\`\n${out.slice(0, 50_000)}\n\`\`\`` }] };
    });

  server.tool("gdb_breakpoint",
    "Set / clear / list breakpoints in a live gdb session.",
    { session: z.string(), op: z.enum(["set", "clear", "list"]).default("set"), at: z.string().optional(), id: z.number().int().optional() },
    async ({ session, op, at, id }) => {
      const sess = gdbSessions.get(session);
      if (!sess) throw new Error(`no such session: ${session}`);
      let cmd: string;
      if (op === "list") cmd = "info breakpoints";
      else if (op === "clear") cmd = id != null ? `delete ${id}` : "delete";
      else {
        if (!at) throw new Error("`at` required for set");
        cmd = /^0x[0-9a-fA-F]+$|^\d+$/.test(at) ? `break *${at}` : `break ${at}`;
      }
      const out = await sendGdb(sess, cmd, 10_000);
      return { content: [{ type: "text" as const, text: `# gdb_breakpoint ${op}${at ? " " + at : ""}\n\n\`\`\`\n${out}\n\`\`\`` }] };
    });

  server.tool("gdb_step",
    "Step: into (si/step) / over (ni/next) / out (finish) / instruction (si).",
    { session: z.string(), mode: z.enum(["into", "over", "out", "instruction"]).default("over") },
    async ({ session, mode }) => {
      const sess = gdbSessions.get(session);
      if (!sess) throw new Error(`no such session: ${session}`);
      const cmd = mode === "into" ? "step" : mode === "over" ? "next" : mode === "out" ? "finish" : "stepi";
      const out = await sendGdb(sess, cmd, 60_000);
      return { content: [{ type: "text" as const, text: `# gdb_step ${mode}\n\n\`\`\`\n${out}\n\`\`\`` }] };
    });

  server.tool("gdb_continue", "Resume until next breakpoint / signal / exit.",
    { session: z.string(), timeoutMs: z.number().min(1000).max(600_000).default(120_000) },
    async ({ session, timeoutMs }) => {
      const sess = gdbSessions.get(session);
      if (!sess) throw new Error(`no such session: ${session}`);
      const out = await sendGdb(sess, "continue", timeoutMs);
      return { content: [{ type: "text" as const, text: `# gdb_continue\n\n\`\`\`\n${out}\n\`\`\`` }] };
    });

  server.tool("gdb_registers", "Dump register state (`info registers`).",
    { session: z.string() },
    async ({ session }) => {
      const sess = gdbSessions.get(session);
      if (!sess) throw new Error(`no such session: ${session}`);
      const out = await sendGdb(sess, "info registers", 10_000);
      return { content: [{ type: "text" as const, text: `# gdb_registers\n\n\`\`\`\n${out}\n\`\`\`` }] };
    });

  server.tool("gdb_memory",
    "Read process memory as hex (`x/<size>bx <addr>`) or write via `set {char[N]}addr = {bytes}`.",
    { session: z.string(), op: z.enum(["read", "write"]).default("read"), addr: z.string(), size: z.number().min(1).max(1 << 20).default(256), bytes: z.string().optional() },
    async ({ session, op, addr, size, bytes }) => {
      const sess = gdbSessions.get(session);
      if (!sess) throw new Error(`no such session: ${session}`);
      let cmd: string;
      if (op === "read") cmd = `x/${size}bx ${addr}`;
      else {
        if (!bytes) throw new Error("bytes required for write");
        const toks = bytes.trim().split(/\s+/).map(h => "0x" + h.replace(/^0x/, ""));
        cmd = `set {unsigned char[${toks.length}]}${addr} = {${toks.join(", ")}}`;
      }
      const out = await sendGdb(sess, cmd, 15_000);
      return { content: [{ type: "text" as const, text: `# gdb_memory ${op} ${addr}\n\n\`\`\`\n${out}\n\`\`\`` }] };
    });

  server.tool("gdb_backtrace", "Call stack of the stopped thread (`bt`).",
    { session: z.string(), limit: z.number().min(1).max(1024).default(32) },
    async ({ session, limit }) => {
      const sess = gdbSessions.get(session);
      if (!sess) throw new Error(`no such session: ${session}`);
      const out = await sendGdb(sess, `bt ${limit}`, 10_000);
      return { content: [{ type: "text" as const, text: `# gdb_backtrace\n\n\`\`\`\n${out}\n\`\`\`` }] };
    });

  server.tool("gdb_session_close", "Quit a gdb session cleanly.",
    { session: z.string() },
    async ({ session }) => {
      const sess = gdbSessions.get(session);
      if (!sess) return { content: [{ type: "text" as const, text: `# gdb_session_close\n\nno session \`${session}\`` }] };
      try { await sendGdb(sess, "quit", 3_000); } catch { /* already quitting */ }
      try { sess.proc.kill("SIGTERM"); } catch { /* ignore */ }
      gdbSessions.delete(session);
      return { content: [{ type: "text" as const, text: `# gdb_session_close\n\nclosed \`${session}\`` }] };
    });

  server.tool("gdb_sessions", "List live gdb sessions.", {},
    async () => {
      const list = Array.from(gdbSessions.values()).map(s => ({ id: s.id, alive: !s.closed, queued: s.queue.length }));
      return { content: [{ type: "text" as const, text: `# gdb_sessions\n\n${list.length ? list.map(s => `- \`${s.id}\`  alive=${s.alive}  queue=${s.queued}`).join("\n") : "(none)"}` }] };
    });
}
