import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReclassProject, emitHeader } from "../dist/native-reclass.js";

const XML = `<?xml version="1.0"?>
<reclass version="4.0">
  <classes>
    <class name="CPlayer" uuid="aaa" comment="Local player">
      <node type="Hex64"    name="m_pVTable" offset="0x0"  />
      <node type="Int32"    name="m_iHealth" offset="0x10" />
      <node type="Vector3"  name="m_vOrigin" offset="0x20" />
      <node type="Utf8Text" name="m_szName"  offset="0x30" length="32" />
      <node type="ClassPtr" name="m_pOwner"  offset="0x60" class_uuid="aaa" />
    </class>
  </classes>
</reclass>`;

test("parses nodes with offsets + types", () => {
  const classes = parseReclassProject(XML);
  assert.equal(classes.length, 1);
  const c = classes[0];
  assert.equal(c.name, "CPlayer");
  assert.equal(c.nodes.length, 5);
  assert.equal(c.nodes[1].type, "Int32");
  assert.equal(c.nodes[3].length, 32);
});

test("emits a C++ header with pack(1) + offsets + ClassPtr forward", () => {
  const classes = parseReclassProject(XML);
  const header = emitHeader(classes, "sdk");
  assert.match(header, /#pragma pack\(push, 1\)/);
  assert.match(header, /struct CPlayer\s*\{/);
  assert.match(header, /int32_t m_iHealth;/);
  assert.match(header, /float m_vOrigin\[3\];/);
  assert.match(header, /char\s+m_szName\[32\];/);
  assert.match(header, /CPlayer\*\s+m_pOwner;/);
  assert.match(header, /namespace sdk \{/);
});
