/**
 * Preview what purging a project would delete, without deleting anything.
 * Admin routes need the server's root token once it has DB users.
 *
 *   AI_MEMORY_ROOT_TOKEN=... node build/examples/admin-dry-run.js
 */
import { AdminClient } from "ai-memory-ts/admin";

import { scope, serverUrl, token } from "./env.js";

const admin = new AdminClient({
  serverUrl,
  token: process.env["AI_MEMORY_ROOT_TOKEN"] || token,
});

// dryRun defaults to true: the server reports counts and deletes nothing.
const preview = await admin.purgeProject({ workspace: scope.workspace, project: scope.project });
console.log(
  `a purge of ${scope.workspace}/${scope.project} would delete ${preview.pagesDeleted} page rows, ` +
    `${preview.sessionsDeleted} sessions and ${preview.observationsDeleted} observations ` +
    `(dry run: ${preview.dryRun})`,
);

// The irreversible call needs both flags in the same call:
//   await admin.purgeProject({ ...scope, dryRun: false, confirm: true });

const checkpoints = await admin.checkpoints({ limit: 3 });
for (const checkpoint of checkpoints) console.log(`checkpoint ${checkpoint.shortOid} ${checkpoint.summary}`);
