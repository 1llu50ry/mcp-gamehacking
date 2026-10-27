#!/usr/bin/env node
/**
 * antirea — Electron IPC channel name hasher
 *
 * Run as part of prebuild to replace human-readable IPC channel names
 * with consistent short hashes across ALL source files.
 *
 *   "scripts": {
 *     "prebuild": "node scripts/antirea-ipc-hash.js && node scripts/antirea-embed-barrier.js"
 *   }
 *
 * Why this matters for REA:
 *   REA's showcase specifically traces Electron IPC channel names to map
 *   app behavior (e.g. the Notion clipboard-bridge showcase). If channel
 *   names are "clipboard-read", "user-data-fetch", "settings-update",
 *   REA can immediately understand the app's feature set from the channel
 *   names alone — before decompiling a single function.
 *
 *   After this script: "clipboard-read" → "ch_a3f9b2d1"
 *   REA sees opaque hashes and cannot correlate them to features.
 *
 * Configuration:
 *   Edit the CHANNEL_PATTERNS and SRC_DIRS below, or create
 *   antirea-ipc-hash.config.js in the project root.
 *
 * Environment variables:
 *   ANTIREA_DRY_RUN  — set to "1" to print without writing
 */

"use strict";

const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");

const ROOT    = process.cwd();
const DRY_RUN = process.env.ANTIREA_DRY_RUN === "1";

// -------------------------------------------------------------------------
// Configuration — override in antirea-ipc-hash.config.js if needed
// -------------------------------------------------------------------------
let cfg = {
  // Source directories to scan
  srcDirs: ["src", "app", "renderer", "main"],

  // File extensions to scan
  extensions: [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"],

  // Regex patterns that identify IPC channel string arguments.
  // Each pattern must have one capture group containing the channel name.
  channelPatterns: [
    // ipcMain.handle("channel-name", ...)
    // ipcMain.on("channel-name", ...)
    // ipcRenderer.invoke("channel-name")
    // ipcRenderer.send("channel-name", ...)
    /ipc(?:Main|Renderer)\.(?:handle|on|once|invoke|send|sendSync)\(\s*['"`]([^'"`]+)['"`]/g,
    // contextBridge.exposeInMainWorld("api", { channel: "channel-name" })
    // Less precise — only catches simple string assignments near IPC keywords
    /(?:channel|event|ipc)\s*:\s*['"`]([a-z][a-z0-9-_]{3,})['"`]/g,
  ],
};

const cfgPath = path.join(ROOT, "antirea-ipc-hash.config.js");
if (fs.existsSync(cfgPath)) {
  Object.assign(cfg, require(cfgPath));
}

function log(msg) { process.stdout.write("[antirea:ipc-hash] " + msg + "\n"); }

// -------------------------------------------------------------------------
// Hash function — deterministic, short, opaque
// -------------------------------------------------------------------------
function hashChannel(name) {
  return "ch_" + crypto.createHash("sha1").update("antirea:" + name).digest("hex").slice(0, 8);
}

// -------------------------------------------------------------------------
// Scan source files, build channel map, apply replacements
// -------------------------------------------------------------------------
const channelMap = new Map(); // original name → hash

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  for (const pattern of cfg.channelPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (!channelMap.has(name)) {
        channelMap.set(name, hashChannel(name));
      }
    }
  }
}

function patchFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;
  for (const [original, hashed] of channelMap) {
    // Replace quoted occurrences of the channel name
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(['"\`])${escaped}\\1`, "g");
    if (re.test(content)) {
      re.lastIndex = 0;
      content = content.replace(re, (_, q) => q + hashed + q);
      changed = true;
    }
  }
  return { content, changed };
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      walk(full, results);
    } else if (entry.isFile() && cfg.extensions.includes(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// Phase 1: scan for channel names
const allFiles = cfg.srcDirs.flatMap(d => walk(path.resolve(ROOT, d)));
if (allFiles.length === 0) {
  log("No source files found in: " + cfg.srcDirs.join(", "));
  log("Edit antirea-ipc-hash.config.js to set srcDirs.");
  process.exit(0);
}

for (const f of allFiles) scanFile(f);

if (channelMap.size === 0) {
  log("No IPC channel names detected. Nothing to hash.");
  process.exit(0);
}

log("Found " + channelMap.size + " IPC channel name(s):");
for (const [orig, hashed] of channelMap) {
  log("  " + orig.padEnd(40) + " → " + hashed);
}

if (DRY_RUN) {
  log("DRY RUN — no files written.");
  process.exit(0);
}

// Phase 2: patch all source files
let patched = 0;
for (const f of allFiles) {
  const { content, changed } = patchFile(f);
  if (changed) {
    fs.writeFileSync(f, content, "utf8");
    log("PATCHED " + path.relative(ROOT, f));
    patched++;
  }
}

// Write the channel map for runtime use (the app needs to use hashed names at runtime too)
const mapOutPath = path.join(ROOT, "src", "antirea-channel-map.json");
fs.writeFileSync(mapOutPath, JSON.stringify(Object.fromEntries(channelMap), null, 2), "utf8");
log("Channel map written to: " + mapOutPath + " (include in build if needed)");

log("");
log("Done: " + channelMap.size + " channel(s) hashed, " + patched + " file(s) patched.");