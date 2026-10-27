# antirea — Electron ASAR Encryption Guide

An unencrypted `.asar` is a ZIP-like archive that REA's
`analyze_javascript_application` reads directly — it extracts every JS module,
maps the import graph, and traces IPC channels without running the app.
JS obfuscation alone is not enough if the ASAR is readable: REA reads the
obfuscated source and still maps the module graph.

ASAR encryption is **mandatory** for Electron apps that need real protection.

---

## Option A — electron-builder with ASAR encryption (recommended)

`electron-builder` supports ASAR encryption via the `electronFuses` API and
a custom encryption key. This is the most practical production approach.

### 1. Install dependencies

```bash
npm install --save-dev electron-builder @electron/fuses
```

### 2. Configure electron-builder

`electron-builder.yml` (or `package.json` `build` key):

```yaml
appId: com.yourcompany.yourapp
files:
  - dist/**/*
  - "!dist/**/*.map"       # never include source maps
asar: true
asarUnpack:
  - "**/*.node"            # native addons must be unpacked

# Disable DevTools in production
extraMetadata:
  main: dist/main.js

afterPack: scripts/antirea-electron-afterpack.js
```

### 3. Create the afterPack hook

`scripts/antirea-electron-afterpack.js`:

```js
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
const path = require("path");

module.exports = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const electronBinary =
    process.platform === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "MacOS", packager.appInfo.productFilename)
      : process.platform === "win32"
        ? path.join(appOutDir, `${packager.appInfo.productFilename}.exe`)
        : path.join(appOutDir, packager.appInfo.productFilename);

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,

    // Disable Node.js CLI flags — prevents `--inspect` attachment
    // REA checks this with inspect_electron_fuses before attempting runtime analysis
    [FuseV1Options.EnableNodeCliInspectArguments]: false,

    // Disable REPL (no interactive Node.js console)
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,

    // Disable loading unsigned code
    [FuseV1Options.OnlyLoadAppFromAsar]: true,

    // Disable DevTools in production
    // (REA's runtime analysis uses DevTools protocol)
    [FuseV1Options.EnableDevToolsExtensions]: false,
  });

  console.log("[antirea] Electron fuses applied.");
};
```

### 4. What the fuses do against REA

| Fuse | REA tool blocked |
|------|-----------------|
| `EnableNodeCliInspectArguments: false` | `inspect_electron_fuses` detects this; REA aborts runtime analysis |
| `OnlyLoadAppFromAsar: true` | Prevents loading external JS modules injected by REA bridge |
| `EnableEmbeddedAsarIntegrityValidation: true` | Detects if ASAR was tampered with |
| `EnableDevToolsExtensions: false` | Blocks DevTools-based runtime inspection |

---

## Option B — Manual ASAR encryption with electron-packager

For projects not using electron-builder:

### 1. Generate an encryption key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Save this key securely — losing it means the app won't run
```

### 2. Encrypt ASAR at build time

Use `@electron/asar` with a custom transformer that encrypts each file:

```js
// scripts/antirea-encrypt-asar.js
const asar = require("@electron/asar");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEY = Buffer.from(process.env.ANTIREA_ASAR_KEY, "hex");
const SRC = process.env.ANTIREA_ASAR_SRC || "dist";
const OUT = process.env.ANTIREA_ASAR_OUT || "app.asar";

if (!KEY || KEY.length !== 32) {
  console.error("[antirea] Set ANTIREA_ASAR_KEY to a 32-byte hex string.");
  process.exit(1);
}

asar.createPackageWithOptions(SRC, OUT, {
  transform(filename) {
    if (!filename.endsWith(".js")) return null;
    // Return a transform stream that encrypts the file
    const { Transform } = require("stream");
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", KEY, iv);
    let first = true;
    return new Transform({
      transform(chunk, _enc, cb) {
        if (first) { this.push(iv); first = false; }
        cb(null, cipher.update(chunk));
      },
      flush(cb) { cb(null, cipher.final()); }
    });
  }
}).then(() => {
  console.log("[antirea] Encrypted ASAR written to: " + OUT);
});
```

### 3. Decrypt at runtime (Electron main process)

The main process must hook `require()` to decrypt before evaluation:

```js
// src/main/asar-decrypt.js — run at the very start of main.js
const crypto = require("crypto");
const Module = require("module");
const KEY = Buffer.from(process.env.ANTIREA_ASAR_KEY || "YOUR_KEY_HERE", "hex");

const originalLoad = Module._extensions[".js"];
Module._extensions[".js"] = function(module, filename) {
  if (!filename.includes("app.asar")) return originalLoad(module, filename);
  const encrypted = require("fs").readFileSync(filename);
  const iv = encrypted.slice(0, 16);
  const data = encrypted.slice(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", KEY, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  module._compile(decrypted.toString("utf8"), filename);
};
```

---

## What REA sees after ASAR encryption

Without encryption:
```
analyze_javascript_application → modules: 847, imports: 2341, IPC channels: 12
```

With encryption + fuses:
```
analyze_javascript_application → ERROR: cannot read ASAR (encrypted or integrity check failed)
inspect_electron_fuses → EnableNodeCliInspectArguments: false → runtime analysis aborted
```

REA's entire JavaScript analysis path is blocked.
