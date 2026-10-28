// ============================================================
// SVG visualization — call graphs and CFGs.
//
// Pure-TS Sugiyama-ish layered layout: topological order by depth,
// right-pack within each layer, straight edges with light bezier
// curves on back-edges. The output is a complete <svg> document
// renderable in any browser / Markdown preview / the /dashboard.
//
// Zero deps.
//
// Inputs are declarative — nodes with ids and labels, edges by id —
// so a plugin bridge or an upstream tool (ghidra_xrefs, ida_disasm)
// can hand them to viz_call_graph without us having to know their
// internals.
// ============================================================

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface Node { id: string; label: string; kind?: "func" | "block" | "data" }
export interface Edge { from: string; to: string; kind?: "call" | "jmp" | "jcc" | "data" }

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderSvgGraph(nodes: Node[], edges: Edge[], opts: { title?: string } = {}): string {
  // 1. layer assignment: longest-path depth from roots.
  const inDeg = new Map<string, number>();
  const outAdj = new Map<string, string[]>();
  for (const n of nodes) { inDeg.set(n.id, 0); outAdj.set(n.id, []); }
  for (const e of edges) {
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    outAdj.get(e.from)?.push(e.to);
  }
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) if (inDeg.get(n.id) === 0) { depth.set(n.id, 0); queue.push(n.id); }
  while (queue.length) {
    const n = queue.shift()!;
    const d = depth.get(n) ?? 0;
    for (const succ of outAdj.get(n) ?? []) {
      depth.set(succ, Math.max(depth.get(succ) ?? 0, d + 1));
      inDeg.set(succ, (inDeg.get(succ) ?? 0) - 1);
      if ((inDeg.get(succ) ?? 0) === 0) queue.push(succ);
    }
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0);

  // 2. pack nodes into layers.
  const layers: string[][] = [];
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    layers[d] ??= []; layers[d].push(n.id);
  }

  // 3. coordinates.
  const CW = 160, CH = 44, HG = 60, VG = 32;
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  let maxLayerSize = 0;
  for (const layer of layers) maxLayerSize = Math.max(maxLayerSize, layer.length);
  for (let d = 0; d < layers.length; d++) {
    const layer = layers[d];
    const totalW = layer.length * CW + (layer.length - 1) * HG;
    const startX = ((maxLayerSize * (CW + HG) - HG) - totalW) / 2 + 20;
    for (let i = 0; i < layer.length; i++) {
      pos.set(layer[i], {
        x: startX + i * (CW + HG),
        y: 20 + d * (CH + VG),
        w: CW, h: CH,
      });
    }
  }

  const width  = Math.max(300, maxLayerSize * (CW + HG) + 40);
  const height = Math.max(200, layers.length * (CH + VG) + 40);
  const title = opts.title ?? "graph";

  const svg: string[] = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  svg.push(`<style>
    text{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;fill:#e8ecef}
    .bg{fill:#161b22;stroke:#30363d}
    .func{fill:#161b22;stroke:#58a6ff}
    .block{fill:#161b22;stroke:#3fb950}
    .data{fill:#161b22;stroke:#d29922}
    .edge-call{stroke:#58a6ff;fill:none}
    .edge-jmp{stroke:#8b949e;fill:none}
    .edge-jcc{stroke:#f85149;fill:none;stroke-dasharray:4 3}
    .title{font-size:13px;fill:#9aa3ad}
  </style>`);
  svg.push(`<rect width="100%" height="100%" fill="#0b0d10"/>`);
  svg.push(`<text class="title" x="20" y="16">${escapeXml(title)}  —  ${nodes.length} nodes · ${edges.length} edges</text>`);

  // Edges
  svg.push(`<defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#8b949e"/>
    </marker>
  </defs>`);
  for (const e of edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + a.w / 2, y1 = a.y + a.h;
    const x2 = b.x + b.w / 2, y2 = b.y;
    const cls = e.kind === "call" ? "edge-call" : e.kind === "jcc" ? "edge-jcc" : "edge-jmp";
    const dx = (x2 - x1) * 0.3;
    svg.push(`<path class="${cls}" marker-end="url(#arr)" d="M ${x1} ${y1} C ${x1 + dx} ${y1 + 20}, ${x2 - dx} ${y2 - 20}, ${x2} ${y2 - 4}"/>`);
  }

  // Nodes
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    const cls = n.kind ?? "func";
    svg.push(`<rect class="${cls}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6" ry="6"/>`);
    const t = n.label.length > 20 ? n.label.slice(0, 20) + "…" : n.label;
    svg.push(`<text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + 4}" text-anchor="middle">${escapeXml(t)}</text>`);
  }

  svg.push(`</svg>`);
  return svg.join("\n");
}

export function registerViz(server: McpServer): void {
  server.tool(
    "viz_call_graph",
    "Render a call graph as SVG (nodes = functions, edges = calls). Returns the complete <svg> document.",
    {
      nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(["func", "block", "data"]).optional() })),
      edges: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(["call", "jmp", "jcc", "data"]).optional() })),
      title: z.string().optional(),
    },
    async ({ nodes, edges, title }) => {
      const svg = renderSvgGraph(nodes, edges, { title });
      return { content: [{ type: "text" as const, text: svg }] };
    },
  );
  server.tool(
    "viz_cfg",
    "Render a control-flow graph as SVG (nodes = basic blocks, edges = jmp/jcc). Same inputs as viz_call_graph but defaults every node to kind=block.",
    {
      nodes: z.array(z.object({ id: z.string(), label: z.string() })),
      edges: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(["jmp", "jcc"]).default("jmp") })),
      title: z.string().optional(),
    },
    async ({ nodes, edges, title }) => {
      const svg = renderSvgGraph(nodes.map(n => ({ ...n, kind: "block" as const })), edges, { title });
      return { content: [{ type: "text" as const, text: svg }] };
    },
  );
}
