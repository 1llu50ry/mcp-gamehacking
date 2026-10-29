// ============================================================
// Central error-message sanitiser.
//
// Many tool handlers surface the raw exception message in their
// response text via patterns like
//     catch (e) { return err(`${(e as Error).message}`); }
// A raw Error.message can carry:
//   - absolute filesystem paths (leaking the install location)
//   - driver / system letters on Windows
//   - stack traces when the error is a Node internal
//   - CR/LF — the js/xss-through-exception CodeQL finding was that
//     an attacker-controlled payload could inject a header break
//     into the response text if the server embedded Error.message
//     into an HTTP header
//   - ANSI escape codes from colored stderr libraries
//
// `cleanErrorMessage(e)` strips every one of those classes, caps the
// output length, and tags the output with the trace-id of the current
// request so operators can grep the full stack in their logs by that
// id without the message itself leaking the stack content to callers.
//
// `wrapToolError(e, label)` returns an isError MCP response ready to
// hand back from a tool handler.
// ============================================================

import { randomUUID } from "node:crypto";

const PATH_RE = /(?:[A-Za-z]:\\|\/)(?:[\w .\\/-]+)/g;
const CRLF_RE = /[\r\n\t]+/g;
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

interface Sanitised { text: string; traceId: string }

export function cleanErrorMessage(e: unknown, opts: { maxLen?: number } = {}): Sanitised {
  const maxLen = opts.maxLen ?? 240;
  const traceId = randomUUID().slice(0, 8);
  let raw: string;
  if (e instanceof Error) raw = e.message;
  else if (typeof e === "string") raw = e;
  else { try { raw = JSON.stringify(e); } catch { raw = String(e); } }
  const scrubbed = raw
    .replace(ANSI_RE, "")
    .replace(PATH_RE, "<path>")
    .replace(CRLF_RE, " ")
    .trim();
  const clipped = scrubbed.length > maxLen ? scrubbed.slice(0, maxLen) + "…" : scrubbed;
  // Also log the full raw message to stderr so operators can correlate
  // the clipped text with the real exception via `trace`.
  try {
    process.stderr.write(JSON.stringify({
      ts: new Date().toISOString(),
      trace: traceId,
      kind: "tool_error",
      raw: raw.slice(0, 2000),
      stack: e instanceof Error ? e.stack?.split("\n").slice(0, 5).join(" | ") : undefined,
    }) + "\n");
  } catch { /* stderr closed during shutdown — give up quietly */ }
  return { text: clipped, traceId };
}

export interface ToolErrorResp { content: { type: "text"; text: string }[]; isError: true }

export function wrapToolError(e: unknown, label: string, opts: { maxLen?: number } = {}): ToolErrorResp {
  const s = cleanErrorMessage(e, opts);
  return {
    content: [{ type: "text" as const, text: `# ${label} error [trace=${s.traceId}]\n\n${s.text}` }],
    isError: true as const,
  };
}
