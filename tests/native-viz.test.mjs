import test from "node:test";
import assert from "node:assert/strict";
import { renderSvgGraph } from "../dist/native-viz.js";

test("viz: renders an SVG with the nodes + edges requested", () => {
  const svg = renderSvgGraph(
    [
      { id: "a", label: "main",  kind: "func" },
      { id: "b", label: "parse", kind: "func" },
      { id: "c", label: "dec",   kind: "block" },
    ],
    [
      { from: "a", to: "b", kind: "call" },
      { from: "b", to: "c", kind: "jcc" },
    ],
    { title: "test graph" },
  );
  assert.match(svg, /^<svg /);
  assert.match(svg, /test graph/);
  assert.match(svg, />main</);
  assert.match(svg, />parse</);
  assert.match(svg, />dec</);
  assert.match(svg, /class="edge-call"/);
  assert.match(svg, /class="edge-jcc"/);
});

test("viz: SVG escapes XML specials in labels", () => {
  const svg = renderSvgGraph(
    [{ id: "a", label: "<script>" }],
    [],
    { title: "x" },
  );
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(!svg.includes("<script>"));
});
