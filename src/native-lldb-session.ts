// ============================================================
// Persistent lldb session manager — the "attach / step / inspect"
// side of vscode-lldb that batch mode can't deliver.
//
// Each session is a long-lived `lldb --no-use-colors --no-lldbinit`
// subprocess with stdin kept open. Commands are written to stdin
// and the response is read until a sentinel line we print after
// every command (`settings set interpreter.echo-commands false`
// plus a `?e <marker>` tail) marks the end.
//
// Session lifecycle:
//   lldb_session_open  → spawn + attach (pid or launch)
//   lldb_session_cmd   → one command, synchronous response
//   lldb_session_close → quit + wait exit
//
// The session dict is keyed by a short uuid. We register a shutdown
// hook so docker-stop kills every live lldb cleanly instead of
// orphaning subprocesses on the host.
// ============================================================

import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { onShutdown } from "./shutdown.js";

interface Session {
  id: string;
  proc: ChildProcessWithoutNullStreams;
  buffer: string;
  queue: { marker: string; resolve: (s: string) => void; reject: (e: Error) => void }[];
  closed: boolean;
}

const sessions = new Map<string, Session>();

function send(sess: Session, cmd: string, timeoutMs: number): Promise<string> {
  if (sess.closed) throw new Error(`session ${sess.id} already closed`);
  // Marker approach: write the command, then a `script print("…")`
  // that lldb interprets inline. The output includes an easily
  // distinguishable line we scan for.
  const marker = "__LLDB_SENTINEL_" + randomBytes(6).toString("hex") + "__";
  const script = `${cmd}\nscript print("${marker}")\n`;
  return new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => {
      const i = sess.queue.findIndex(q => q.marker === marker);
      if (i >= 0) {
        sess.queue.splice(i, 1);
        reject(new Error(`lldb_session_cmd timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    sess.queue.push({ marker, resolve: (s) => { clearTimeout(t); resolve(s); }, reject: (e) => { clearTimeout(t); reject(e); } });
    sess.proc.stdin.write(script);
  });
}

function drainBuffer(sess: Session): void {
  while (sess.queue.length) {
    const head = sess.queue[0];
    const idx = sess.buffer.indexOf(head.marker);
    if (idx < 0) return;
    const chunk = sess.buffer.slice(0, idx);
    sess.buffer = sess.buffer.slice(idx + head.marker.length).replace(/^.*\n/, ""); // consume the newline too
    head.resolve(chunk.replace(/\(lldb\)\s*$/, "").trim());
    sess.queue.shift();
  }
}

export interface OpenOpts { bin?: string; attachPid?: number; launch?: string; args?: string[] }
export async function openSession(opts: OpenOpts): Promise<string> {
  const bin = opts.bin ?? process.env.MCP_LLDB_BIN ?? "lldb";
  const id = randomBytes(6).toString("hex");
  const proc = spawn(bin, ["--no-use-colors", "--no-lldbinit"], { stdio: ["pipe", "pipe", "pipe"] });
  const sess: Session = { id, proc, buffer: "", queue: [], closed: false };

  proc.stdout.on("data", (b: Buffer) => { sess.buffer += b.toString("utf8"); drainBuffer(sess); });
  proc.stderr.on("data", (b: Buffer) => { sess.buffer += b.toString("utf8"); drainBuffer(sess); });
  proc.on("error", (e) => {
    sess.closed = true;
    for (const q of sess.queue) q.reject(new Error(`lldb died: ${e.message}`));
    sess.queue.length = 0;
    sessions.delete(id);
  });
  proc.on("exit", () => {
    sess.closed = true;
    for (const q of sess.queue) q.reject(new Error("lldb exited"));
    sess.queue.length = 0;
    sessions.delete(id);
  });

  sessions.set(id, sess);

  // Prime: wait a moment for the banner, then issue a no-op to
  // sync. We also disable confirmation prompts so `quit` doesn't hang.
  await send(sess, "settings set auto-confirm true", 5_000);
  if (opts.attachPid) await send(sess, `attach --pid ${opts.attachPid}`, 20_000);
  else if (opts.launch) await send(sess, `target create ${JSON.stringify(opts.launch)}${opts.args?.length ? " -- " + opts.args.map(a => JSON.stringify(a)).join(" ") : ""}`, 20_000);

  return id;
}

export async function sendCommand(id: string, cmd: string, timeoutMs = 30_000): Promise<string> {
  const sess = sessions.get(id);
  if (!sess) throw new Error(`no such session: ${id}`);
  return send(sess, cmd, timeoutMs);
}

export async function closeSession(id: string): Promise<void> {
  const sess = sessions.get(id);
  if (!sess) return;
  try { await send(sess, "quit", 5_000); } catch { /* already quitting */ }
  try { sess.proc.kill("SIGTERM"); } catch { /* ignore */ }
  sessions.delete(id);
}

export function listSessions(): Array<{ id: string; alive: boolean; queued: number }> {
  return Array.from(sessions.values()).map(s => ({ id: s.id, alive: !s.closed, queued: s.queue.length }));
}

// Make sure docker-stop / systemctl stop drain live sessions before exit.
onShutdown("lldb-sessions", async () => {
  await Promise.all(Array.from(sessions.keys()).map(id => closeSession(id)));
});
