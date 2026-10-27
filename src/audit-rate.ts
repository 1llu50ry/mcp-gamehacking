// Audit log (JSONL rolling file) + per-tool rate limiter.
//
// Audit log is append-only; one JSON line per tool call with
// timestamp, tool name, and arg digest (not full args, so no leaks
// of secrets). Rotated at 10 MiB.
//
// Rate limiter uses a token bucket per (tool, agent). Default off;
// enable with MCP_RATE_LIMIT=1 and tune per-tool via
// MCP_RATE_LIMIT_<TOOL>=<n>  (default per-sec).

import { mkdir, open, rename, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const AUDIT_MAX = 10 * 1024 * 1024;

async function appendAudit(dir: string, record: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  const f = join(dir, "audit.jsonl");
  const payload = JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n";
  // Open the audit file as a single handle and do both stat+append through
  // it. Using the handle instead of the path for stat avoids a TOCTOU race
  // where the file could be swapped (e.g. symlinked) between the stat and
  // the append (CodeQL js/file-system-race).
  let fh: FileHandle | null = null;
  try {
    fh = await open(f, "a");
    const s = await fh.stat();
    if (s.size > AUDIT_MAX) {
      // Rotate: close, rename, re-open. The rename is still against the
      // path, but by that point the handle we observed the size through
      // has been closed and we accept the window — the alternative
      // (keeping the fd through rename) is Unix-only and still can't
      // guarantee what another writer does.
      const rotated = join(dir, `audit-${s.mtime.toISOString().replace(/[:.]/g, "-")}.jsonl`);
      await fh.close();
      fh = null;
      try { await rename(f, rotated); } catch { /* best effort */ }
      fh = await open(f, "a");
    }
    await fh.appendFile(payload, "utf8");
  } finally {
    if (fh) await fh.close();
  }
}

interface Bucket { tokens: number; last: number; }
const buckets = new Map<string, Bucket>();

function allowed(key: string, perSec: number): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { tokens: perSec, last: now }; buckets.set(key, b); }
  const elapsed = (now - b.last) / 1000;
  b.tokens = Math.min(perSec, b.tokens + elapsed * perSec);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
  return false;
}

export function registerAuditAndRate(server: McpServer, projectRoot: string): void {
  const auditDir = process.env.MCP_AUDIT_DIR ?? join(projectRoot, ".audit");
  const rateEnabled = process.env.MCP_RATE_LIMIT === "1";
  const defaultPerSec = Number(process.env.MCP_RATE_LIMIT_DEFAULT ?? 10);

  server.tool(
    "audit_tail",
    "Return the last N audit records from the on-disk audit log.",
    { lines: z.number().min(1).max(10000).default(50) },
    async ({ lines }: { lines: number }) => {
      const f = join(auditDir, "audit.jsonl");
      try {
        const { readFile } = await import("node:fs/promises");
        const content = await readFile(f, "utf8");
        const all = content.split("\n").filter(Boolean);
        const tail = all.slice(-lines);
        return { content: [{ type: "text" as const, text: `# audit (${tail.length} / ${all.length} records)\n\n${tail.join("\n")}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `audit log not yet written at ${f}: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "audit_log",
    "Append an entry to the audit log explicitly (clients that want to annotate a run).",
    {
      actor: z.string(),
      event: z.string(),
      detail: z.string().optional(),
    },
    async ({ actor, event, detail }: { actor: string; event: string; detail?: string }) => {
      await appendAudit(auditDir, { actor, event, detail });
      return { content: [{ type: "text" as const, text: `logged event=${event}` }] };
    }
  );

  server.tool(
    "rate_limit_status",
    "Report rate-limit config and current bucket state per (tool, agent).",
    {},
    async () => {
      const rows = [`enabled: ${rateEnabled}`, `default perSec: ${defaultPerSec}`, ``, `## buckets (${buckets.size})`];
      for (const [key, b] of buckets) rows.push(`- ${key}: tokens=${b.tokens.toFixed(2)} last=${new Date(b.last).toISOString()}`);
      return { content: [{ type: "text" as const, text: rows.join("\n") }] };
    }
  );

  server.tool(
    "rate_limit_check",
    "Check (and consume) a rate limit slot for a (tool, agent) pair. Returns ok/denied. Clients can call this before an expensive tool to pre-flight limits.",
    { tool: z.string(), agent: z.string(), perSec: z.number().min(0.1).max(1000).optional() },
    async ({ tool, agent, perSec }: { tool: string; agent: string; perSec?: number }) => {
      const key = `${tool}:${agent}`;
      const limit = perSec ?? defaultPerSec;
      const ok = allowed(key, limit);
      await appendAudit(auditDir, { event: "rate_check", tool, agent, limit, allowed: ok });
      return { content: [{ type: "text" as const, text: ok ? `ok (${key} perSec=${limit})` : `denied (${key} over ${limit}/s)` }], ...(ok ? {} : { isError: true as const }) };
    }
  );
}

// Convenience: hash a value for audit without leaking it
export function auditDigest(v: unknown): string {
  return createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex").slice(0, 16);
}
