import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEmptyDb, insertSkill, insertPlugin, insertAgent, insertPrompt, setMeta,
  getSkill, getSkillSource, listSkills, searchSkills, stats,
} from "../dist/skills-db.js";
import { gzipSync } from "node:zlib";

async function td() { return await mkdtemp(join(tmpdir(), "skills-db-")); }

test("skills-db: insert + round-trip + FTS search", async () => {
  const dir = await td();
  try {
    const db = createEmptyDb(join(dir, "test.db"));

    insertSkill(db, {
      name: "ags-battleye-example",
      description: "Reverse engineering of the BattlEye kernel driver and the hooks it installs.",
      type: "reference",
      topics: ["anti-cheat", "battleye", "kernel"],
      body: "This project explores how BattlEye performs a kernel-mode scan.",
    });
    insertSkill(db, {
      name: "ags-ida-plugin",
      description: "An IDA Pro plugin for automatic signature making.",
      type: "reference",
      topics: ["ida", "signatures"],
      body: "IDA python plugin for AoB signature generation.",
    });
    setMeta(db, "built_at", new Date().toISOString());

    // getSkill
    const s = getSkill(db, "ags-battleye-example");
    assert.ok(s);
    assert.equal(s.name, "ags-battleye-example");
    assert.deepEqual(s.topics, ["anti-cheat", "battleye", "kernel"]);
    assert.equal(s.hasSource, false);

    // listSkills — ordered by name
    const list = listSkills(db, 10, 0);
    assert.equal(list.length, 2);
    assert.equal(list[0].name, "ags-battleye-example");
    assert.equal(list[1].name, "ags-ida-plugin");

    // searchSkills — FTS bm25 ranks the BattlEye row first on "battleye"
    const r = searchSkills(db, "battleye kernel", 5);
    assert.ok(r.length >= 1);
    assert.equal(r[0].name, "ags-battleye-example");
    assert.ok(r[0].snippet.length > 0);

    // search for the other skill
    const r2 = searchSkills(db, "signature", 5);
    assert.ok(r2.find(h => h.name === "ags-ida-plugin"));

    db.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("skills-db: source blob round-trip", async () => {
  const dir = await td();
  try {
    const db = createEmptyDb(join(dir, "test.db"));
    const raw = "void main() { puts(\"hi\"); }";
    insertSkill(db, {
      name: "demo",
      description: "d", type: "reference", topics: [], body: "b",
      source_gz: gzipSync(Buffer.from(raw)),
      source_sha: "sha",
    });
    const back = getSkillSource(db, "demo");
    assert.equal(back, raw);
    db.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("skills-db: plugins / agents / prompts / stats", async () => {
  const dir = await td();
  try {
    const db = createEmptyDb(join(dir, "test.db"));
    insertPlugin(db, { category: "scanners", name: "aob", path: null, body: "..." });
    insertAgent(db, "agents", "triage", "body A");
    insertAgent(db, "subagents", "cfg", "body B");
    insertPrompt(db, "re", "unpack", "do unpack");
    setMeta(db, "built_at", "now");

    const s = stats(db);
    assert.equal(s.plugins, 1);
    assert.equal(s.agents, 1);
    assert.equal(s.subagents, 1);
    assert.equal(s.prompts, 1);
    db.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
