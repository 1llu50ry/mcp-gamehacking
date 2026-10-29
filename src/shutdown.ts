// ============================================================
// Graceful-shutdown orchestrator.
//
// Previously the server replied to SIGINT/SIGTERM by calling
// `process.exit(130/143)` immediately. That cut the HTTP server off
// mid-request, left stale .cache / .agent-mesh writes half-flushed,
// and dropped the audit log's trailing bytes. In Docker that's the
// default stop path (`docker stop` sends SIGTERM, waits 10 s, SIGKILL).
//
// This module centralises the drain:
//   1. Signal handler fires -> run every registered hook in LIFO order.
//   2. Each hook returns a promise; we race against a hard DRAIN_MS
//      timeout so a stuck hook can't block the process forever.
//   3. After drain, exit with the signal's conventional code (130/143).
//
// Register hooks from anywhere via onShutdown(label, fn). The HTTP
// transport, agent-mesh, decompile-cache, audit-log, and retools'
// child-process pool all register themselves on first use.
// ============================================================

type ShutdownHook = { label: string; fn: () => void | Promise<void> };

const DRAIN_MS = Number(process.env.MCP_SHUTDOWN_DRAIN_MS ?? 10_000);
const hooks: ShutdownHook[] = [];
let draining = false;

export function onShutdown(label: string, fn: () => void | Promise<void>): void {
  hooks.push({ label, fn });
}

export function isDraining(): boolean { return draining; }

async function runWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<void> {
  await Promise.race([
    (async () => { try { await p; } catch (e) { console.error(`[shutdown] ${label} hook threw:`, (e as Error).message); } })(),
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms)),
  ]).catch((e) => console.error(`[shutdown] ${label}:`, (e as Error).message));
}

async function drain(signal: NodeJS.Signals, exitCode: number): Promise<void> {
  if (draining) return; // already in flight — ignore repeat signal
  draining = true;
  const started = Date.now();
  console.error(`[shutdown] ${signal} received, draining ${hooks.length} hooks (budget ${DRAIN_MS}ms)`);

  // LIFO order: last-registered teardown first. Typically that's the
  // HTTP transport (stop accepting), then higher-level stores (flush).
  for (let i = hooks.length - 1; i >= 0; i--) {
    const h = hooks[i];
    const remain = Math.max(100, DRAIN_MS - (Date.now() - started));
    const t0 = Date.now();
    try {
      await runWithTimeout(Promise.resolve(h.fn()), remain, h.label);
      console.error(`[shutdown] ${h.label} done in ${Date.now() - t0}ms`);
    } catch (e) {
      console.error(`[shutdown] ${h.label} failed:`, (e as Error).message);
    }
    if (Date.now() - started > DRAIN_MS) {
      console.error(`[shutdown] drain budget exceeded, forcing exit`);
      break;
    }
  }
  console.error(`[shutdown] complete in ${Date.now() - started}ms, exit ${exitCode}`);
  // process.exit lets Node flush stdio before the OS kill arrives.
  process.exit(exitCode);
}

export function installSignalHandlers(): void {
  // Removing default handlers so Node doesn't double-signal when a hook
  // triggers its own code paths that react to process.exit.
  process.on("SIGINT",  () => void drain("SIGINT", 130));
  process.on("SIGTERM", () => void drain("SIGTERM", 143));
  // Not fatal, but useful: BREAK on Windows and HUP on Unix. The latter
  // is what systemd sends on `reload` by default.
  if (process.platform === "win32") process.on("SIGBREAK", () => void drain("SIGBREAK", 143));
  else process.on("SIGHUP", () => void drain("SIGHUP", 129));
}
