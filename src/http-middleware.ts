// ============================================================
// HTTP transport middleware: per-request trace-ids, per-user rate
// limiting, structured request logging.
//
// Identity resolution (used as the rate-limit bucket key):
//   1. `X-User-Id` header if set (trusted by convention — set by
//      your reverse proxy / auth gateway).
//   2. The 16-char prefix of the Authorization bearer token hash
//      (so a token is enough identity without logging the token).
//   3. The remote IP (fallback).
//
// Rate limit: token bucket per identity, filled at
// `MCP_RATE_LIMIT_PER_USER_SEC` (default 20). Returns 429 with
// Retry-After when empty.
//
// Trace-id: 16-hex-char. Returned on `X-Trace-Id` and bound into
// per-request logs. If the client sends one in, we honor it.
// ============================================================

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { newTraceId } from "./chunking.js";
import { metrics } from "./observability.js";

interface Bucket { tokens: number; last: number }
const userBuckets = new Map<string, Bucket>();

function identity(req: IncomingMessage): string {
  const h = (name: string) => (req.headers[name.toLowerCase()] as string | undefined) ?? "";
  const uid = h("x-user-id").trim();
  if (uid) return `uid:${uid}`;
  const auth = h("authorization").trim();
  if (auth) return "tok:" + createHash("sha256").update(auth).digest("hex").slice(0, 16);
  return `ip:${req.socket.remoteAddress ?? "unknown"}`;
}

function allow(id: string, perSec: number): boolean {
  const now = Date.now();
  let b = userBuckets.get(id);
  if (!b) { b = { tokens: perSec, last: now }; userBuckets.set(id, b); }
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(perSec, b.tokens + elapsed * perSec);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
  return false;
}

interface MiddlewareResult {
  /** The trace-id to use for logs through this request. */
  traceId: string;
  /** When set, the middleware already sent a 429/… response — stop. */
  rejected?: boolean;
}

export function runRequestMiddleware(req: IncomingMessage, res: ServerResponse): MiddlewareResult {
  const perSec = Number(process.env.MCP_RATE_LIMIT_PER_USER_SEC ?? 20);
  const enabled = process.env.MCP_RATE_LIMIT_PER_USER === "1";
  const traceId = (req.headers["x-trace-id"] as string | undefined)?.slice(0, 32) ?? newTraceId();
  res.setHeader("X-Trace-Id", traceId);

  if (enabled) {
    const id = identity(req);
    if (!allow(id, perSec)) {
      res.setHeader("Retry-After", "1");
      res.statusCode = 429;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "rate limit", retry_after_s: 1, id, limit_per_sec: perSec }));
      metrics.toolCall("__rate_limit_429", 0, { ok: false });
      return { traceId, rejected: true };
    }
  }

  // structured per-request log line (stderr so stdout stays for stdio transport)
  const started = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - started;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      trace: traceId,
      method: req.method,
      path: req.url,
      status: res.statusCode,
      ms,
      id: identity(req),
    });
    try { process.stderr.write(line + "\n"); } catch {}
    metrics.toolCall(`http_${req.method}`, ms, { ok: res.statusCode < 400 });
  });

  return { traceId };
}

/** For tool handlers that want to tag per-request state (e.g. hub forwarding). */
export const trace = {
  current(): string | undefined {
    // AsyncLocalStorage would be ideal here, but we keep zero-dep: tool
    // handlers that need the trace-id read it off the `req` via a side-channel
    // the transport populates. Left intentionally as a stub so callers have
    // a stable name to grep for when they do want wiring.
    return undefined;
  },
};
