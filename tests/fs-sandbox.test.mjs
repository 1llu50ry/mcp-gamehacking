import { test } from "node:test";
import assert from "node:assert/strict";
import { requirePathAllowed, sandboxConfig, SandboxDenied } from "../dist/fs-sandbox.js";

function withEnv(env, fn) {
  const prev = { allow: process.env.MCP_FS_ALLOW, deny: process.env.MCP_FS_DENY };
  if ("allow" in env) {
    if (env.allow === undefined) delete process.env.MCP_FS_ALLOW;
    else process.env.MCP_FS_ALLOW = env.allow;
  }
  if ("deny" in env) {
    if (env.deny === undefined) delete process.env.MCP_FS_DENY;
    else process.env.MCP_FS_DENY = env.deny;
  }
  try { fn(); } finally {
    if (prev.allow === undefined) delete process.env.MCP_FS_ALLOW; else process.env.MCP_FS_ALLOW = prev.allow;
    if (prev.deny === undefined) delete process.env.MCP_FS_DENY; else process.env.MCP_FS_DENY = prev.deny;
  }
}

test("open mode allows any path when MCP_FS_ALLOW is unset", () => {
  withEnv({ allow: undefined, deny: undefined }, () => {
    assert.equal(sandboxConfig().mode, "open");
    requirePathAllowed("/anywhere/in/the/world/bin.exe"); // must not throw
  });
});

test("allowlist mode rejects paths outside the roots", () => {
  withEnv({ allow: "/approved" }, () => {
    assert.equal(sandboxConfig().mode, "allowlist");
    assert.throws(() => requirePathAllowed("/elsewhere/file.exe"), SandboxDenied);
  });
});

test("allowlist mode accepts paths under an allowed root", () => {
  withEnv({ allow: "/approved" }, () => {
    requirePathAllowed("/approved/sub/dir/file.exe"); // must not throw
  });
});

test("deny list wins over allow list", () => {
  withEnv({ allow: "/approved", deny: "/approved/secret" }, () => {
    assert.throws(() => requirePathAllowed("/approved/secret/key.pem"), SandboxDenied);
  });
});

test("allowlist is comma + semicolon separated", () => {
  withEnv({ allow: "/a,/b;/c" }, () => {
    requirePathAllowed("/a/x");
    requirePathAllowed("/b/x");
    requirePathAllowed("/c/x");
    assert.throws(() => requirePathAllowed("/d/x"), SandboxDenied);
  });
});
