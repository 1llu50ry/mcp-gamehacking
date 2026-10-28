import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { AiMemoryClient } from "../../src/client.js";
import { InvalidParamsError, RpcError } from "../../src/errors.js";
import { startServer, type ServerHandle } from "../support/server.js";

let server: ServerHandle;
let root: AiMemoryClient;
let alice: AiMemoryClient;
const app = { workspace: "it-hm", project: "app" };
const open = { workspace: "it-hm", project: "open" };
const locked = { workspace: "it-hm", project: "locked" };

before(async () => {
  server = await startServer();
  root = new AiMemoryClient({ serverUrl: server.url, token: server.rootToken, scope: app });
  const key = await server.addUser("alice");
  alice = new AiMemoryClient({ serverUrl: server.url, token: key, scope: app });
  for (const target of [app, open, locked]) {
    await root.pages.write({ path: "notes/seed.md", body: "# Seed\nx", scope: target });
  }
  const restricted = await server.cli([
    "project",
    "access",
    "--workspace",
    locked.workspace,
    "--project",
    locked.project,
    "--mode",
    "restricted",
  ]);
  assert.equal(restricted.code, 0, restricted.stderr);
});
after(async () => server.stop());

describe("handoffs against a real server", () => {
  it("begin, list, accept by id, a second accept, cancel", async () => {
    const begun = await root.handoffs.begin({
      summary: "The retry policy was saved. Add the delivery test next.",
      nextSteps: ["Add a retry regression test."],
      openQuestions: ["Which queue?"],
      filesTouched: ["src/retry.ts"],
    });
    const listed = await root.handoffs.list();
    const row = listed.handoffs.find((h) => h.id === begun.handoffId);
    assert.ok(row !== undefined);
    assert.equal(row.state, "open");
    assert.deepEqual(row.nextSteps, ["Add a retry regression test."]);
    assert.deepEqual(row.openQuestions, ["Which queue?"]);
    assert.deepEqual(row.filesTouched, ["src/retry.ts"]);

    const claimed = await root.handoffs.accept({ handoffId: begun.handoffId });
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.handoff?.id, begun.handoffId);
    assert.match(claimed.handoff?.summary ?? "", /retry policy/);

    const second = await root.handoffs.accept({ handoffId: begun.handoffId });
    assert.equal(second.status, "none_pending");
    assert.equal(second.handoff, null);

    const toCancel = await root.handoffs.begin({ summary: "mistake" });
    const cancelled = await root.handoffs.cancel({ handoffId: toCancel.handoffId });
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.state, "expired");
    const twice = await root.handoffs.cancel({ handoffId: toCancel.handoffId });
    assert.equal(twice.cancelled, false);
  });

  it("accept without an id claims the latest eligible handoff once", async () => {
    await root.handoffs.begin({ summary: "latest one", scope: open });
    const claimed = await root.handoffs.accept({ scope: open });
    assert.equal(claimed.status, "claimed");
    assert.equal((await root.handoffs.accept({ scope: open })).status, "none_pending");
  });

  it("an owned handoff is not claimable by another operator; a shared one is", async () => {
    const bob = new AiMemoryClient({
      serverUrl: server.url,
      token: await server.addUser("bob"),
      scope: app,
    });
    const owned = await alice.handoffs.begin({ summary: "alice only" });
    assert.ok((await alice.handoffs.list()).handoffs.some((h) => h.id === owned.handoffId));
    assert.ok(!(await bob.handoffs.list()).handoffs.some((h) => h.id === owned.handoffId));
    const ownedForBob = await bob.handoffs.accept({ handoffId: owned.handoffId });
    assert.equal(ownedForBob.status, "none_pending");
    const shared = await alice.handoffs.begin({ summary: "for anyone", shared: true });
    const sharedForBob = await bob.handoffs.accept({ handoffId: shared.handoffId });
    assert.equal(sharedForBob.status, "claimed");
    // Control: the owner can still claim her own handoff.
    assert.equal((await alice.handoffs.accept({ handoffId: owned.handoffId })).status, "claimed");
  });
});

describe("messages against a real server", () => {
  it("send, list inbox and outbox, pop once, cancel", async () => {
    const sent = await root.messages.send({ to: open, body: "please review the retry test", subject: "review" });
    const inbox = await root.messages.list({ scope: open });
    const row = inbox.messages.find((m) => m.id === sent.messageId);
    assert.equal(row?.subject, "review");
    assert.equal(row?.state, "pending");
    const outbox = await root.messages.list({ box: "outbox" });
    assert.ok(outbox.messages.some((m) => m.id === sent.messageId));

    const popped = await root.messages.pop({ messageId: sent.messageId, scope: open });
    assert.equal(popped.message?.id, sent.messageId);
    assert.equal(popped.message?.body, "please review the retry test");
    assert.equal(typeof popped.securityNotice, "string");
    const again = await root.messages.pop({ scope: open });
    assert.equal(again.message, null);

    await root.messages.send({ to: open, body: "one" });
    await root.messages.send({ to: open, body: "two" });
    const cancelled = await root.messages.cancel();
    assert.equal(cancelled.cancelled, 2);
  });

  it("an unknown recipient is refused, not created", async () => {
    await assert.rejects(
      root.messages.send({ to: { workspace: "it-hm", project: "nobody" }, body: "x" }),
      InvalidParamsError,
    );
  });

  it("a restricted recipient refuses a user without a grant and accepts one with it", async () => {
    await assert.rejects(alice.messages.send({ to: locked, body: "let me in" }), RpcError);
    await assert.rejects(alice.pages.read({ path: "notes/seed.md", scope: locked }), RpcError);
    const granted = await server.cli([
      "user",
      "grant",
      "--user",
      "alice",
      "--workspace",
      locked.workspace,
      "--project",
      locked.project,
      "--level",
      "write",
    ]);
    assert.equal(granted.code, 0, granted.stderr);
    const sent = await alice.messages.send({ to: locked, body: "granted now" });
    assert.match(sent.messageId, /^[0-9a-f-]{36}$/);
    // Control: an open project never needed a grant.
    await alice.messages.send({ to: open, body: "always fine" });
  });
});
