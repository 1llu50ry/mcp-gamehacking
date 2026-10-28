import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AdminClient } from "../../src/admin.js";
import { ArgumentError, ForbiddenError, ProtocolError, ScopeError } from "../../src/errors.js";
import { FakeServer, json } from "../support/fake.js";
import { SESSION_ID } from "../support/payloads.js";

const sessionPreview = {
  session_id: SESSION_ID,
  workspace: "w",
  project: "p",
  observations_deleted: 3,
  handoffs_deleted: 1,
  pages_deleted: 1,
  auto_improve_runs_deleted: 0,
  removed_paths: ["sessions/x.md"],
  dry_run: true,
};

const projectPreview = {
  label: "w/p",
  pages_deleted: 2,
  sessions_deleted: 1,
  observations_deleted: 3,
  handoffs_deleted: 0,
  dry_run: true,
};

function setup() {
  const server = new FakeServer();
  const admin = new AdminClient({ serverUrl: "http://127.0.0.1:49374", fetch: server.fetch });
  return { server, admin };
}

describe("AdminClient purges", () => {
  it("defaults to a dry run that sends confirm: false", async () => {
    const { server, admin } = setup();
    server.routes.set("POST /admin/purge-session", () => json(sessionPreview));
    server.routes.set("POST /admin/purge-project", () => json(projectPreview));
    const preview = await admin.purgeSession({ workspace: "w", project: "p", sessionId: SESSION_ID });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.observationsDeleted, 3);
    assert.deepEqual(preview.removedPaths, ["sessions/x.md"]);
    assert.deepEqual(server.requests.at(-1)?.body, {
      workspace: "w",
      project: "p",
      session_id: SESSION_ID,
      confirm: false,
      dry_run: true,
      compact: false,
    });
    const project = await admin.purgeProject({ workspace: "w", project: "p", confirm: true });
    assert.equal(project.dryRun, true);
    // confirm: true alone does not make it destructive.
    assert.deepEqual(server.requests.at(-1)?.body, {
      workspace: "w",
      project: "p",
      confirm: false,
      dry_run: true,
      compact: false,
      force: false,
    });
  });

  it("refuses an irreversible purge without both flags before anything is sent", async () => {
    const { server, admin } = setup();
    await assert.rejects(
      admin.purgeSession({ workspace: "w", project: "p", sessionId: SESSION_ID, dryRun: false }),
      ArgumentError,
    );
    await assert.rejects(
      admin.purgeProject({ workspace: "w", project: "p", dryRun: false, confirm: "yes" as never }),
      ArgumentError,
    );
    await assert.rejects(
      admin.purgeProject({ workspace: "w", project: "p", dryRun: "false" as never, confirm: true }),
      ArgumentError,
    );
    await assert.rejects(admin.purgeProject({ workspace: "w", project: "" }), ScopeError);
    assert.equal(server.requests.length, 0);
  });

  it("control: dryRun false plus confirm true sends a real purge", async () => {
    const { server, admin } = setup();
    server.routes.set("POST /admin/purge-project", () =>
      json({ ...projectPreview, dry_run: undefined, checkpoint: "abc" }),
    );
    const report = await admin.purgeProject({
      workspace: "w",
      project: "p",
      dryRun: false,
      confirm: true,
      force: true,
    });
    assert.equal(report.dryRun, false);
    assert.deepEqual(server.requests.at(-1)?.body, {
      workspace: "w",
      project: "p",
      confirm: true,
      dry_run: false,
      compact: false,
      force: true,
    });
  });

  it("refuses a preview the server did not mark as a dry run", async () => {
    const { server, admin } = setup();
    server.routes.set("POST /admin/purge-project", () =>
      json({ ...projectPreview, dry_run: undefined }),
    );
    await assert.rejects(admin.purgeProject({ workspace: "w", project: "p" }), ProtocolError);
  });
});

describe("AdminClient restore and checkpoints", () => {
  it("restores a page and lists checkpoints", async () => {
    const { server, admin } = setup();
    server.routes.set("POST /admin/restore-page", () =>
      json({ page_id: "v9", path: "notes/a.md", restored_from: "abc~1", checkpoint: "def" }),
    );
    server.routes.set("GET /admin/checkpoints", (request) => {
      assert.equal(request.query.get("limit"), "5");
      return json([{ oid: "abcdef", short_oid: "abc", time: 1, summary: "memory_delete_page: notes/a.md" }]);
    });
    const restored = await admin.restorePage({
      workspace: "w",
      project: "p",
      path: "notes/a.md",
      rev: "abc~1",
    });
    assert.equal(restored.pageId, "v9");
    assert.equal(restored.preCheckpoint, undefined);
    const checkpoints = await admin.checkpoints({ limit: 5 });
    assert.equal(checkpoints[0]?.summary, "memory_delete_page: notes/a.md");
  });

  it("a 403 carries the root-only hint", async () => {
    const { server, admin } = setup();
    server.routes.set("GET /admin/checkpoints", () =>
      json({ error: "admin operation is root-only in multi-user mode" }, 403),
    );
    await assert.rejects(admin.checkpoints(), (error: unknown) => {
      assert.ok(error instanceof ForbiddenError);
      assert.match(error.hint ?? "", /root-only/);
      assert.match(error.hint ?? "", /aim_/);
      return true;
    });
  });
});
