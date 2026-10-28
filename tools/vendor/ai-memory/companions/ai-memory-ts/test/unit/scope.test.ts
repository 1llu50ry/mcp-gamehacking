import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiMemoryClient } from "../../src/client.js";
import { ScopeError } from "../../src/errors.js";
import { FakeServer } from "../support/fake.js";
import * as payloads from "../support/payloads.js";

function unscoped(): { server: FakeServer; memory: AiMemoryClient } {
  const server = new FakeServer();
  server.tools.set("memory_status", () => payloads.status);
  server.tools.set("memory_query", () => payloads.query);
  const memory = new AiMemoryClient({ serverUrl: "http://127.0.0.1:49374", fetch: server.fetch });
  return { server, memory };
}

/** Assert the call is refused with ScopeError and nothing reached fetch. */
async function refusedBeforeFetch(server: FakeServer, call: () => Promise<unknown>) {
  await assert.rejects(call, ScopeError);
  assert.equal(server.requests.length, 0, "no request may leave the client");
}

describe("scope validation", () => {
  it("refuses a project call with no scope and no default", async () => {
    const { server, memory } = unscoped();
    await refusedBeforeFetch(server, () => memory.status());
    await refusedBeforeFetch(server, () => memory.pages.write({ path: "a.md", body: "x" }));
    await refusedBeforeFetch(server, () => memory.handoffs.accept());
    await refusedBeforeFetch(server, () => memory.messages.send({ to: { workspace: "w", project: "p" }, body: "x" }));
    await refusedBeforeFetch(server, () => memory.api.pages());
    assert.throws(() => memory.api.recent(), ScopeError);
    assert.equal(server.requests.length, 0);
  });

  it("refuses a partial scope", async () => {
    const { server, memory } = unscoped();
    await refusedBeforeFetch(server, () =>
      memory.status({ scope: { workspace: "demo" } as never }),
    );
    await refusedBeforeFetch(server, () =>
      memory.status({ scope: { project: "app" } as never }),
    );
  });

  it("refuses empty and whitespace names", async () => {
    const { server, memory } = unscoped();
    await refusedBeforeFetch(server, () => memory.status({ scope: { workspace: "", project: "app" } }));
    await refusedBeforeFetch(server, () => memory.status({ scope: { workspace: "demo", project: "  " } }));
  });

  it("refuses a scope combined with global, at runtime for untyped callers", async () => {
    const { server, memory } = unscoped();
    await refusedBeforeFetch(server, () =>
      memory.query({ query: "x", global: true, scope: { workspace: "w", project: "p" } } as never),
    );
    await refusedBeforeFetch(server, () =>
      memory.query({ query: "x", global: true, scopes: [{ workspace: "w", project: "p" }] } as never),
    );
    await refusedBeforeFetch(server, () =>
      memory.api.search({ query: "x", global: true, scope: { workspace: "w", project: "p" } } as never),
    );
  });

  it("refuses scope together with scopes, and empty or partial scopes", async () => {
    const { server, memory } = unscoped();
    const scope = { workspace: "w", project: "p" };
    await refusedBeforeFetch(server, () =>
      memory.query({ query: "x", scope, scopes: [scope] } as never),
    );
    await refusedBeforeFetch(server, () => memory.query({ query: "x", scopes: [] }));
    await refusedBeforeFetch(server, () =>
      memory.query({ query: "x", scopes: [scope, { workspace: "w" } as never] }),
    );
  });

  it("refuses an invalid default scope at construction", () => {
    assert.throws(
      () => new AiMemoryClient({ serverUrl: "http://127.0.0.1:1", scope: { workspace: "w", project: "" } }),
      ScopeError,
    );
  });

  it("control: a global query needs no scope and an explicit scope works without a default", async () => {
    const { server, memory } = unscoped();
    await memory.query({ query: "x", global: true });
    await memory.status({ scope: { workspace: "demo", project: "app" } });
    assert.deepEqual(server.lastArgs(), { workspace: "demo", project: "app" });
  });

  it("a call scope overrides the default and no call ever sends cwd", async () => {
    const server = new FakeServer();
    server.tools.set("memory_status", () => payloads.status);
    const memory = new AiMemoryClient({
      serverUrl: "http://127.0.0.1:49374",
      fetch: server.fetch,
      scope: { workspace: "default-ws", project: "default-p" },
    });
    await memory.status({ scope: { workspace: "w2", project: "p2" } });
    assert.deepEqual(server.lastArgs(), { workspace: "w2", project: "p2" });
    await memory.status();
    assert.deepEqual(server.lastArgs(), { workspace: "default-ws", project: "default-p" });
    for (const call of server.toolCalls()) assert.ok(!("cwd" in call.args));
  });
});
