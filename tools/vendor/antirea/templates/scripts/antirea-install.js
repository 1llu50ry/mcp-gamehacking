#!/usr/bin/env node
/**
 * antirea — postinstall shim installer
 *
 * Add this to package.json as the postinstall script:
 *
 *   "scripts": {
 *     "postinstall": "node scripts/antirea-install.js"
 *   }
 *
 * What this does:
 *   Copies the antirea shim files into node_modules/.bin/ so that
 *   `npx rea-agents` and `rea` resolve to the shim when run inside
 *   this project's directory tree.
 *
 * Why postinstall:
 *   npm runs postinstall after every `npm install`. Any contributor
 *   who clones the repo and runs `npm install` automatically gets the
 *   shim installed — no manual step required.
 *
 * Shim resolution order (why this works):
 *   When npm/npx looks for a binary, it checks node_modules/.bin/
 *   BEFORE the global PATH. So even if the attacker has `rea` installed
 *   globally, the local shim wins inside this project's directory.
 *
 *   npx rea-agents  →  resolves  →  node_modules/.bin/rea  →  DENIED
 *   rea             →  resolves  →  node_modules/.bin/rea  →  DENIED  (if PATH includes node_modules/.bin)
 *
 * LIMITS:
 *   - Works for npm/npx/yarn/pnpm local resolution inside this project.
 *   - Does NOT stop `rea` run from outside this directory tree.
 *   - Does NOT stop a global `rea` if node_modules/.bin is not on PATH.
 *   - Does NOT stop direct invocation via absolute path (e.g. /usr/local/bin/rea).
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT    = process.cwd();
const BIN_DIR = path.join(ROOT, "node_modules", ".bin");

// Source shim files (relative to this script's location)
const SCRIPT_DIR = __dirname;
const SHIM_UNIX  = path.join(SCRIPT_DIR, "..", "bin", "rea");
const SHIM_WIN   = path.join(SCRIPT_DIR, "..", "bin", "rea.cmd");

function log(msg) {
  process.stdout.write("[antirea] " + msg + "\n");
}

// node_modules/.bin must exist (it's created by npm install)
if (!fs.existsSync(BIN_DIR)) {
  log("node_modules/.bin not found — skipping shim install (run after npm install).");
  process.exit(0);
}

// Install Unix shim
const destUnix = path.join(BIN_DIR, "rea");
if (fs.existsSync(destUnix)) {
  const existing = fs.readFileSync(destUnix, "utf8");
  if (existing.includes("ANTIREA")) {
    log("SKIP: Unix shim already installed at " + destUnix);
  } else {
    // There's a real rea binary here — back it up and replace
    fs.renameSync(destUnix, destUnix + ".rea-original");
    log("BACKED UP real rea binary to: " + destUnix + ".rea-original");
    fs.copyFileSync(SHIM_UNIX, destUnix);
    fs.chmodSync(destUnix, 0o755);
    log("INSTALLED shim: " + destUnix);
  }
} else {
  fs.copyFileSync(SHIM_UNIX, destUnix);
  fs.chmodSync(destUnix, 0o755);
  log("INSTALLED shim: " + destUnix);
}

// Install Windows shim
const destWin = path.join(BIN_DIR, "rea.cmd");
if (fs.existsSync(destWin)) {
  const existing = fs.readFileSync(destWin, "utf8");
  if (existing.includes("ANTIREA")) {
    log("SKIP: Windows shim already installed at " + destWin);
  } else {
    fs.renameSync(destWin, destWin.replace(".cmd", ".rea-original.cmd"));
    log("BACKED UP real rea.cmd to: " + destWin.replace(".cmd", ".rea-original.cmd"));
    fs.copyFileSync(SHIM_WIN, destWin);
    log("INSTALLED shim: " + destWin);
  }
} else {
  fs.copyFileSync(SHIM_WIN, destWin);
  log("INSTALLED shim: " + destWin);
}

// Also install as `rea-agents` and `rea-agents.cmd` (the npx package name)
for (const name of ["rea-agents", "npx-rea-agents"]) {
  const destU = path.join(BIN_DIR, name);
  const destW = path.join(BIN_DIR, name + ".cmd");

  if (!fs.existsSync(destU)) {
    fs.copyFileSync(SHIM_UNIX, destU);
    fs.chmodSync(destU, 0o755);
    log("INSTALLED shim: " + destU);
  } else {
    log("SKIP (exists): " + destU);
  }

  if (!fs.existsSync(destW)) {
    fs.copyFileSync(SHIM_WIN, destW);
    log("INSTALLED shim: " + destW);
  } else {
    log("SKIP (exists): " + destW);
  }
}

log("Shim install complete.");
log("Terminal protection active: npx rea-agents and rea commands will be blocked inside this project.");
log("");
log("STRONGER ALTERNATIVE: Add rea-agents as a local file dependency in package.json:");
log("  \"dependencies\": { \"rea-agents\": \"file:scripts/rea-agents-shim\" }");
log("This forces npx to always resolve to the shim, even without a prior npm install.");
log("");
log("LIMIT: This does not stop 'rea' run from outside this project directory,");
log("       or a direct absolute path invocation of a globally installed rea binary.");