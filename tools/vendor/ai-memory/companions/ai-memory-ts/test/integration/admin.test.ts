import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { AdminClient } from "../../src/admin.js";
import { AiMemoryClient } from "../../src/client.js";
import { ArgumentError, ForbiddenError, RpcError } from "../../src/errors.js";
import type { FetchLike } from "../../src/transport.js";
import { startServer, type ServerHandle } from "../support/server.js";

let server: ServerHandle;
let memory: AiMemoryClient;
let admin: AdminClient;
const scope = { workspace: "it-admin", project: "app" };

before(async () => {
  server = await startServer();
  memory = new AiMemoryClient({ serverUrl: server.url, token: server.rootToken, scope });
  admin = new AdminClient({ serverUrl: server.url, token: server.rootToken });
});
after(async () => server.stop());

describe("AdminClient against a real server", () => {
  it("restores a deleted page from the delete's checkpoint", async () => {
    await memory.pages.write({ path: "notes/restore.md", body: "# Restore me\noriginal" });
    const deleted = await memory.pages.delete({ path: "notes/restore.md" });
    const rev = deleted.preCheckpoint ?? `${deleted.checkpoint ?? ""}~1`;
    const checkpoints = await admin.checkpoints({ limit: 10 });
    assert.ok(checkpoints.some((c) => c.summary.includes("notes/restore.md")));
    const restored = await admin.restorePage({ ...scope, path: "notes/restore.md", rev });
    assert.equal(restored.path, "notes/restore.md");
    const page = await memory.pages.read({ path: "notes/restore.md" });
    assert.equal(page.pageId, restored.pageId);
    assert.equal(page.body, "# Restore me\noriginal");
  });

  it("purgeSession defaults to a dry run that deletes nothing", async () => {
    const sessionId = await server.seedSession(scope.workspace, scope.project, "it-admin-session");
    const preview = await admin.purgeSession({ ...scope, sessionId });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.observationsDeleted, 3);
    const still = await memory.observations({ sessionId });
    assert.equal(still.total, 3, "a dry run must not delete observations");

    const purged = await admin.purgeSession({ ...scope, sessionId, dryRun: false, confirm: true });
    assert.equal(purged.dryRun, false);
    assert.equal(purged.observationsDeleted, 3);
    await assert.rejects(memory.observations({ sessionId }), RpcError);
  });

  it("an irreversible purge without both flags never reaches the wire", async () => {
    const seen: string[] = [];
    const counting: FetchLike = async (url, init) => {
      seen.push(url);
      return fetch(url, init);
    };
    const watched = new AdminClient({ serverUrl: server.url, token: server.rootToken, fetch: counting });
    await assert.rejects(watched.purgeProject({ ...scope, dryRun: false }), ArgumentError);
    await assert.rejects(
      watched.purgeSession({ ...scope, sessionId: "00000000-0000-0000-0000-000000000000", dryRun: false }),
      ArgumentError,
    );
    assert.deepEqual(seen, []);
  });

  it("purgeProject previews, then purges with both flags", async () => {
    const doomed = { workspace: "it-admin", project: "doomed" };
    await memory.pages.write({ path: "notes/a.md", body: "# Doomed\nx", scope: doomed });
    const preview = await admin.purgeProject(doomed);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.pagesDeleted, 1);
    assert.equal((await memory.pages.read({ path: "notes/a.md", scope: doomed })).title, "Doomed");
    const purged = await admin.purgeProject({ ...doomed, dryRun: false, confirm: true });
    assert.equal(purged.dryRun, false);
    assert.equal(purged.pagesDeleted, 1);
    await assert.rejects(memory.pages.read({ path: "notes/a.md", scope: doomed }), RpcError);
  });

  it("a user key on an admin route is ForbiddenError; root is the control", async () => {
    const key = await server.addUser("mallory");
    const userAdmin = new AdminClient({ serverUrl: server.url, token: key });
    await assert.rejects(userAdmin.checkpoints(), (error: unknown) => {
      assert.ok(error instanceof ForbiddenError);
      assert.match(error.hint ?? "", /root-only/);
      return true;
    });
    await assert.rejects(userAdmin.purgeProject(scope), ForbiddenError);
    assert.ok((await admin.checkpoints()).length > 0);
  });
});
