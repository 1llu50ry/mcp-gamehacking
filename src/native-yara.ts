// ============================================================
// Native YARA-light engine. Supports a strict subset of real YARA:
//
//   rule name
//   {
//     meta:
//       author = "..."
//       description = "..."
//     strings:
//       $s1 = "plain text"
//       $s2 = { 48 8B ?? ?? ?? ?? ?? E8 }       // hex with wildcards
//       $s3 = /regex/                           // JS regex
//     condition:
//       any of them
//       | all of them
//       | $s1 and $s2
//       | $s1 or $s3
//       | 2 of ($s*)
//   }
//
// Not a full YARA replacement — no modules (pe, elf, math), no `at`
// positional conditions, no imports, no includes. Covers the ~80% that
// game-security YARA rules actually use.
// ============================================================

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requirePathAllowed } from "./fs-sandbox.js";

interface YaraString {
  id: string;
  kind: "text" | "hex" | "regex";
  pattern: string;
  bytes?: { any: boolean; value: number }[]; // for hex
  text?: Buffer;                              // for text
  regex?: RegExp;                             // for regex
}

interface YaraRule {
  name: string;
  meta: Record<string, string>;
  strings: YaraString[];
  condition: string;      // raw string, evaluated at scan time
}

function parseHexPattern(src: string): { any: boolean; value: number }[] {
  const bytes: { any: boolean; value: number }[] = [];
  const tokens = src.trim().split(/\s+/);
  for (const t of tokens) {
    if (t === "??" || t === "?") { bytes.push({ any: true, value: 0 }); continue; }
    if (/^[0-9a-fA-F]{2}$/.test(t)) { bytes.push({ any: false, value: parseInt(t, 16) }); continue; }
    throw new Error(`invalid hex token "${t}"`);
  }
  return bytes;
}

export function parseYaraRules(src: string): YaraRule[] {
  // Balanced-brace scanner. We can't use a plain regex because YARA hex
  // strings use `{ 48 8B ?? }` which collides with the outer rule-body
  // braces. Walk the source, find each `rule <name>`, then count braces
  // from the first `{` after the name, respecting matching pairs.
  const rules: YaraRule[] = [];
  const headRe = /\brule\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let headMatch: RegExpExecArray | null;
  while ((headMatch = headRe.exec(src)) != null) {
    const name = headMatch[1];
    const bodyStart = headRe.lastIndex;    // position just after the opening `{`
    let depth = 1;
    let i = bodyStart;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    if (depth !== 0) break; // unbalanced — stop here
    const body = src.slice(bodyStart, i - 1); // exclude closing `}`
    headRe.lastIndex = i; // continue scanning after this rule
    const m = [headMatch[0], name, body] as unknown as RegExpExecArray;
    void m;
    const meta: Record<string, string> = {};
    const strings: YaraString[] = [];
    let condition = "";

    const metaRe = /meta:\s*([\s\S]*?)(?=\n\s*(?:strings|condition):)/;
    const stringsRe = /strings:\s*([\s\S]*?)(?=\n\s*condition:)/;
    const condRe = /condition:\s*([\s\S]*?)\s*$/;

    const metaMatch = body.match(metaRe);
    if (metaMatch) {
      for (const line of metaMatch[1].split("\n")) {
        const kv = /^\s*(\w+)\s*=\s*"([^"]*)"/.exec(line);
        if (kv) meta[kv[1]] = kv[2];
      }
    }

    const strMatch = body.match(stringsRe);
    if (strMatch) {
      const lines = strMatch[1].split("\n");
      for (const line of lines) {
        const txt = /^\s*(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line);
        if (txt) {
          const unescape = txt[2].replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, "$1");
          strings.push({ id: txt[1], kind: "text", pattern: txt[2], text: Buffer.from(unescape, "latin1") });
          continue;
        }
        const hex = /^\s*(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{([^}]+)\}/.exec(line);
        if (hex) {
          strings.push({ id: hex[1], kind: "hex", pattern: hex[2].trim(), bytes: parseHexPattern(hex[2]) });
          continue;
        }
        const rx = /^\s*(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*\/((?:[^\/\\]|\\.)+)\/([a-z]*)/.exec(line);
        if (rx) {
          strings.push({ id: rx[1], kind: "regex", pattern: rx[2], regex: new RegExp(rx[2], rx[3] || "s") });
          continue;
        }
      }
    }

    const cm = body.match(condRe);
    if (cm) condition = cm[1].trim();

    rules.push({ name, meta, strings, condition });
  }
  return rules;
}

interface ScanHit { ruleName: string; stringId: string; offset: number; length: number; preview: string; }

function matchText(buf: Buffer, text: Buffer, max = 16): number[] {
  const hits: number[] = [];
  if (text.length === 0) return hits;
  let i = 0;
  while (i <= buf.length - text.length) {
    const found = buf.indexOf(text, i);
    if (found < 0) break;
    hits.push(found);
    if (hits.length >= max) break;
    i = found + 1;
  }
  return hits;
}

function matchHex(buf: Buffer, sig: { any: boolean; value: number }[], max = 16): number[] {
  const hits: number[] = [];
  if (!sig.length) return hits;
  outer:
  for (let i = 0; i + sig.length <= buf.length; i++) {
    for (let j = 0; j < sig.length; j++) {
      const s = sig[j];
      if (!s.any && buf[i + j] !== s.value) continue outer;
    }
    hits.push(i);
    if (hits.length >= max) break;
  }
  return hits;
}

function matchRegex(buf: Buffer, re: RegExp, max = 16): number[] {
  const text = buf.toString("latin1");
  const hits: number[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) != null) {
    hits.push(m.index);
    if (hits.length >= max) break;
  }
  return hits;
}

function scanRule(buf: Buffer, rule: YaraRule): ScanHit[] {
  const hits: ScanHit[] = [];
  const matchesByString: Record<string, number[]> = {};
  for (const s of rule.strings) {
    let offsets: number[] = [];
    if (s.kind === "text" && s.text) offsets = matchText(buf, s.text);
    else if (s.kind === "hex" && s.bytes) offsets = matchHex(buf, s.bytes);
    else if (s.kind === "regex" && s.regex) offsets = matchRegex(buf, s.regex);
    matchesByString[s.id] = offsets;
    for (const off of offsets) {
      const previewLen = Math.min(32, buf.length - off);
      const preview = buf.slice(off, off + previewLen).toString("hex").match(/.{1,2}/g)?.join(" ") ?? "";
      hits.push({ ruleName: rule.name, stringId: s.id, offset: off, length: s.text?.length ?? s.bytes?.length ?? previewLen, preview });
    }
  }
  if (!evalCondition(rule.condition, matchesByString, rule.strings)) return [];
  return hits;
}

function evalCondition(cond: string, matches: Record<string, number[]>, strings: YaraString[]): boolean {
  const c = cond.toLowerCase().trim();
  const satisfied = (id: string) => (matches[id]?.length ?? 0) > 0;
  const anyOf = () => strings.some((s) => satisfied(s.id));
  const allOf = () => strings.every((s) => satisfied(s.id));
  if (c === "any of them") return anyOf();
  if (c === "all of them") return allOf();
  // "N of ($s*)" or "N of them"
  const nOf = /^(\d+)\s+of\s+(.+)$/.exec(c);
  if (nOf) {
    const n = parseInt(nOf[1], 10);
    const set = nOf[2].trim();
    let count = 0;
    for (const s of strings) {
      if (set === "them" || set === "($s*)" || set.replace(/\s/g, "") === `(${s.id}*)` || set.includes(s.id)) {
        if (satisfied(s.id)) count++;
      }
    }
    return count >= n;
  }
  // boolean expression with $ids, and/or
  const expr = c.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, (m) => (satisfied(m) ? "true" : "false"));
  // only allow identifiers true/false/and/or/not and parens
  if (!/^[\s()tfruealsndo]+$/.test(expr.replace(/\btrue\b|\bfalse\b|\band\b|\bor\b|\bnot\b/g, ""))) return false;
  try {
    // ESLint-safe: Function constructor over a strictly-filtered string
    const js = expr.replace(/\band\b/g, "&&").replace(/\bor\b/g, "||").replace(/\bnot\b/g, "!");
    // eslint-disable-next-line no-new-func
    return !!Function(`"use strict"; return (${js});`)();
  } catch { return false; }
}

export function registerNativeYara(server: McpServer): void {
  server.tool(
    "yara_scan",
    "Scan a file with native YARA-light rules (text / hex-wildcard / regex strings + condition: any/all/N-of/boolean). Not a drop-in YARA replacement — no modules, no imports — but covers typical game-security rules.",
    {
      path: z.string(),
      rules: z.string().describe("YARA rule source (one or more `rule <name> { ... }` blocks) OR a path to a .yar file."),
      maxHits: z.number().min(1).max(1000).default(32),
    },
    async ({ path, rules, maxHits }: { path: string; rules: string; maxHits: number }) => {
      try {
        requirePathAllowed(path);
        const buf = await readFile(path);
        const ruleSrc = rules.trim().startsWith("rule") ? rules : await (async () => {
          requirePathAllowed(rules);
          return readFile(rules, "utf8");
        })();
        const parsed = parseYaraRules(ruleSrc);
        if (!parsed.length) return { content: [{ type: "text" as const, text: `no rules parsed from source (${ruleSrc.length} chars)` }], isError: true as const };
        const allHits: ScanHit[] = [];
        const triggered: string[] = [];
        for (const r of parsed) {
          const hits = scanRule(buf, r);
          if (hits.length) {
            triggered.push(r.name);
            allHits.push(...hits.slice(0, maxHits));
          }
        }
        const lines = [`# yara_scan ${path}`, `rules: ${parsed.length}  triggered: ${triggered.length}  (${triggered.join(", ") || "-"})`, `hits: ${allHits.length}`, ``];
        for (const h of allHits.slice(0, maxHits)) {
          lines.push(`- [${h.ruleName}] ${h.stringId}  0x${h.offset.toString(16)}  ${h.preview}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `yara_scan error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "yara_parse",
    "Parse a YARA rule source and return the AST (meta, strings, condition) without scanning. Validates syntax.",
    { rules: z.string() },
    async ({ rules }: { rules: string }) => {
      try {
        const parsed = parseYaraRules(rules);
        const lines = [`# yara_parse — ${parsed.length} rules`, ``];
        for (const r of parsed) {
          lines.push(`## ${r.name}`);
          if (Object.keys(r.meta).length) lines.push(`meta: ${JSON.stringify(r.meta)}`);
          for (const s of r.strings) lines.push(`  ${s.id} (${s.kind}): ${s.pattern}`);
          lines.push(`  condition: ${r.condition}`);
          lines.push(``);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `yara_parse error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );
}
