// Workflow MCP tools: offset diff / merge, AC risk report,
// signature cross-build validator, cheat-sheet generator.

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface OffsetMap { [name: string]: string | number | bigint; }

function hex(v: string | number | bigint): string {
  if (typeof v === "string") return v;
  return "0x" + v.toString(16);
}

export function registerWorkflowTools(server: McpServer): void {
  server.tool(
    "offset_diff",
    "Diff two offset JSON maps (per-game dumps). Returns added / removed / changed keys with before/after values. Accepts both file paths and raw JSON strings.",
    {
      a: z.string().describe("Path to or raw JSON of the OLD offset map."),
      b: z.string().describe("Path to or raw JSON of the NEW offset map."),
    },
    async ({ a, b }: { a: string; b: string }) => {
      const load = async (s: string): Promise<OffsetMap> => {
        if (s.trim().startsWith("{")) return JSON.parse(s);
        return JSON.parse(await readFile(s, "utf8"));
      };
      try {
        const [oa, ob] = await Promise.all([load(a), load(b)]);
        const keysA = new Set(Object.keys(oa));
        const keysB = new Set(Object.keys(ob));
        const added = [...keysB].filter((k) => !keysA.has(k));
        const removed = [...keysA].filter((k) => !keysB.has(k));
        const changed: { key: string; from: string; to: string }[] = [];
        for (const k of keysA) {
          if (!keysB.has(k)) continue;
          if (String(oa[k]) !== String(ob[k])) changed.push({ key: k, from: hex(oa[k]), to: hex(ob[k]) });
        }
        const lines = [
          `# offset_diff`,
          `- added: ${added.length}`,
          `- removed: ${removed.length}`,
          `- changed: ${changed.length}`,
          ``,
        ];
        if (added.length) { lines.push("## added"); for (const k of added) lines.push(`+ ${k} = ${hex(ob[k])}`); }
        if (removed.length) { lines.push("", "## removed"); for (const k of removed) lines.push(`- ${k}`); }
        if (changed.length) { lines.push("", "## changed"); for (const c of changed) lines.push(`~ ${c.key}: ${c.from} -> ${c.to}`); }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `offset_diff error: ${(e as Error).message}` }], isError: true as const };
      }
    }
  );

  server.tool(
    "offset_merge",
    "Merge multiple offset JSON maps with voting. For each key, pick the value that at least `quorum` sources agree on (default 2). Reports disagreements.",
    {
      sources: z.array(z.string()).min(2).describe("Paths to or raw JSON of several offset maps."),
      quorum: z.number().min(1).max(10).default(2),
    },
    async ({ sources, quorum }: { sources: string[]; quorum: number }) => {
      const maps: OffsetMap[] = [];
      for (const s of sources) {
        maps.push(s.trim().startsWith("{") ? JSON.parse(s) : JSON.parse(await readFile(s, "utf8")));
      }
      const keys = new Set<string>();
      for (const m of maps) for (const k of Object.keys(m)) keys.add(k);
      const merged: Record<string, string> = {};
      const disagreements: { key: string; votes: Record<string, number> }[] = [];
      for (const k of keys) {
        const tally: Record<string, number> = {};
        for (const m of maps) {
          if (!(k in m)) continue;
          const v = String(m[k]);
          tally[v] = (tally[v] ?? 0) + 1;
        }
        const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
        if (sorted[0][1] >= quorum) merged[k] = sorted[0][0];
        if (sorted.length > 1) disagreements.push({ key: k, votes: tally });
      }
      return {
        content: [{
          type: "text" as const,
          text: `# offset_merge\n- merged keys: ${Object.keys(merged).length}\n- disagreements: ${disagreements.length}\n\n## merged (first 50)\n${Object.entries(merged).slice(0, 50).map(([k, v]) => `${k} = ${v}`).join("\n")}\n\n## disagreements (first 20)\n${disagreements.slice(0, 20).map((d) => `${d.key}: ${JSON.stringify(d.votes)}`).join("\n")}`,
        }],
      };
    }
  );

  server.tool(
    "sig_validate_cross_build",
    "Validate that an IDA-style AoB signature matches exactly ONCE in each of several builds. Catches signatures that drifted across patches.",
    {
      pattern: z.string(),
      builds: z.array(z.string()).min(1).describe("Paths to binary files."),
    },
    async ({ pattern, builds }: { pattern: string; builds: string[] }) => {
      const { parsePattern, scanPattern } = await import("./native-re.js");
      const sig = parsePattern(pattern);
      const results: string[] = [];
      let allUnique = true;
      for (const b of builds) {
        try {
          const buf = await readFile(b);
          const hits = scanPattern(buf, sig, 10);
          const unique = hits.length === 1;
          if (!unique) allUnique = false;
          results.push(`- ${b}: ${hits.length} match${hits.length === 1 ? "" : "es"} ${unique ? "(unique OK)" : "(DRIFT)"}  ${hits.slice(0, 3).map((o) => "0x" + o.toString(16)).join(", ")}`);
        } catch (e) {
          results.push(`- ${b}: ERROR ${(e as Error).message}`);
          allUnique = false;
        }
      }
      return { content: [{ type: "text" as const, text: `# sig_validate_cross_build\npattern: ${pattern}\n\n${results.join("\n")}\n\nverdict: ${allUnique ? "SIGNATURE STABLE" : "SIGNATURE DRIFTED"}` }] };
    }
  );

  server.tool(
    "ac_risk_report",
    "Build a risk matrix: techniques (rows) × anti-cheats (cols) → detection risk tier. Draws on the skill library's per-AC + per-technique knowledge. Returns a markdown table.",
    {
      techniques: z.array(z.string()).min(1).describe("Techniques to assess (e.g. 'manual-map', 'ept-hook', 'dma-fpga', 'byovd')."),
      anticheats: z.array(z.string()).default(["battleye", "eac", "vanguard", "faceit", "vac", "ricochet", "mhyprot"]).describe("ACs to assess against."),
    },
    async ({ techniques, anticheats }: { techniques: string[]; anticheats: string[] }) => {
      // Static risk matrix. Tiered A (safe), B (moderate), C (burn risk), X (detected).
      const risk: Record<string, Record<string, string>> = {
        "manual-map":  { battleye: "C", eac: "C", vanguard: "X", faceit: "C", vac: "B", ricochet: "C", mhyprot: "B" },
        "ept-hook":    { battleye: "A", eac: "B", vanguard: "B", faceit: "A", vac: "A", ricochet: "B", mhyprot: "A" },
        "dma-fpga":    { battleye: "A", eac: "A", vanguard: "A", faceit: "B", vac: "A", ricochet: "A", mhyprot: "A" },
        "byovd":       { battleye: "C", eac: "C", vanguard: "X", faceit: "C", vac: "B", ricochet: "C", mhyprot: "C" },
        "yolo-aim":    { battleye: "A", eac: "A", vanguard: "A", faceit: "B", vac: "A", ricochet: "B", mhyprot: "A" },
        "overlay-dx11":{ battleye: "C", eac: "C", vanguard: "X", faceit: "C", vac: "B", ricochet: "C", mhyprot: "B" },
        "vk-layer":    { battleye: "B", eac: "B", vanguard: "X", faceit: "B", vac: "B", ricochet: "B", mhyprot: "B" },
        "cheat-engine":{ battleye: "X", eac: "X", vanguard: "X", faceit: "X", vac: "C", ricochet: "X", mhyprot: "C" },
        "arduino-hid": { battleye: "A", eac: "A", vanguard: "A", faceit: "A", vac: "A", ricochet: "A", mhyprot: "A" },
      };
      const header = ["technique", ...anticheats].join(" | ");
      const sep = ["---", ...anticheats.map(() => "---")].join(" | ");
      const rows = techniques.map((t) => {
        const row = risk[t] ?? {};
        return [t, ...anticheats.map((ac) => row[ac] ?? "?")].join(" | ");
      });
      return { content: [{ type: "text" as const, text: `# AC risk matrix\n\nTier: A=safe, B=moderate, C=burn risk, X=detected.\n\n| ${header} |\n| ${sep} |\n| ${rows.join(" |\n| ")} |\n` }] };
    }
  );

  server.tool(
    "generate_cheat_sheet",
    "Generate a per-game cheat sheet (markdown) from the skill library: key offsets, engine, ACs, bypass stance, recommended backends. Reads the game-offsets plugin + specialist agent.",
    { game: z.string().describe("Game name (e.g. 'cs2', 'valorant', 'apex').") },
    async ({ game }: { game: string }) => {
      const lines = [
        `# Cheat Sheet: ${game}`,
        ``,
        `## Engine`,
        `See the per-engine specialist agent (unreal-engine-specialist, unity-specialist, source-engine-specialist, cs2-specialist).`,
        ``,
        `## Offsets`,
        `Call \`extract_offsets game=${game}\` or read the \`${game}-offsets\` plugin.`,
        ``,
        `## Anti-Cheat`,
        `Use the \`anti-cheat-timeline\` plugin + \`ac_risk_report\` for current detection surface.`,
        ``,
        `## Recommended RE Backends`,
        `- Static: \`superghidra-mcp\` or \`ida-pro-mcp\``,
        `- Dynamic: \`x64dbg-mcp\` (usermode) + \`windbg-mcp\` (kernel)`,
        `- Memory scan: \`cheat-engine-mcp\``,
        `- DMA (if available): \`pcileech-mcp\``,
        `- Overlay-free aim: see skills \`yolo-aim-pipeline\` + \`usb-rubber-input\``,
        ``,
        `## Workflow`,
        `1. \`research_technique\` for prior art.`,
        `2. \`get_agent_briefing\` for the per-game specialist.`,
        `3. \`extract_offsets\` + \`compare_projects\` for the latest build.`,
        `4. \`ac_risk_report\` to pick a safe stance.`,
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
