// ============================================================
// Observability: a Prometheus-compatible /metrics endpoint and a
// tiny HTML dashboard that shows live counters, latencies, and the
// state of every plugin bridge.
//
// Zero deps — the exposition format is just plain text printed by
// hand, and the dashboard is a single static HTML+JS file.
//
// Usage from server.ts:
//
//   import { metrics, attachObservabilityRoutes } from "./observability.js";
//   // in HTTP transport setup:
//   const observed = attachObservabilityRoutes(httpServer);
//   // wrap every tool call:
//   metrics.toolCall("ghidra_functions", ms, { ok: true });
//
// The /metrics output follows the Prometheus text format v0.0.4; curl -s
// http://127.0.0.1:7777/metrics and prom-tools / Grafana scrape as-is.
// ============================================================

import type { IncomingMessage, ServerResponse, Server } from "node:http";

// ---- counters & histograms -----------------------------------

interface HistBucket { le: number; count: number }
interface Hist {
  buckets: HistBucket[];
  sum: number;
  count: number;
}

function newHist(): Hist {
  // SLO-shaped buckets (ms)
  const bs = [0.5, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
  return { buckets: bs.map(le => ({ le, count: 0 })), sum: 0, count: 0 };
}

function histObserve(h: Hist, v: number) {
  h.sum += v;
  h.count++;
  for (const b of h.buckets) if (v <= b.le) b.count++;
}

interface State {
  started: number;
  tool_calls_total: Record<string, number>;
  tool_errors_total: Record<string, number>;
  tool_latency_ms: Record<string, Hist>;
  http_requests_total: Record<string, number>;
  bridge_up:  Record<string, number>;
  bridge_last_check: Record<string, number>;
}

const state: State = {
  started: Date.now(),
  tool_calls_total: {},
  tool_errors_total: {},
  tool_latency_ms: {},
  http_requests_total: {},
  bridge_up: {},
  bridge_last_check: {},
};

export const metrics = {
  toolCall(tool: string, latencyMs: number, opts: { ok: boolean } = { ok: true }) {
    state.tool_calls_total[tool] = (state.tool_calls_total[tool] ?? 0) + 1;
    if (!opts.ok) state.tool_errors_total[tool] = (state.tool_errors_total[tool] ?? 0) + 1;
    state.tool_latency_ms[tool] ??= newHist();
    histObserve(state.tool_latency_ms[tool], latencyMs);
  },
  http(path: string) { state.http_requests_total[path] = (state.http_requests_total[path] ?? 0) + 1; },
  bridgeStatus(name: string, up: boolean) {
    state.bridge_up[name] = up ? 1 : 0;
    state.bridge_last_check[name] = Date.now();
  },
  snapshot() { return structuredClone(state); },
};

// ---- Prometheus exposition ------------------------------------

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function renderPrometheus(): string {
  const out: string[] = [];
  const uptime = Math.floor((Date.now() - state.started) / 1000);
  out.push("# HELP mcp_gamehacking_uptime_seconds server uptime");
  out.push("# TYPE mcp_gamehacking_uptime_seconds counter");
  out.push(`mcp_gamehacking_uptime_seconds ${uptime}`);

  out.push("# HELP mcp_tool_calls_total total MCP tool invocations");
  out.push("# TYPE mcp_tool_calls_total counter");
  for (const [k, v] of Object.entries(state.tool_calls_total)) {
    out.push(`mcp_tool_calls_total{tool="${sanitize(k)}"} ${v}`);
  }

  out.push("# HELP mcp_tool_errors_total total MCP tool failures");
  out.push("# TYPE mcp_tool_errors_total counter");
  for (const [k, v] of Object.entries(state.tool_errors_total)) {
    out.push(`mcp_tool_errors_total{tool="${sanitize(k)}"} ${v}`);
  }

  out.push("# HELP mcp_tool_latency_ms per-tool latency histogram");
  out.push("# TYPE mcp_tool_latency_ms histogram");
  for (const [tool, hist] of Object.entries(state.tool_latency_ms)) {
    for (const b of hist.buckets) {
      out.push(`mcp_tool_latency_ms_bucket{tool="${sanitize(tool)}",le="${b.le}"} ${b.count}`);
    }
    out.push(`mcp_tool_latency_ms_bucket{tool="${sanitize(tool)}",le="+Inf"} ${hist.count}`);
    out.push(`mcp_tool_latency_ms_sum{tool="${sanitize(tool)}"} ${hist.sum}`);
    out.push(`mcp_tool_latency_ms_count{tool="${sanitize(tool)}"} ${hist.count}`);
  }

  out.push("# HELP mcp_bridge_up state of a plugins-side bridge (1 up / 0 down)");
  out.push("# TYPE mcp_bridge_up gauge");
  for (const [k, v] of Object.entries(state.bridge_up)) {
    out.push(`mcp_bridge_up{bridge="${sanitize(k)}"} ${v}`);
  }

  return out.join("\n") + "\n";
}

// ---- dashboard HTML (served from /dashboard) ------------------

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>mcp-gamehacking · dashboard</title>
<style>
  :root { color-scheme: light dark; --bg:#0b0d10; --fg:#e8ecef; --mut:#9aa3ad; --acc:#58a6ff; --ok:#3fb950; --bad:#f85149; --card:#161b22; }
  html,body { background: var(--bg); color: var(--fg); font: 13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; margin: 0; }
  header { padding: 14px 20px; border-bottom: 1px solid #30363d; display: flex; gap: 16px; align-items: baseline; }
  h1 { font-size: 18px; margin: 0; }
  main { padding: 20px; display: grid; gap: 20px; grid-template-columns: 1fr 1fr; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid #30363d; border-radius: 8px; padding: 14px; }
  h2 { font-size: 14px; margin: 0 0 10px; color: var(--mut); text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 4px 6px; border-bottom: 1px solid #30363d44; text-align: left; }
  th { color: var(--mut); font-weight: normal; }
  .up { color: var(--ok); }
  .down { color: var(--bad); }
  .mono { font-variant-numeric: tabular-nums; }
  footer { padding: 10px 20px; color: var(--mut); font-size: 11px; border-top: 1px solid #30363d; }
</style>
</head>
<body>
  <header>
    <h1>mcp-gamehacking</h1>
    <span id="uptime" class="mono"></span>
    <span id="refresh" style="margin-left:auto;color:var(--mut)">refresh: 5s</span>
  </header>
  <main>
    <section class="card">
      <h2>bridges</h2>
      <table id="bridges"><thead><tr><th>name</th><th>status</th><th class="mono">last check</th></tr></thead><tbody></tbody></table>
    </section>
    <section class="card">
      <h2>top tools (calls)</h2>
      <table id="tools"><thead><tr><th>tool</th><th class="mono">calls</th><th class="mono">errors</th><th class="mono">avg ms</th></tr></thead><tbody></tbody></table>
    </section>
    <section class="card" style="grid-column: 1 / -1">
      <h2>recent counters</h2>
      <pre id="raw" style="white-space:pre-wrap;color:var(--mut);max-height:360px;overflow:auto;margin:0"></pre>
    </section>
  </main>
  <footer>Served by the MCP HTTP transport. Prometheus-compatible metrics at <code>/metrics</code>.</footer>
<script>
async function refresh() {
  try {
    const r = await fetch('/_dashboard.json'); const d = await r.json();
    document.getElementById('uptime').textContent = 'uptime ' + d.uptime_s + 's';
    const brTbody = document.querySelector('#bridges tbody'); brTbody.innerHTML = '';
    for (const [k, v] of Object.entries(d.bridges)) {
      const row = document.createElement('tr');
      row.innerHTML = '<td>' + k + '</td><td class="' + (v.up ? 'up' : 'down') + '">' + (v.up ? 'UP' : 'DOWN') + '</td><td class="mono">' + (v.last_check_s_ago != null ? (v.last_check_s_ago + 's ago') : '—') + '</td>';
      brTbody.appendChild(row);
    }
    const tTbody = document.querySelector('#tools tbody'); tTbody.innerHTML = '';
    const tools = Object.entries(d.tools).sort((a,b) => b[1].calls - a[1].calls).slice(0, 20);
    for (const [k, v] of tools) {
      const avg = v.calls ? Math.round(v.sum_ms / v.calls) : 0;
      const row = document.createElement('tr');
      row.innerHTML = '<td>' + k + '</td><td class="mono">' + v.calls + '</td><td class="mono">' + v.errors + '</td><td class="mono">' + avg + '</td>';
      tTbody.appendChild(row);
    }
    document.getElementById('raw').textContent = d.raw;
  } catch (e) {
    document.getElementById('raw').textContent = 'error: ' + e;
  }
}
refresh(); setInterval(refresh, 5000);
</script>
</body>
</html>`;

function renderDashboardJson(): string {
  const now = Date.now();
  const uptime_s = Math.floor((now - state.started) / 1000);
  const bridges: Record<string, { up: boolean; last_check_s_ago: number | null }> = {};
  for (const [k, v] of Object.entries(state.bridge_up)) {
    bridges[k] = {
      up: v === 1,
      last_check_s_ago: state.bridge_last_check[k] ? Math.floor((now - state.bridge_last_check[k]) / 1000) : null,
    };
  }
  const tools: Record<string, { calls: number; errors: number; sum_ms: number }> = {};
  for (const [k, calls] of Object.entries(state.tool_calls_total)) {
    tools[k] = {
      calls,
      errors: state.tool_errors_total[k] ?? 0,
      sum_ms: state.tool_latency_ms[k]?.sum ?? 0,
    };
  }
  const raw = Object.entries(state.http_requests_total).map(([k, v]) => `${k}  ${v}`).join("\n");
  return JSON.stringify({ uptime_s, bridges, tools, raw });
}

// ---- hook into the HTTP transport -----------------------------

export function attachObservabilityRoutes(server: Server) {
  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/metrics") {
      metrics.http("/metrics");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(renderPrometheus());
      return;
    }
    if (url.pathname === "/dashboard" || url.pathname === "/dashboard/") {
      metrics.http("/dashboard");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }
    if (url.pathname === "/_dashboard.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(renderDashboardJson());
      return;
    }
  });
}
