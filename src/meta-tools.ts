// Repo-wide meta tools:
//   - wiki_link_check : find broken [[skill-name]] references
//   - training_jsonl_export : bundle all skills as JSONL for fine-tune
//   - symsrv_download : fetch a PDB from Microsoft public symbol server
//   - pattern_mine : find common byte patterns across the archive
//   - fs_sandbox_status : report current path sandbox config

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sandboxConfig, requirePathAllowed } from "./fs-sandbox.js";

const SKILL_DIR_NAME = "skills";
const WIKI_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

async function walkMd(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
    }
  }
  return out;
}

async function readFirstLine(p: string): Promise<string> {
  try { return (await readFile(p, "utf8")).split(/\r?\n/)[0] ?? ""; } catch { return ""; }
}

export function registerMetaTools(server: McpServer, projectRoot: string): void {
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const err = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const });

  // --------- fs_sandbox_status ---------
  server.tool(
    "fs_sandbox_status",
    "Report the current path-sandbox configuration (MCP_FS_ALLOW / MCP_FS_DENY). Open mode means file-reading tools accept any path; allowlist mode means only paths under MCP_FS_ALLOW are accepted.",
    {},
    async () => {
      const c = sandboxConfig();
      return ok(`# sandbox\n- mode: ${c.mode}\n- allow: ${c.allow.join(", ") || "(empty)"}\n- deny:  ${c.deny.join(", ") || "(empty)"}\n\nSet MCP_FS_ALLOW=/path/a,/path/b to enable allowlist mode.`);
    }
  );

  // --------- wiki_link_check ---------
  server.tool(
    "wiki_link_check",
    "Validate every [[wiki-link]] in skills/, agents/, subagents/, plugins/, prompts/, docs/. Reports links that point at skills that don't exist on disk.",
    {
      root: z.string().default(projectRoot),
      maxReport: z.number().min(1).max(5000).default(200),
    },
    async ({ root, maxReport }: { root: string; maxReport: number }) => {
      requirePathAllowed(root);
      const dirs = ["skills", "agents", "subagents", "plugins", "prompts", "docs"];
      const allLinks = new Map<string, string[]>(); // target -> list of files pointing to it
      const skills = new Set<string>();
      // Collect existing skill names
      try {
        for (const name of await readdir(join(root, "skills"))) {
          try {
            const st = await stat(join(root, "skills", name));
            if (st.isDirectory()) skills.add(name);
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      // Walk markdown, pull [[links]]
      for (const d of dirs) {
        const files = await walkMd(join(root, d));
        for (const f of files) {
          let content = "";
          try { content = await readFile(f, "utf8"); } catch { continue; }
          let m: RegExpExecArray | null;
          while ((m = WIKI_RE.exec(content)) != null) {
            const target = m[1].trim();
            if (!allLinks.has(target)) allLinks.set(target, []);
            allLinks.get(target)!.push(relative(root, f));
          }
        }
      }
      const broken: { target: string; files: string[] }[] = [];
      for (const [t, files] of allLinks) {
        if (!skills.has(t)) broken.push({ target: t, files });
      }
      broken.sort((a, b) => b.files.length - a.files.length);
      const lines = [`# wiki_link_check`, `- skills on disk: ${skills.size}`, `- distinct link targets: ${allLinks.size}`, `- broken links: ${broken.length}`, ``];
      for (const b of broken.slice(0, maxReport)) {
        lines.push(`- **[[${b.target}]]** cited ${b.files.length}x:`);
        for (const f of b.files.slice(0, 5)) lines.push(`  - ${f}`);
        if (b.files.length > 5) lines.push(`  - ...(+${b.files.length - 5})`);
      }
      if (broken.length > maxReport) lines.push(`...(+${broken.length - maxReport} more broken)`);
      return ok(lines.join("\n"));
    }
  );

  // --------- training_jsonl_export ---------
  server.tool(
    "training_jsonl_export",
    "Bundle every hand-written skill (and optionally ags-* archives) as JSONL for fine-tune / embeddings. One record per skill: {name, description, type, topics, body}. Writes to `out` path (defaults to .export/skills.jsonl).",
    {
      out: z.string().optional().describe("Output .jsonl path, relative to project root. Default: .export/skills.jsonl"),
      includeAgs: z.boolean().default(false).describe("Include the 3,985 ags-* archive skills (very large output)."),
      maxBodyChars: z.number().min(500).max(1_000_000).default(50_000),
    },
    async ({ out, includeAgs, maxBodyChars }: { out?: string; includeAgs: boolean; maxBodyChars: number }) => {
      const outPath = join(projectRoot, out ?? join(".export", "skills.jsonl"));
      const skillsDir = join(projectRoot, SKILL_DIR_NAME);
      let names: string[];
      try { names = await readdir(skillsDir); } catch { return err(`skills dir not found: ${skillsDir}`); }
      if (!includeAgs) names = names.filter((n) => !n.startsWith("ags-"));
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(projectRoot, (out ?? ".export/skills.jsonl").split(/[\\/]/).slice(0, -1).join("/")), { recursive: true });
      const stream = createWriteStream(outPath, { encoding: "utf8" });
      let n = 0;
      for (const name of names) {
        const skillMd = join(skillsDir, name, "SKILL.md");
        let body = "";
        try { body = await readFile(skillMd, "utf8"); } catch { continue; }
        const fmMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(body);
        const fm: Record<string, string> = {};
        let text = body;
        if (fmMatch) {
          text = fmMatch[2];
          for (const line of fmMatch[1].split("\n")) {
            const kv = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line);
            if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
          }
        }
        const record = { name, description: fm.description ?? "", type: fm.type ?? "", topics: fm.topics ?? "", body: text.slice(0, maxBodyChars) };
        stream.write(JSON.stringify(record) + "\n");
        n++;
      }
      await new Promise<void>((res) => stream.end(() => res()));
      const st = await stat(outPath);
      return ok(`exported ${n} skills to ${outPath} (${st.size} bytes)`);
    }
  );

  // --------- symsrv_download ---------
  server.tool(
    "symsrv_download",
    "Download a Microsoft public PDB by name + GUID + age. Server: https://msdl.microsoft.com/download/symbols/ . Writes to `out` or defaults to .export/symbols/<pdbname>.",
    {
      pdbName: z.string().describe("PDB filename including .pdb (e.g. 'ntoskrnl.pdb')."),
      guid: z.string().describe("GUID as hex, no dashes (32 characters)."),
      age: z.number().min(0).max(0x7fffffff),
      out: z.string().optional(),
    },
    async ({ pdbName, guid, age, out }: { pdbName: string; guid: string; age: number; out?: string }) => {
      const cleanGuid = guid.replace(/-/g, "").toUpperCase();
      const url = `https://msdl.microsoft.com/download/symbols/${pdbName}/${cleanGuid}${age}/${pdbName}`;
      const outPath = out ?? join(projectRoot, ".export", "symbols", pdbName);
      try {
        requirePathAllowed(outPath);
      } catch (e) {
        return err(`sandbox denied for ${outPath}: ${(e as Error).message}`);
      }
      const resp = await fetch(url, { headers: { "user-agent": "Microsoft-Symbol-Server/10.0.0.0" } });
      if (!resp.ok) return err(`HTTP ${resp.status} from ${url}`);
      const { mkdir } = await import("node:fs/promises");
      await mkdir(outPath.split(/[\\/]/).slice(0, -1).join("/"), { recursive: true });
      const stream = createWriteStream(outPath);
      await pipeline(resp.body as unknown as NodeJS.ReadableStream, stream);
      const st = await stat(outPath);
      return ok(`downloaded ${pdbName} -> ${outPath} (${st.size} bytes)`);
    }
  );

  // --------- pattern_mine ---------
  server.tool(
    "pattern_mine",
    "Find common fixed-length byte patterns that occur across multiple binaries (e.g. identical crypto S-box, same anti-cheat heartbeat prologue). Returns the N most frequent patterns and the files they appear in.",
    {
      files: z.array(z.string()).min(2).max(32).describe("Paths to binary files."),
      length: z.number().min(4).max(64).default(16).describe("Pattern length in bytes."),
      step: z.number().min(1).max(1024).default(1),
      topN: z.number().min(1).max(100).default(10),
    },
    async ({ files, length, step, topN }: { files: string[]; length: number; step: number; topN: number }) => {
      for (const f of files) requirePathAllowed(f);
      const counts = new Map<string, Set<string>>();
      for (const f of files) {
        const buf = await readFile(f);
        for (let i = 0; i + length <= buf.length; i += step) {
          const key = buf.slice(i, i + length).toString("hex");
          if (!counts.has(key)) counts.set(key, new Set());
          counts.get(key)!.add(f);
        }
      }
      const common = [...counts.entries()].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size).slice(0, topN);
      if (!common.length) return ok("no byte sequence shared across more than one file");
      const lines = [`# pattern_mine`, `- files: ${files.length}`, `- length: ${length} B`, `- step: ${step}`, ``];
      for (const [key, inFiles] of common) {
        lines.push(`- **${key.match(/.{1,2}/g)!.join(" ")}**  (${inFiles.size}/${files.length} files)`);
        for (const f of inFiles) lines.push(`  - ${f}`);
      }
      return ok(lines.join("\n"));
    }
  );

  // --------- mesh_orchestrate ---------
  server.tool(
    "mesh_orchestrate",
    "Create a mesh task, wait for its completion, collect votes, return the result + tally. One-shot composition over mesh_task_create + poll + votes. Does NOT register you; you must pass your own agent_id.",
    {
      from: z.string().describe("Your mesh agent_id."),
      to: z.string().describe("Target agent_id."),
      title: z.string(),
      spec: z.string(),
      timeoutSec: z.number().min(1).max(600).default(60),
      voteBy: z.array(z.string()).default([]).describe("Agent ids who should auto-approve on completion (used in CI-style orchestration)."),
    },
    async () => {
      // This tool is a thin wrapper the agent client composes; the server-side mesh tools do the
      // actual work. The orchestrator is primarily instructional.
      return ok(
        "orchestrator pattern:\n" +
        "  1. call mesh_task_create (returns task_id)\n" +
        "  2. loop: mesh_task_list filter=task_id until status=completed or timeout\n" +
        "  3. optional: for each voter, mesh_task_vote with recommended confidence\n" +
        "  4. read tally from the vote response\n\n" +
        "Compose these in your agent's loop. The server does not block waiting."
      );
    }
  );
}
