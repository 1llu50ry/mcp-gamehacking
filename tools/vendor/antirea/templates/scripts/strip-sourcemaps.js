#!/usr/bin/env node
/**
 * antirea — source map remover
 *
 * Add to package.json (runs after obfuscation):
 *   "scripts": {
 *     "postbuild": "node scripts/antirea-obfuscate.js && node scripts/antirea-strip-sourcemaps.js"
 *   }
 *
 * What this does:
 *   1. Deletes every .map file in the dist directory
 *   2. Removes sourceMappingURL comments from every .js file
 *      (//# sourceMappingURL=bundle.js.map)
 *
 * Why this matters for REA:
 *   A source map gives REA perfect original source — it completely
 *   undoes minification and obfuscation. A single leaked .map file
 *   makes all other JS protection useless.
 *
 * Environment variables:
 *   ANTIREA_DIST_DIR  — directory to clean (default: "dist")
 *   ANTIREA_DRY_RUN   — set to "1" to print without deleting
 */

"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT     = process.cwd();
const DRY_RUN  = process.env.ANTIREA_DRY_RUN === "1";
const DIST_DIR = path.resolve(ROOT, process.env.ANTIREA_DIST_DIR || "dist");

const SOURCE_MAP_COMMENT = /\/\/# sourceMappingURL=\S+/g;

function log(msg) { process.stdout.write("[antirea:strip-maps] " + msg + "\n"); }

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

if (!fs.existsSync(DIST_DIR)) {
  log("ERROR: dist directory not found: " + DIST_DIR);
  process.exit(1);
}

const files = walk(DIST_DIR);
let deletedMaps = 0;
let patchedJs   = 0;

for (const filePath of files) {
  const rel = path.relative(ROOT, filePath);

  // Delete .map files
  if (filePath.endsWith(".map")) {
    if (!DRY_RUN) fs.unlinkSync(filePath);
    log((DRY_RUN ? "DRY RUN DELETE " : "DELETED        ") + rel);
    deletedMaps++;
    continue;
  }

  // Remove sourceMappingURL comments from .js files
  if (filePath.endsWith(".js")) {
    const content = fs.readFileSync(filePath, "utf8");
    if (SOURCE_MAP_COMMENT.test(content)) {
      SOURCE_MAP_COMMENT.lastIndex = 0;
      const patched = content.replace(SOURCE_MAP_COMMENT, "");
      if (!DRY_RUN) fs.writeFileSync(filePath, patched, "utf8");
      log((DRY_RUN ? "DRY RUN PATCH  " : "PATCHED        ") + rel);
      patchedJs++;
    }
  }
}

log("");
log("Done: " + deletedMaps + " .map file(s) deleted, " + patchedJs + " .js file(s) patched" + (DRY_RUN ? " (dry run)" : "") + ".");