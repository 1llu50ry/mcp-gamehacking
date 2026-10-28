import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaraRules } from "../dist/native-yara.js";

test("parse a text + hex + regex rule", () => {
  const src = `
    rule TestRule
    {
      meta:
        author = "pat"
        severity = "medium"
      strings:
        $t = "GetProcAddress"
        $h = { 48 8B ?? ?? ?? ?? ?? E8 }
        $r = /DllGet[A-Z][A-Za-z]+/
      condition:
        any of them
    }
  `;
  const rs = parseYaraRules(src);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].name, "TestRule");
  assert.equal(rs[0].meta.author, "pat");
  assert.equal(rs[0].strings.length, 3);
  assert.equal(rs[0].strings[0].kind, "text");
  assert.equal(rs[0].strings[1].kind, "hex");
  assert.equal(rs[0].strings[2].kind, "regex");
  assert.equal(rs[0].condition, "any of them");
});

test("multi-rule parse", () => {
  const src = `
    rule R1 { strings: $a = "foo" condition: $a }
    rule R2 { strings: $b = "bar" condition: $b }
  `;
  const rs = parseYaraRules(src);
  assert.equal(rs.length, 2);
  assert.equal(rs[0].name, "R1");
  assert.equal(rs[1].name, "R2");
});
