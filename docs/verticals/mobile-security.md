# Vertical: mobile security

iOS and Android RE converge on the same primitives: ARM/AArch64 decomp, Frida/Zygisk instrumentation, IL2CPP (if Unity), DEX/APK structure, Objective-C/Swift metadata.

## Workflows

- **APK triage**: `apk_scan <path.apk>` → `dex_parse` on each DEX → `jadx-mcp` for Java decompile.
- **IL2CPP games**: `il2cpp_metadata_parse` → `Il2CppDumper` via `vibe_re_run` or external.
- **Native library RE**: `elf_parse` → `superghidra-mcp` or `ida-pro-mcp` on `.so`.
- **iOS**: `macho_parse` (fat + arm64e) → `hopper-mcp` → `idevice-mcp` for live attach → `frida-mcp` for Objective-C hooks.
- **Rooted testing**: `magisk-mcp` + `frida-mcp` for anti-root bypass research.

## Agent flow

```
Claude  → apk_scan game.apk
Codex   → dex_parse classes.dex → jadx-mcp
Cursor  → frida-mcp → attach + hook
Claude  → mesh_task_vote on Cursor's hook result
```

## Skills to add

- `android-signv2-signv3`
- `android-package-manager-rev`
- `zygisk-hook-catalog`
- `frida-persistent-attach-ios`
- `ios-entitlements-cheat-sheet`
- `arm64e-pac-bypass`
- `ssl-pinning-bypass-families`
