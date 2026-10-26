// ============================================================
// Filesystem sandbox for file-reading MCP tools.
//
// Any tool that takes a `path` argument should guard it with
// `requirePathAllowed(path)` before `readFile`. The allowlist is
// built from:
//
//   MCP_FS_ALLOW   -- comma-separated list of allowed root dirs
//   MCP_FS_DENY    -- comma-separated list of denied roots (wins over allow)
//
// Default policy when MCP_FS_ALLOW is unset: allow everything
// (back-compat with previous behavior). Explicit opt-in is
// recommended when the server is reachable over HTTP.
// ============================================================

import { resolve, normalize, sep } from "node:path";

function parseList(env?: string): string[] {
  if (!env) return [];
  return env.split(/[,;]+/).map((s) => s.trim()).filter(Boolean).map((p) => resolve(normalize(p)));
}

function withSep(p: string): string { return p.endsWith(sep) ? p : p + sep; }

function match(path: string, roots: string[]): boolean {
  if (!roots.length) return false;
  const abs = resolve(normalize(path));
  for (const r of roots) {
    const rr = withSep(r);
    if (abs === r || abs.startsWith(rr)) return true;
  }
  return false;
}

export interface SandboxReport {
  allow: string[];
  deny: string[];
  mode: "open" | "allowlist";
}

export function sandboxConfig(): SandboxReport {
  const allow = parseList(process.env.MCP_FS_ALLOW);
  const deny = parseList(process.env.MCP_FS_DENY);
  return { allow, deny, mode: allow.length ? "allowlist" : "open" };
}

export class SandboxDenied extends Error {
  constructor(path: string, reason: string) { super(`sandbox denied: ${path} (${reason})`); this.name = "SandboxDenied"; }
}

export function requirePathAllowed(path: string): void {
  const { allow, deny } = sandboxConfig();
  if (match(path, deny)) throw new SandboxDenied(path, "in MCP_FS_DENY");
  if (allow.length === 0) return; // open mode
  if (!match(path, allow)) throw new SandboxDenied(path, "not in MCP_FS_ALLOW");
}
