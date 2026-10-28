# Changelog

All notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [5.0.0] — 2026-10-28

Major release — four feature waves plus a weight-cut that takes the
on-disk project from 19 GiB working tree to ~3 GiB (and the npm package
down to a few MiB).

### Added
- **Wave 1 — host plugin build systems**: `.csproj` for ReClass.NET /
  dnSpy / ILSpy, `CMakeLists.txt` for x64dbg with bitness-aware
  `.dp64` / `.dp32` suffix, `plugins-side/install.ps1` + `install.sh`
  with host auto-detect, `.github/workflows/plugins.yml` (python
  `py_compile` + Lua `luac` + C# syntax + MSVC `/Zs`), mock bridge
  server + 7 integration tests, `docs/cookbook/` with 4 end-to-end
  recipes.
- **Wave 2 — dynamic analysis & symbols**: `plugins-side/frida/mcp_bridge.py`
  (standalone, 12 `frida_*` tools: attach/detach, inject JS, trace
  exports, dump/replace memory, enumerate modules). Native x86-64
  emulator (`emu_run` + `emu_decrypt_xor`), DWARFv4/v5 parser
  (`dwarf_parse`), MSF/PDB parser (`pdb_info`), FLIRT-light signatures
  (`sig_list` / `sig_match` / `sig_make` with 8 shipping sigs).
  Prometheus `/metrics` + live `/dashboard` HTML page.
- **Wave 3 — platform & distribution**: AArch64 emulator
  (`emu_arm64_run`), content-addressable decompile cache
  (`cache_stats` / `cache_clear`), large-output chunker
  (`chunk_fetch` / `chunk_list`), per-request trace-id + per-user
  HTTP rate limit (`MCP_RATE_LIMIT_PER_USER=1`), MCP handshake now
  declares `capabilities` + `instructions`. 7 ready-to-paste client
  configs under `examples/clients/` (Claude Desktop, Cursor, Cline,
  LM Studio, Zed, Continue.dev, OpenAI Agent SDK). Hardened systemd
  unit + NSSM Windows service installer.
- **Wave 4 — RE ops**: `bindiff` (function-level fingerprint diff),
  `rop_find` + `rop_chain` (gadget search + packed chain builder for
  x86-64 and aarch64), `unity_il2cpp_metadata` / `unreal_fnames` /
  `godot_pck` (game-engine metadata), `decompile_summarize` /
  `struct_name_suggest` / `explain_at_level` (model-aided RE via
  MCP sampling), `viz_call_graph` / `viz_cfg` (SVG graph rendering).

### Changed
- **`source.txt` → `source.txt.gz`** for every skill. Working tree
  drops from 19 GiB → ~3 GiB; new `bin/mcp-gamehacking unpack` /
  `pack` subcommands manage both layouts. The read helpers in the
  server (`safeRead`, `fileExists`, `grepFile`) transparently fall
  back to the `.gz` file, so every existing tool keeps working.
- `.gitignore` now ignores decompressed `skills/*/source.txt`.
- Server registers 100+ MCP tools (added 40+ in this release).

## [4.6.0] — 2026-10-26

### Added
- **Composite** `analyze_binary` — one-shot deep triage: `file_identify` → format-specific parser → Rich Header → Debug Directory → entropy per 64 K → top unique strings → crypto-constant scan.
- **Composite** `pe_debug_dir` — PE Debug Directory walker; extracts RSDS (GUID / age / PDB path) ready for `symsrv_download`, detects REPRO (Reproducible Build), POGO, VC_FEATURE, ILTCG, MPX, EX_DLLCHARACTERISTICS.
- **Composite** `compare_binaries` — fast side-by-side (sha256, format, entropy) before dropping to BinDiff / Diaphora.
- **BM25 search** `bm25_search` + `bm25_rebuild` — zero-dep inverted index over 4,200 skills with 10-minute TTL. Smoke-tested: `"battleye kernel shellcode"` → 1,095 hits across 4,230 docs; top-3 all relevant.
- **Audit log + rate limit** `audit_tail`, `audit_log`, `rate_limit_check`, `rate_limit_status` — JSONL rolling file; token-bucket per `(tool, agent)` opt-in via `MCP_RATE_LIMIT=1`.
- **Dynamic MCP Resources** — URI-addressable `gamehacking://skills/{name}`, `gamehacking://ags/{name}/source`, `gamehacking://plugins/{category}/{name}`, and more.
- **GitHub Release workflow** — tag `v*` → npm publish with provenance + multi-arch Docker to `ghcr.io/<owner>/mcp-gamehacking:<ver>` + release notes.

### Changed
- Server registers 111 MCP tools (+9 vs 4.5).
- README rewritten with hero section, Mermaid architecture, and comparison table.

## [4.5.0] — 2026-10-26

### Added
- Path sandbox (`MCP_FS_ALLOW` / `MCP_FS_DENY`) wired into every file-reading tool.
- Native container parsers: `zip_parse`, `apk_scan`, `dotnet_parse`, `cat_sniff`.
- Meta tools: `fs_sandbox_status`, `wiki_link_check`, `training_jsonl_export`, `symsrv_download`, `pattern_mine`, `mesh_orchestrate`.
- `Dockerfile` (multi-stage, non-root `node`, dumb-init), `docker-compose.yml`, `.dockerignore`.
- CLI `bin/mcp-gamehacking` with `serve / stats / lookup / search / tools / health`.
- 10 fresh game skills: Marvel Rivals, THE FINALS, Delta Force, Palworld, Deadlock, Arena Breakout, Grey Zone Warfare, Hunt: Showdown 1896, Blood Strike, XDefiant.

## [4.4.0] — 2026-10-26

### Added
- **Agent Mesh** — 15 tools letting Claude Code / Codex / ChatGPT / Cursor / Copilot / Gemini CLI share a workspace: register, DM, channels, task handoff with status machine, adversarial voting with confidence, shared KV knowledge-base, named locks with TTL. Zero-dep JSON persistence (`.agent-mesh/mesh.json`).
- **MCP Hub** — 6 tools making our server a CLIENT to other MCPs. `hub_connect`, `hub_list`, `hub_call`, `hub_disconnect`, `smart_decompile` (first available decompiler), `hub_consensus_call` (regex fan-out for adversarial comparison).
- `docs/agent-mesh.md` + `docs/mcp-hub.md`.
- 3 new e2e tests (mesh) over MCP stdio.

## [4.3.0] — 2026-10-26

### Added
- Dependabot cleared (ip-address, body-parser, fast-uri, zod).
- Native parsers: `minidump_parse`, `pdb70_identify` (returns MS symbol-server URL), `rich_header_parse`, `demangle` (MSVC + Itanium), `assetbundle_parse`, `pak_parse`, `il2cpp_metadata_parse`, `nso_parse`.
- Workflow tools: `offset_diff`, `offset_merge`, `sig_validate_cross_build`, `ac_risk_report`, `generate_cheat_sheet`.
- 15 new RE/debug backends: OllyDbg, AFL++, honggfuzz, LibAFL, WinAFL, V8 Inspector/CDP, idevice, adb, magisk, kdnet, gef, pwndbg, retdec, snowman.
- HTTP transport (`MCP_TRANSPORT=http`) + `/healthz` + `/metrics` (Prometheus).
- CI matrix (Node 18/20/22) with smoke-test.

## [4.2.0] — 2026-10-26

### Added
- 16 RE/debug MCP backend catalog with launch / HTTP / config emission.
- Native TS parsers: `pe_parse`, `elf_parse`, `macho_parse`, `dex_parse`, `wasm_parse`, `file_identify`, `aob_scan`, `entropy_scan`, `string_extract`, `hash_identify`, `signature_make`, `file_summary`.
- 32 new hand-written skills.
- 9 new RE/debug backend skills.
- 1 new catalog plugin.
- Vendored tool trees under `tools/vendor/vibe-re` and `tools/vendor/ida-pro-mcp`.
- FakePDB (mixaill, Apache-2.0) vendored under `tools/vendor/fakepdb` + `fakepdb_install` + `fakepdb_run` tools.

## [4.1.0] — 2026-10-26

### Added
- Enriched 498 plugin/agent/prompt/subagent files with category-specific detail.
- 6 new skills for better-options MCPs.
- `src/retools.ts` with 16 MCP tools for launching external backends.
