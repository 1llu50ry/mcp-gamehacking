# Scope expansion — from game-hacking to RE platform

To unlock 10k+ stars, the project must address audiences beyond game security. The code already does; the branding and surface area doesn't yet.

## Current audience (~5k potential stars)

- Anti-cheat engineers at game studios
- Game security researchers / reversers
- Cheat developers (who star for the knowledge, not shipping — gray area)
- Game-preservation groups
- RE students focused on games

## Expand to (+ ~50k potential)

### 1. Malware analysis

**Why they'll star**: 59 backend hub + PE/ELF/Mach-O parsers + Volatility + YARA + angr already cover 90% of malware workflow. Position: "The AI malware analysis platform."

**Need to add**:
- Skills: generic unpacker chain, YARA generator from unpacked samples, memory forensics walkthrough.
- Rename / alias: `mcp-reverse-engineering` or `mcp-rever-everything` so the name doesn't ghetto-ize us.
- Audience: SentinelOne, CrowdStrike, Mandiant engineers; MalwareBytes; r/Malware; MalwareTechBlog.

### 2. Mobile security

**Why**: iOS/Android RE is huge. Hopper + Frida + JADX + libimobiledevice + adb + Magisk are already in the hub.

**Need to add**:
- Skills: iOS entitlements RE, Android dex2jar workflow, Zygisk hook catalog, Frida persistent attach.
- Alias: `mcp-mobile-security`.
- Audience: NowSecure, Guardsquare, DEF CON Mobile Hacking Village.

### 3. Firmware / IoT

**Why**: ELF + Qiling + Unicorn + angr + binwalk-equivalents cover embedded RE well.

**Need to add**:
- Skills: UEFI parse, Mediatek bootloader quirks, ESP32 RE, Realtek firmware.
- Alias: `mcp-firmware-re`.
- Audience: GreyNoise, Red Balloon, FirmAE.

### 4. CTF / exploit development

**Why**: pwndbg + gef + angr + AFL++ + honggfuzz + LibAFL + WinAFL already in hub. Pattern mining + crypto ID help with CTF.

**Need to add**:
- Skills: ROP chain basics, heap exploitation playbooks, kernel pwn, format string.
- Alias: `mcp-ctf`.
- Audience: PPP, HITCON, Google CTF, DEF CON CTF.

### 5. Enterprise security tooling

**Why**: Agent mesh + hub + audit log + rate limit = SOC-friendly multi-agent orchestrator.

**Need to add**:
- Skills: SIEM integration pattern, Splunk HEC emitter.
- Positioning docs for CISO / security architect persona.
- Audience: large infosec vendors looking at AI orchestration.

## Branding changes

### Current taglines

- "The MCP server for game hacking & reverse engineering"
- "4,200+ skills... designed to be plugged into Claude, Cursor..."

### Proposed hero taglines (A/B test)

- "The multi-agent reverse-engineering platform."
- "ChatGPT, Claude, and Cursor reverse binaries together."
- "The MCP server that unifies every RE tool."
- "Reverse engineer anything, with any model."

### Keep game-hacking as the primary vertical

Game hacking stays the depth-of-knowledge differentiator. We don't dilute 4,200 anti-cheat skills by rebranding away from them. Instead:

- Game hacking becomes **a** vertical, not the only vertical.
- README leads with the generic pitch; game-hacking shows up as the first vertical card.
- Alias package names (`mcp-reverse-engineering`, `mcp-ctf`, `mcp-malware-analysis`) all point at the same codebase.

## Implementation checklist

- [ ] Add `docs/verticals/malware-analysis.md`, `docs/verticals/mobile-security.md`, `docs/verticals/firmware.md`, `docs/verticals/ctf.md`.
- [ ] Add top-level README cards for each vertical.
- [ ] Publish aliased npm packages that re-export the same server.
- [ ] Add topic tags on GitHub for every vertical.
- [ ] Add Dev.to / HN posts customized per vertical, launched a week apart.
- [ ] Submit to each vertical's awesome-* list.

## Internationalization

Nearly all 100k+ star repos ship docs in multiple languages. Game security has huge communities in:

- Russian (lots of cheat development scene) → high priority.
- Simplified Chinese (massive Zygisk + mobile cheat scene) → high priority.
- Portuguese (Brazilian GC + Latam gamers) → medium.
- Japanese (mobile + console) → medium.

Minimum viable: README-ru.md, README-zh.md, README-pt.md.
