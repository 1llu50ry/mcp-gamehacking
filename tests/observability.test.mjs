import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { metrics, attachObservabilityRoutes } from "../dist/observability.js";

async function fetchText(url) {
  const r = await fetch(url);
  return { status: r.status, body: await r.text(), ct: r.headers.get("content-type") };
}

test("observability: /metrics renders Prometheus format", async () => {
  metrics.toolCall("fake_tool", 42, { ok: true });
  metrics.toolCall("fake_tool", 999, { ok: false });
  metrics.bridgeStatus("ghidra", true);
  metrics.bridgeStatus("ida", false);

  const srv = createServer(() => {});
  attachObservabilityRoutes(srv);
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;

  try {
    const { status, body, ct } = await fetchText(`http://127.0.0.1:${port}/metrics`);
    assert.equal(status, 200);
    assert.match(ct ?? "", /text\/plain/);
    assert.match(body, /mcp_tool_calls_total\{tool="fake_tool"\} 2/);
    assert.match(body, /mcp_tool_errors_total\{tool="fake_tool"\} 1/);
    assert.match(body, /mcp_bridge_up\{bridge="ghidra"\} 1/);
    assert.match(body, /mcp_bridge_up\{bridge="ida"\} 0/);
    assert.match(body, /mcp_tool_latency_ms_bucket\{tool="fake_tool",le="100"\}/);
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test("observability: /dashboard serves HTML and /_dashboard.json JSON", async () => {
  const srv = createServer(() => {});
  attachObservabilityRoutes(srv);
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;

  try {
    const dash = await fetchText(`http://127.0.0.1:${port}/dashboard`);
    assert.equal(dash.status, 200);
    assert.match(dash.ct ?? "", /text\/html/);
    assert.match(dash.body, /<title>mcp-reverse · dashboard<\/title>/);

    const j = await fetchText(`http://127.0.0.1:${port}/_dashboard.json`);
    assert.equal(j.status, 200);
    const obj = JSON.parse(j.body);
    assert.ok(typeof obj.uptime_s === "number");
    assert.ok(typeof obj.bridges === "object");
    assert.ok(typeof obj.tools === "object");
  } finally {
    await new Promise(r => srv.close(r));
  }
});
