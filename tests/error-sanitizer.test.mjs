import test from "node:test";
import assert from "node:assert/strict";
import { cleanErrorMessage, wrapToolError } from "../dist/error-sanitizer.js";

test("sanitizer: strips absolute Windows paths", () => {
  const e = new Error("ENOENT: no such file 'C:\\Users\\dev_null\\secret.pdb'");
  const r = cleanErrorMessage(e);
  assert.ok(!r.text.includes("C:\\Users"), `path leaked: ${r.text}`);
  assert.match(r.text, /<path>/);
});

test("sanitizer: strips absolute Unix paths", () => {
  const e = new Error("open /home/alice/.ssh/id_rsa failed");
  const r = cleanErrorMessage(e);
  assert.ok(!r.text.includes("/home/alice"), `path leaked: ${r.text}`);
  assert.match(r.text, /<path>/);
});

test("sanitizer: collapses CRLF (xss-through-exception vector)", () => {
  const e = new Error("boom\r\nX-Injected: evil\r\nmore");
  const r = cleanErrorMessage(e);
  assert.ok(!r.text.includes("\n") && !r.text.includes("\r"), `newline leaked: ${JSON.stringify(r.text)}`);
});

test("sanitizer: drops ANSI escape codes", () => {
  const e = new Error("\u001b[31mfailed\u001b[0m to open");
  const r = cleanErrorMessage(e);
  assert.ok(!r.text.includes("\u001b"), `ANSI leaked: ${JSON.stringify(r.text)}`);
  assert.match(r.text, /failed to open/);
});

test("sanitizer: caps overly long messages", () => {
  const e = new Error("x".repeat(5000));
  const r = cleanErrorMessage(e, { maxLen: 100 });
  assert.ok(r.text.length <= 101, `message too long: ${r.text.length}`);
  assert.ok(r.text.endsWith("…"));
});

test("sanitizer: assigns a stable 8-char trace id", () => {
  const r = cleanErrorMessage(new Error("x"));
  assert.match(r.traceId, /^[0-9a-f]{8}$/);
});

test("wrapToolError: returns isError response with trace tag", () => {
  const r = wrapToolError(new Error("bad things"), "my_tool");
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^# my_tool error \[trace=[0-9a-f]{8}\]/);
});

test("sanitizer: handles non-Error inputs", () => {
  const r1 = cleanErrorMessage("just a string");
  assert.match(r1.text, /just a string/);
  const r2 = cleanErrorMessage({ foo: "bar" });
  assert.match(r2.text, /foo/);
});
