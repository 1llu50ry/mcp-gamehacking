import test from "node:test";
import assert from "node:assert/strict";
import { applyChain } from "../dist/native-decoder.js";

test("decoder: base64 round-trip", () => {
  const out = applyChain(new Uint8Array(Buffer.from("SGVsbG8sIHdvcmxkIQ==", "utf8")), [{ op: "base64" }]);
  assert.equal(Buffer.from(out).toString("utf8"), "Hello, world!");
});

test("decoder: hex decode", () => {
  const out = applyChain(new Uint8Array(Buffer.from("48 65 6c 6c 6f", "utf8")), [{ op: "hex" }]);
  assert.equal(Buffer.from(out).toString("utf8"), "Hello");
});

test("decoder: xor with 0xAA then base64", () => {
  const plain = Buffer.from("secret-string", "utf8");
  const enc = Buffer.alloc(plain.length);
  for (let i = 0; i < plain.length; i++) enc[i] = plain[i] ^ 0xAA;
  const b64 = enc.toString("base64");
  const out = applyChain(new Uint8Array(Buffer.from(b64, "utf8")), [{ op: "base64" }, { op: "xor", arg: "0xAA" }]);
  assert.equal(Buffer.from(out).toString("utf8"), "secret-string");
});

test("decoder: rot13", () => {
  const out = applyChain(new Uint8Array(Buffer.from("Uryyb, Jbeyq!", "utf8")), [{ op: "rot", arg: "13" }]);
  assert.equal(Buffer.from(out).toString("utf8"), "Hello, World!");
});

test("decoder: strings extract", () => {
  const buf = Buffer.concat([Buffer.alloc(16, 0xFF), Buffer.from("UserAgent"), Buffer.alloc(4, 0), Buffer.from("Mozilla/5.0"), Buffer.alloc(8, 0)]);
  const out = applyChain(new Uint8Array(buf), [{ op: "strings", arg: "4" }]);
  const txt = Buffer.from(out).toString("utf8");
  assert.ok(txt.includes("UserAgent"));
  assert.ok(txt.includes("Mozilla/5.0"));
});

test("decoder: unknown op throws", () => {
  assert.throws(() => applyChain(new Uint8Array([0]), [{ op: "nope" }]), /unknown decoder op: nope/);
});
