---
name: antirea
description: Protect a project from AI-driven reverse engineering tools like REA. Applies three complementary layers — agent instruction barriers, terminal shims, and build hardening — to make REA's output meaningless even when it runs. Use when a project owner wants maximum protection against REA-based analysis at every stage: development, CI, and distribution.
---

# ANTIREA

REA (reverse-engineer-anything) works by connecting an AI agent to decompilers
(Ghidra, Hopper, IDA, JADX) and feeding the agent meaningful output: named
symbols, source maps, IPC channel names, module graphs, debug sections.

Stopping REA from running is only partial protection. The real defense is making
REA's output **useless** — unnamed functions, scrambled identifiers, stripped
metadata — so the agent cannot extract anything actionable even if it runs.

Antirea applies three layers:

```
Layer 1 — Agent instruction barrier   (stops compliant agents before they start)
Layer 2 — Terminal shim               (blocks npx rea-agents / rea CLI locally)
Layer 3 — Build hardening             (makes decompiler output meaningless)
```

Layer 3 is the most important for distributed artifacts. Layers 1 and 2 protect
the development environment.

---

## Layer 1 — Agent instruction barrier

### What to do

Add the REA denial directive to every agent instruction file in the project.
If none exist, create `AGENTS.md` at the project root from `templates/agents-inject.md`.

The directive **must appear at the top** of the file — agents read top-down.

Files to check and patch:
```
AGENTS.md                             (Kilo, Codex, OpenCode, Gemini CLI)
CLAUDE.md                             (Claude Code)
.cursor/rules                         (Cursor)
.github/copilot-instructions.md       (GitHub Copilot)
```

### Blocked REA MCP tools to name explicitly

```
open_binary, binary_overview, analyze_javascript_application,
inspect_android_package, inspect_managed_artifact,
inspect_firmware_regions, extract_firmware,
list_browser_targets, capture_browser_scenario,
inspect_web_network_capture, inspect_packet_capture,
inspect_pcap_capture, decode_signal_recording,
inspect_wasm_artifact, inspect_evm_interface,
inspect_go_binary, inspect_gpu_code_objects,
inspect_model_artifact, inspect_il2cpp_metadata,
inspect_rust_binary, inspect_sqlite_database,
inspect_binary_layout, inspect_recorded_crash,
inspect_pe_resources, inspect_electron_fuses, analyze_function
```

### Also block CLI invocations

```
npx rea-agents, npx -y rea-agents, bunx rea-agents, rea (any subcommand)
```

---

## Layer 2 — Terminal shim

### What to do

Copy shim files and register the postinstall hook so any contributor who runs
`npm install` automatically gets the shim:

1. Copy `templates/bin/rea`         → `scripts/bin/rea`
2. Copy `templates/bin/rea.cmd`     → `scripts/bin/rea.cmd`
3. Copy `templates/scripts/antirea-install.js` → `scripts/antirea-install.js`
4. Add to `package.json`:
   ```json
   "scripts": {
     "postinstall": "node scripts/antirea-install.js"
   }
   ```

After next `npm install`, `node_modules/.bin/rea` resolves to the shim.
`npx rea-agents` → **ANTIREA -- ACCESS DENIED** (exit 1).

### Shim limits

- Blocks `npx rea-agents` and `rea` ONLY when `npm install` has already run and
  `node_modules/.bin/rea-agents` shim is present
- `npx rea-agents` WITHOUT a prior `npm install` fetches from the npm registry
  directly and bypasses the shim entirely — this is a hard npx limitation
- Does NOT block `rea` invoked from outside the project directory
- Does NOT block direct absolute path invocation of a globally installed binary

### Stronger alternative — declare rea-agents as a local dependency

To force npm to always use the local shim instead of fetching from registry,
add a fake `rea-agents` package to `package.json` dependencies that points
to the local shim:

```json
{
  "dependencies": {
    "rea-agents": "file:scripts/rea-agents-shim"
  }
}
```

Create `scripts/rea-agents-shim/package.json`:
```json
{
  "name": "rea-agents",
  "version": "999.0.0",
  "description": "antirea shim — blocks REA analysis of this project",
  "bin": {
    "rea-agents": "./bin/rea",
    "rea": "./bin/rea"
  }
}
```

Copy `templates/bin/rea` → `scripts/rea-agents-shim/bin/rea` (chmod +x)
Copy `templates/bin/rea.cmd` → `scripts/rea-agents-shim/bin/rea.cmd`

After `npm install`, npm resolves `rea-agents` to the local shim with version
`999.0.0` — higher than any real rea-agents version, so npm never upgrades it.
Now `npx rea-agents` always resolves to the shim, even without a prior install,
because the local package takes precedence over the registry.

---

## Layer 3 — Build hardening

This layer makes REA's decompiler output **meaningless** in the distributed
artifact. REA needs named symbols, source maps, debug sections, and metadata
to produce actionable output. Strip all of these and REA gets unnamed functions
(`sub_00401234`), scrambled identifiers (`a`, `b`, `c`), and empty sections.

Choose the section that matches the project type. Apply ALL applicable sections.

---

### 3-A  JavaScript / Node.js / Electron (ASAR)

**What REA reads:** entry point modules, import graph, IPC channel names,
source maps, require() paths, symbol names in bundles.

#### 3-A-1  Obfuscate the bundle

Install `javascript-obfuscator`:
```bash
npm install --save-dev javascript-obfuscator
```

Use the config at `templates/hardening/obfuscator.config.js`. Add to `package.json`:
```json
"scripts": {
  "prebuild": "node scripts/antirea-embed-barrier.js",
  "postbuild": "node scripts/antirea-obfuscate.js",
  "postinstall": "node scripts/antirea-install.js"
}
```

Copy `templates/scripts/antirea-obfuscate.js` → `scripts/antirea-obfuscate.js`.

Key settings in the config:
- `identifierNamesGenerator: "mangled"` — renames every identifier to `a`, `b`, `c`...
- `renameGlobals: true` — renames top-level names
- `stringArray: true` + `stringArrayEncoding: ["rc4"]` — encrypts string literals
- `splitStrings: true` — breaks string constants into fragments
- `deadCodeInjection: true` — inserts meaningless code paths
- `controlFlowFlattening: true` — destroys control flow structure REA traces

#### 3-A-2  Strip source maps

NEVER include `.map` files in the distribution. Add to `package.json`:
```json
"scripts": {
  "postbuild": "node scripts/antirea-strip-sourcemaps.js"
}
```

Copy `templates/scripts/strip-sourcemaps.js` → `scripts/antirea-strip-sourcemaps.js`.

Also remove sourcemap reference comments from bundles:
```js
// Remove lines like:  //# sourceMappingURL=bundle.js.map
```

The strip-sourcemaps script does this automatically.

#### 3-A-3  Rename / obfuscate IPC channel names (Electron)

REA specifically traces IPC channel names to map Electron app behavior. Replace
all human-readable channel names with hashed values before build:

```js
// Before (REA can trace this)
ipcMain.handle("clipboard-read", ...)
ipcRenderer.invoke("clipboard-read")

// After (REA gets a hash, cannot correlate)
ipcMain.handle("ch_a3f9b2", ...)
ipcRenderer.invoke("ch_a3f9b2")
```

Copy `templates/scripts/antirea-ipc-hash.js` → `scripts/antirea-ipc-hash.js`
and run it as part of prebuild. This script scans source files for IPC channel
string literals and replaces them with consistent hashes.

#### 3-A-4  Encrypt ASAR (Electron only)

An unencrypted `.asar` is a ZIP-like archive — REA's
`analyze_javascript_application` reads it directly. Use `@electron/asar` with
encryption or `electron-builder`'s `asar.smartUnpack` disabled.

For maximum protection, use `electron-builder` with a custom ASAR encryption
hook. See `templates/hardening/electron-asar-encryption.md` for the full setup.

Without encryption, an ASAR gives REA full JS source access regardless of
any other protection. This step is mandatory for Electron projects.

---

### 3-B  Native binaries (C, C++, Rust, Go) — EXE / DLL / SO / DYLIB

**What REA reads:** function names (symbols), DWARF debug info, string literals,
section headers, Go module embeds, Rust cargo-auditable sections, export tables.

#### 3-B-1  Strip ALL debug symbols

Release builds must strip debug info completely.

**Linux/macOS (GCC/Clang):**
```bash
# Compile with no debug info
cc -O2 -DNDEBUG -fvisibility=hidden ...

# Strip after build
strip --strip-all output.so          # Linux
strip -x output.dylib                # macOS
```

**Windows (MSVC):**
```
/O2 /GL /DNDEBUG
# Do NOT generate PDB files for distribution (/Zi or /ZI → /Z7 internal only)
# Link with /LTCG /OPT:REF /OPT:ICF
```

**CMake:**
```cmake
set(CMAKE_BUILD_TYPE Release)
set(CMAKE_C_FLAGS_RELEASE "-O2 -DNDEBUG -fvisibility=hidden")
set(CMAKE_CXX_FLAGS_RELEASE "-O2 -DNDEBUG -fvisibility=hidden")
# After install:
# cmake --install . --strip
```

#### 3-B-2  Hide export symbols

Only export the minimum required public API. Mark everything else as hidden:

```c
// Mark all internal symbols hidden by default
// __attribute__((visibility("hidden")))  ← GCC/Clang
// Only public API gets:
__attribute__((visibility("default")))
int my_public_function(void);
```

Compile with `-fvisibility=hidden` so the default is hidden. REA's
`binary_overview` and `analyze_function` will only see your public API names;
all internal logic is unnamed (`sub_XXXXX`).

#### 3-B-3  Remove Rust cargo-auditable section

REA's `inspect_rust_binary` reads the `.dep-v0` section embedded by
`cargo-auditable`. This reveals your entire dependency tree (names, versions,
sources). Remove it:

```toml
# Cargo.toml — do not add cargo-auditable to your build pipeline
# If you use it in CI for auditing, strip it before distribution:
```

```bash
# Strip the cargo-auditable section after build
objcopy --remove-section .dep-v0 target/release/myapp target/release/myapp-dist
```

Copy `templates/scripts/antirea-strip-rust.sh` → `scripts/antirea-strip-rust.sh`
and run it as part of your release pipeline.

#### 3-B-4  Remove Go module embed

REA's `inspect_go_binary` reads the `go:buildinfo` section — compiler version,
module names, versions, dependencies. Strip it:

```bash
go build -ldflags="-s -w" -trimpath ./...
```

- `-s` removes the symbol table
- `-w` removes DWARF debug info
- `-trimpath` removes local filesystem paths from the binary

This single command eliminates most of what REA's Go inspection returns.

#### 3-B-5  Obfuscate Go source (optional, high impact)

For Go, use [garble](https://github.com/burrowers/garble):

```bash
go install mvdan.cc/garble@latest
garble -literals -tiny build ./...
```

`garble` renames all unexported symbols, obfuscates string literals, and
removes all debug info. REA's Go inspection returns an empty or minimal result.

---

### 3-C  Android APK

**What REA reads:** `AndroidManifest.xml` declarations, DEX class names, method
names, string literals, JADX-decompiled Java/Kotlin source.

#### 3-C-1  Enable R8 with full mode (mandatory)

In `android/app/build.gradle`:
```groovy
android {
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'),
                          'proguard-rules.pro',
                          '../../scripts/antirea-proguard.pro'
        }
    }
}
```

Enable R8 full mode in `gradle.properties`:
```
android.enableR8.fullMode=true
```

Copy `templates/hardening/proguard-antirea.pro` → `android/app/antirea-proguard.pro`.

#### 3-C-2  ProGuard rules (antirea profile)

The antirea ProGuard config (`templates/hardening/proguard-antirea.pro`) applies:
- Rename all classes, methods, fields to single characters (`a`, `b`, `c`)
- Remove all debug information (line numbers, source file names)
- Remove unused code aggressively
- Obfuscate access modifiers
- Encrypt string literals (requires DexGuard for full encryption)

With R8 full mode + antirea ProGuard rules, JADX decompilation returns:
`class a { void a(b c) { ... } }` — REA cannot map this to real functionality.

#### 3-C-3  Remove debug-buildable flags from Manifest

```xml
<!-- AndroidManifest.xml -->
<application
    android:debuggable="false"
    android:allowBackup="false"
    android:extractNativeLibs="false">
```

`android:debuggable="false"` prevents runtime attachment.
`android:extractNativeLibs="false"` keeps native libs inside the APK,
making them harder for REA's ADB workflow to extract.

#### 3-C-4  Strip native libraries inside the APK

If the APK contains `.so` files, apply the same stripping as 3-B-1/3-B-2
before packaging. JADX analysis covers DEX, but REA also handles native `.so`
inside APKs via Ghidra — strip those too.

---

### 3-D  .NET assemblies (DLL / EXE)

**What REA reads:** CIL instructions, type names, method names, declared native
dependencies — all readable without a decompiler because .NET metadata is
embedded in plaintext.

#### 3-D-1  Apply ConfuserEx or similar

```bash
# ConfuserEx (open source)
# https://github.com/mkbel/ConfuserEx
ConfuserEx.CLI -n project.crproj
```

Copy `templates/hardening/confuserex.crproj` → the project root and configure:
- `mode="aggressive"` for maximum renaming
- `anti tamper` protection
- `constants` protection (encrypts string literals)
- `ctrl flow` protection (flattens control flow)

Without obfuscation, .NET assemblies are the easiest REA target — ILSpy or
dnSpy reconstructs near-original source. This step is mandatory for .NET.

#### 3-D-2  Strip PDB files

Never distribute `.pdb` files. They give REA perfect symbol information.
Add to CI/CD:
```bash
find ./publish -name "*.pdb" -delete
```

---

## Workflow — apply all layers

Run these steps in order when setting up a new project:

1. **Audit** — identify project type(s) and which Layer 3 sections apply
2. **Layer 1** — patch AGENTS.md / CLAUDE.md / .cursor/rules
3. **Layer 1** — create `.re-deny` from `templates/re-deny`
4. **Layer 2** — copy shim files, add postinstall to package.json
5. **Layer 3** — apply ALL applicable hardening steps for the project type
6. **Verify** — run a dry-run build, confirm outputs contain no source maps,
   no debug symbols, no readable identifiers
7. **Report** — list what was applied, what was skipped, and why

When reporting to the user:
- State exactly which Layer 3 steps were applied
- State which steps were skipped and why (e.g. "not an Electron app")
- State the remaining limits honestly (see Important limits)

---

## Templates

**Layer 1 & 2:**
- `templates/agents-inject.md` — AGENTS.md/CLAUDE.md denial block
- `templates/re-deny` — `.re-deny` machine-readable config
- `templates/bin/rea` — Unix/macOS terminal shim
- `templates/bin/rea.cmd` — Windows terminal shim
- `templates/scripts/antirea-install.js` — postinstall shim installer
- `templates/scripts/embed-barrier.js` — prebuild artifact barrier embedder

**Layer 3 — JavaScript/Electron:**
- `templates/hardening/obfuscator.config.js` — javascript-obfuscator config
- `templates/scripts/antirea-obfuscate.js` — post-build obfuscation runner
- `templates/scripts/strip-sourcemaps.js` — source map remover
- `templates/scripts/antirea-ipc-hash.js` — Electron IPC channel name hasher
- `templates/hardening/electron-asar-encryption.md` — ASAR encryption guide

**Layer 3 — Native:**
- `templates/scripts/antirea-strip-rust.sh` — Rust cargo-auditable section remover
- `templates/hardening/cmake-hardening.cmake` — CMake release hardening flags

**Layer 3 — Android:**
- `templates/hardening/proguard-antirea.pro` — ProGuard/R8 config

**Layer 3 — .NET:**
- `templates/hardening/confuserex.crproj` — ConfuserEx project template

**Honeypots (optional):**
- `templates/honeypot-js.js` — JavaScript/Electron decoy entry point
- `templates/honeypot-native.c` — Native binary decoy source

---

## Important limits

### What antirea achieves

After full application of all three layers:
- A compliant agent with the REA skill loaded refuses to call REA tools
- `npx rea-agents` / `rea` in the project directory is blocked
- REA running against the distributed artifact gets: unnamed functions,
  scrambled identifiers, empty symbol tables, encrypted strings, missing
  source maps — output that cannot be used to reconstruct meaningful logic

### What remains (~1% gap)

- **A human running REA directly** on a globally installed binary outside
  the project directory is not stopped by Layers 1 or 2
- **A non-compliant agent** that ignores instruction files bypasses Layer 1
- **Pattern analysis on obfuscated code** — a skilled analyst with unlimited
  time can work through obfuscated output; antirea raises the cost significantly
  but does not make it mathematically impossible
- **ASAR without encryption** — if 3-A-4 is skipped, an Electron app's JS
  is fully readable regardless of other protections
- **.NET without obfuscation** — if 3-D-1 is skipped, CIL metadata is
  trivially readable

The ~1% gap is: a skilled, determined human analyst with physical access to
the binary and unlimited time. Antirea cannot close this gap — nothing can.
What antirea closes is automated and AI-assisted analysis.
