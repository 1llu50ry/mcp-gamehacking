#!/usr/bin/env node
/**
 * antirea — post-build JS obfuscation runner
 *
 * Add to package.json:
 *   "scripts": {
 *     "postbuild": "node scripts/antirea-obfuscate.js"
 *   }
 *
 * Reads obfuscator.config.js from the project root.
 * Obfuscates every .js file in the dist directory (ANTIREA_DIST_DIR).
 *
 * Environment variables:
 *   ANTIREA_DIST_DIR   — directory to obfuscate (default: "dist")
 *   ANTIREA_DRY_RUN    — set to "1" to print without writing
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT     = process.cwd();
const DRY_RUN  = process.env.ANTIREA_DRY_RUN === "1";
const DIST_DIR = path.resolve(ROOT, process.env.ANTIREA_DIST_DIR || "dist");

function log(msg) { process.stdout.write("[antirea:obfuscate] " + msg + "\n"); }

// Load javascript-obfuscator
let JavaScriptObfuscator;
try {
  JavaScriptObfuscator = require("javascript-obfuscator");
} catch {
  log("ERROR: javascript-obfuscator not installed.");
  log("Run: npm install --save-dev javascript-obfuscator");
  process.exit(1);
}

// Load config
const configPath = path.join(ROOT, "obfuscator.config.js");
let config = {};
if (fs.existsSync(configPath)) {
  config = require(configPath);
  log("Loaded config: " + configPath);
} else {
  log("WARNING: obfuscator.config.js not found — using defaults. Copy templates/hardening/obfuscator.config.js.");
}

// Recursively find .js files
function findJs(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findJs(full, results);
    } else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".min.js")) {
      results.push(full);
    }
  }
  return results;
}

if (!fs.existsSync(DIST_DIR)) {
  log("ERROR: dist directory not found: " + DIST_DIR);
  log("Run the build step first.");
  process.exit(1);
}

const files = findJs(DIST_DIR);
if (files.length === 0) {
  log("No .js files found in " + DIST_DIR);
  process.exit(0);
}

log("Obfuscating " + files.length + " file(s) in " + DIST_DIR + " ...");

let ok = 0;
let fail = 0;
for (const filePath of files) {
  const original = fs.readFileSync(filePath, "utf8");
  try {
    const result = JavaScriptObfuscator.obfuscate(original, config);
    if (!DRY_RUN) {
      fs.writeFileSync(filePath, result.getObfuscatedCode(), "utf8");
    }
    log((DRY_RUN ? "DRY RUN " : "OK      ") + path.relative(ROOT, filePath));
    ok++;
  } catch (err) {
    log("FAIL    " + path.relative(ROOT, filePath) + " — " + err.message);
    fail++;
  }
}

log("");
log("Done: " + ok + " obfuscated, " + fail + " failed" + (DRY_RUN ? " (dry run)" : "") + ".");
if (fail > 0) {
  log("Failed files were not modified.");
  process.exit(1);
}