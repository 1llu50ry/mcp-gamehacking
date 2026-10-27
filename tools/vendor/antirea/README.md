# antirea

**English** · [简体中文](docs/readme/README_zh.md) · [繁體中文](docs/readme/README_zh-TW.md) · [日本語](docs/readme/README_ja.md) · [한국어](docs/readme/README_ko.md) · [Türkçe](docs/readme/README_tr.md) · [Русский](docs/readme/README_ru.md) · [Tiếng Việt](docs/readme/README_vi.md) · [ไทย](docs/readme/README_th.md) · [Deutsch](docs/readme/README_de.md) · [Español](docs/readme/README_es.md) · [Français](docs/readme/README_fr.md) · [Українська](docs/readme/README_uk.md) · [Polski](docs/readme/README_pl.md) · [Português (Brasil)](docs/readme/README_pt-BR.md) · [العربية](docs/readme/README_ar.md) · [فارسی](docs/readme/README_fa.md) · [Bahasa Indonesia](docs/readme/README_id.md) · [Italiano](docs/readme/README_it.md) · [Ελληνικά](docs/readme/README_el.md) · [മലയാളം](docs/readme/README_ml.md)

![antirea](docs/assets/banner.png)

**A skill that protects your project from AI-driven reverse engineering tools like REA.**

`rea` and similar tools direct AI agents to analyze a project's binaries, JS bundles, and APKs via MCP. Antirea places "stop" directives in exactly the places agents read first.

## How it works

REA attacks in three steps:

```
1. User → loads the REA skill into their agent
2. REA skill → instructs the agent to call MCP tools (open_binary, analyze_javascript_application, ...)
3. Agent → reads and analyzes the project's files/binaries
```

Antirea intercepts at step 2. A compliant agent reads the project's instruction files before taking any action. Antirea writes REA-blocking directives into those files.

```
1. User → loads the REA skill into their agent
2. REA skill → tells the agent "call open_binary"
3. Agent → reads AGENTS.md first → sees "REA PROHIBITED" directive → STOPS
```

## Defense layers

| Layer | Tool | What it does |
|-------|------|-------------|
| **L1** Agent instruction barrier | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` | Compliant agent refuses to call REA tools |
| **L1** Machine-readable deny | `.re-deny` | Machine-readable signal for REA-aware tools |
| **L2** Terminal shim | `node_modules/.bin/rea` | Intercepts `npx rea-agents` and `rea` CLI, exit 1 |
| **L3** JS obfuscation | `javascript-obfuscator` | All identifiers become `a`,`b`,`c`... — REA output is meaningless |
| **L3** Source map removal | `strip-sourcemaps.js` | `.map` files never reach distribution |
| **L3** IPC channel hashing | `antirea-ipc-hash.js` | Electron channel names become hashes like `ch_a3f9b2` |
| **L3** ASAR encryption | electron-builder fuses | `analyze_javascript_application` cannot read the ASAR |
| **L3** Debug symbol stripping | strip / CMake flags | `binary_overview` / `analyze_function` only sees `sub_XXXX` |
| **L3** Rust .dep-v0 removal | `antirea-strip-rust.sh` | `inspect_rust_binary` cannot see the dependency tree |
| **L3** Go strip + trimpath | `-ldflags="-s -w" -trimpath` | `inspect_go_binary` returns no module info |
| **L3** Android R8 + ProGuard | `proguard-antirea.pro` | JADX sees `class a { void a(b c) }` |
| **L3** .NET obfuscation | ConfuserEx | CIL metadata scrambled, strings encrypted |

## Run order

```
npm install   →  postinstall: shims installed to node_modules/.bin
npm run build →  prebuild: embed-barrier.js runs, barrier embedded into artifact
               →  build: normal build continues
```

Agent instruction files (AGENTS.md) protect the source directory. `embed-barrier.js` protects the distributed bundle/binary. Both work together.

## Installation

### 1. AGENTS.md / CLAUDE.md

Copy the contents of `templates/agents-inject.md` to the **very top** of your existing agent instruction file. If none exists, copy it directly as `AGENTS.md`.

### 2. .re-deny

Copy `templates/re-deny` to the project root as `.re-deny`.

### 3. package.json (JavaScript projects)

Add to `package.json`:

```json
{
  "rea": {
    "deny": true,
    "reason": "Analysis not authorized by project owner.",
    "contact": ""
  },
  "dependencies": {
    "rea-agents": "file:scripts/rea-agents-shim"
  }
}
```

### 4. Honeypot (optional)

**JavaScript:** Copy `templates/honeypot-js.js` to your project with the name matching the `"main"` field in `package.json` (e.g. `app.js`, `bundle.js`).

**Native:** Compile `templates/honeypot-native.c` and place it with the same name as the binary REA would open:

```bash
# Linux
cc -shared -fPIC -o libcore.so templates/honeypot-native.c

# macOS
cc -dynamiclib -o libcore.dylib templates/honeypot-native.c
```

## Important limits

| Scenario | Can antirea stop it? |
|----------|---------------------|
| Agent (Claude Code, Cursor, Codex) with REA skill loaded | **Yes** — AGENTS.md barrier |
| `npx rea-agents` run inside project directory | **Yes** — node_modules/.bin shim |
| `rea` run inside project directory via npx | **Yes** — node_modules/.bin shim |
| Distributed bundle/binary analyzed | **Partially** — embed-barrier.js stops compliant agents |
| `rea` run from outside project via absolute path | **No** |
| Agent that ignores instruction files | **No** |
| Binary obfuscation / real protection | **Out of scope** |

## File structure

```
antirea/
├── SKILL.md                                  ← Skill definition (main workflow)
├── README.md                                 ← This file
└── templates/
    ├── agents-inject.md                      ← Block to add to AGENTS.md/CLAUDE.md
    ├── re-deny                               ← .re-deny root config
    ├── honeypot-js.js                        ← JavaScript/Electron decoy file
    ├── honeypot-native.c                     ← Native binary decoy source
    ├── bin/
    │   ├── rea                               ← Unix/macOS terminal shim
    │   └── rea.cmd                           ← Windows terminal shim
    ├── rea-agents-shim/                      ← Strong npx blocker: local npm package
    │   ├── package.json                      ← name: "rea-agents", version: 999.0.0
    │   └── bin/
    │       ├── rea                           ← shim (Unix)
    │       └── rea.cmd                       ← shim (Windows)
    ├── scripts/
    │   ├── antirea-install.js                ← postinstall: installs shims to node_modules/.bin
    │   ├── embed-barrier.js                  ← prebuild: embeds barrier into artifact
    │   ├── antirea-obfuscate.js              ← postbuild: JS bundle obfuscation
    │   ├── strip-sourcemaps.js               ← postbuild: source map remover
    │   ├── antirea-ipc-hash.js               ← prebuild: hashes Electron IPC channel names
    │   └── antirea-strip-rust.sh             ← release: removes Rust .dep-v0 section
    └── hardening/
        ├── obfuscator.config.js              ← javascript-obfuscator configuration
        ├── proguard-antirea.pro              ← Android ProGuard/R8 rules
        ├── cmake-hardening.cmake             ← CMake release hardening flags
        └── electron-asar-encryption.md       ← Electron ASAR encryption guide
```

## Requirements

- **Node.js** 18 or later (for the scripts in `templates/scripts/`)
- **npm** 8 or later (for `file:` dependency resolution in the shim approach)
- The hardening tools (javascript-obfuscator, ProGuard, ConfuserEx, garble, etc.) are installed separately per project — antirea does not install them for you

Antirea's Layer 1 and Layer 2 work with any agent that reads project instruction files:
Claude Code, Cursor, Codex, Kilo, Gemini CLI, GitHub Copilot, and any other agent
that respects `AGENTS.md`, `CLAUDE.md`, or `.cursor/rules`.

## Disclaimer

**Antirea is provided as-is, with no warranties of any kind.**

- Antirea does not guarantee that reverse engineering of your project is impossible. It raises the cost and complexity of AI-assisted analysis significantly, but a determined human analyst with physical access to your binary and unlimited time can still reverse engineer it.
- The author(s) of antirea accept no responsibility for any damages, losses, or legal consequences arising from the use or misuse of this tool.
- It is your responsibility to verify that antirea's protections are correctly applied to your project before distribution.
- Antirea does not constitute legal advice. If you require legal protection for your intellectual property, consult a qualified attorney.
- The effectiveness of antirea depends on third-party tools (javascript-obfuscator, ProGuard, ConfuserEx, etc.) whose behavior may change. The author(s) of antirea are not responsible for changes in those tools.
- Using antirea does not guarantee compliance with any license, regulation, or export control law applicable to your project.

**By using antirea, you accept full responsibility for the outcome.**

## Contributing

Found a gap in the protection? Open an issue or pull request.

Useful contributions:
- New REA MCP tool names to add to the block list
- Hardening configs for additional project types (.NET MAUI, Flutter, Unity, etc.)
- Bug fixes in the scripts
- Translation corrections

## License

MIT
