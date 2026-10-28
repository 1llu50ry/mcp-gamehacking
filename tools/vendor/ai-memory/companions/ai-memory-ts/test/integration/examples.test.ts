/**
 * Runs every program in `examples/` against a real server, as a user would:
 * a separate Node process that imports the built package by its name.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { startServer, type ServerHandle } from "../support/server.js";

const examplesDir = fileURLToPath(new URL("../../examples/", import.meta.url));
let server: ServerHandle;

before(async () => {
  server = await startServer();
});
after(async () => server.stop());

function run(
  script: string,
  args: string[] = [],
  project = script.replace(/\.js$/, ""),
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`${examplesDir}${script}`, ...args], {
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        AI_MEMORY_SERVER_URL: server.url,
        AI_MEMORY_AUTH_TOKEN: server.rootToken,
        AI_MEMORY_EXAMPLE_WORKSPACE: "examples",
        AI_MEMORY_EXAMPLE_PROJECT: project,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, out }));
  });
}

describe("examples", () => {
  it("every example is covered by this test", async () => {
    const scripts = (await readdir(examplesDir)).filter((f) => f.endsWith(".js")).sort();
    assert.deepEqual(scripts, [
      "admin-dry-run.js",
      "conditional-update.js",
      "env.js",
      "handoff.js",
      "incremental-sync.js",
      "quickstart.js",
    ]);
  });

  it("quickstart", async () => {
    const { code, out } = await run("quickstart.js");
    assert.equal(code, 0, out);
    assert.match(out, /connected to ai-memory .+ as root/);
    assert.match(out, /1 page\(s\) in examples\/quickstart/);
    assert.match(out, /hit: notes\/retries\.md Retry policy/);
    assert.match(out, /handoff: The retry policy was saved/);
  });

  it("conditional update", async () => {
    const first = await run("conditional-update.js");
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /counter is 1, tags \["example"\]/);
    const second = await run("conditional-update.js");
    assert.match(second.out, /counter is 2/);
  });

  it("handoff between two processes", async () => {
    const begun = await run("handoff.js", ["begin"]);
    assert.equal(begun.code, 0, begun.out);
    const accepted = await run("handoff.js", ["accept"]);
    assert.match(accepted.out, /picked up: Nightly import stopped at batch 42/);
    assert.match(accepted.out, /next: Resume from batch 43/);
    const again = await run("handoff.js", ["accept"]);
    assert.match(again.out, /nothing to pick up \(none_pending\)/);
  });

  it("incremental sync", async () => {
    const { code, out } = await run("incremental-sync.js");
    assert.equal(code, 0, out);
    assert.match(out, /fetched: notes\/sync-a\.md/);
    assert.match(out, /fetched: notes\/sync-b\.md/);
    assert.match(out, /cached 2 pages/);
  });

  it("admin dry run", async () => {
    // Previews the project the quickstart test filled.
    const { code, out } = await run("admin-dry-run.js", [], "quickstart");
    assert.equal(code, 0, out);
    assert.match(out, /would delete \d+ page rows/);
    assert.match(out, /dry run: true/);
  });
});
