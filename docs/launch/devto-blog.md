---
title: "I built an MCP server where Claude, Codex and Cursor reverse-engineer binaries together"
published: false
tags: ai, reverseengineering, mcp, security
cover_image: https://raw.githubusercontent.com/whory/mcp-gamehacking/main/docs/launch/cover.png
canonical_url: https://github.com/whory/mcp-gamehacking
---

# The problem

Reversing a modern game binary is a context-switch nightmare.

You open IDA for static analysis. Then Ghidra because its P-code lifter catches what IDA misses. x64dbg for live debugging. WinDbg when you fall into kernel. Cheat Engine for memory scanning. Frida for runtime instrumentation. Volatility for crash dumps. Wireshark + mitmproxy for the network. And a hex editor open the whole time.

Each tool has its own ask-and-answer loop. Each loop breaks your flow. The best reverser I know says ~70% of her day is tool-shuffling and ~30% is actual thinking.

AI coding assistants (Claude Code, Codex, Cursor) are great at the thinking part. But they can only drive one tool at a time. And they can't talk to each other.

# What I shipped

[mcp-gamehacking](https://github.com/whory/mcp-gamehacking) — an MCP server that:

1. **Unifies 59 external RE/debug MCP backends** behind one connection. `smart_decompile 0x401000` fails over through IDA → Ghidra → Binja → RetDec. `hub_consensus_call matcher=decompile` fans out across all three and reports disagreement.
2. **Ships 111 native MCP tools** so most answers never leave the server — zero-dep TypeScript parsers for PE, ELF, Mach-O, DEX, WASM, Minidump, ZIP/APK, .NET metadata, Unity AssetBundle, UE `.pak`, IL2CPP, Switch NSO. AoB scan, Shannon entropy, crypto-constant ID, PDB70 → MS symsrv URL.
3. **Lets Claude, Codex, and Cursor collaborate** through a mesh — register, DM, channels, hand off tasks, adversarially vote on each other's findings, shared KV knowledge-base, named locks for coordination. Zero-dep JSON persistence.
4. **Curates 4,200+ skills** — 246 hand-written references on anti-cheats (BattlEye, EAC, Vanguard, VAC, FACEIT, Byfron, Ricochet, mhyprot) and 3,985 archived open-source projects with full source dumps.

MIT. Docker multi-arch. HTTP + stdio transports. `/healthz` + `/metrics`.

# Three demos

## 1. One-shot deep binary triage

```
Me: analyze_binary C:\game\protected.exe

Server:
# analyze_binary C:\game\protected.exe
- size: 15,872,000 bytes
- magic matches: PE
- sha256: 7c3a9f...
- shannon (1 MiB window): 7.912

## PE
- machine=amd64 bits=64 subsystem=windows_cui
- entry=0x1A32C00 base=0x140000000 sizeOfImage=0x1F00000
- timestamp=2024-11-04T18:22:15.000Z
- dllChars=HIGH_ENTROPY_VA|DYNAMIC_BASE|NX_COMPAT|GUARD_CF
- overlay=0 B  authenticode=4096 B
- imports (6 DLLs): KERNEL32.dll, USER32.dll, GDI32.dll, ADVAPI32.dll, WS2_32.dll, VCRUNTIME140.dll

### Debug Directory
- CODEVIEW   size=0x00003E
  RSDS GUID=A7F13C4B-7F9E-4C85-9B6F-1A33E7FE2B01 age=1 pdb=C:\build\Protected.pdb
- REPRO      size=0x000018  REPRO (Reproducible Build enabled)
- POGO       size=0x000234  POGO sig=0x4C544347

## Entropy
- max=7.998
- windows >7.2: 198/243

## Crypto constants
- 0x1A2300  SHA-256 H0
- 0x1A2318  AES RCon
- 0x1A2E80  ChaCha20 sigma
```

Everything the first 90 seconds of static triage needs. In one tool call.

## 2. Three-model collaboration

```
Claude:  mesh_task_create to=codex title="unpack driver.sys" spec="..."
Codex:   accepts → analyzes → mesh_kb_set "driver.sys.oep" "0x14010A3F0" → completed
Claude:  mesh_task_vote verdict=approve confidence=0.9
Cursor:  mesh_task_vote verdict=needs_work confidence=0.3
         → tally: approve=0.90 needs_work=0.30 → approved
```

The agents don't need to be the same model. They don't need to share context. They just need an agent_id and the mesh tools.

## 3. BM25 search over 4,200 skills

```
Me: bm25_search "battleye kernel shellcode detection"
Server: 1,095 hits (top 3):
  - ags-battleye-shellcode-dumper  score=15.23
  - battleye                        score=15.19
  - ags-battleye-shellcode          score=15.06
```

Zero deps. 10-minute TTL inverted index. ~1 second cold build on the full archive.

# What I learned

**Multi-agent coordination is a game design problem.** The hardest part was the mesh. Not the protocol — the primitives. What tools do agents actually need?

- `send + read` is table stakes.
- `task + vote` is where the magic happens.
- `kb_set/get` is the shared memory.
- `locks` are the thing you don't realize you need until you watch two agents race.

**Zero-dep goes a long way.** The core (111 native tools + mesh + hub) uses only `@modelcontextprotocol/sdk` and `zod`. Every binary format parser, the BM25 inverted index, the atomic JSON persistence — all vanilla Node. The project ships at ~300 KB.

**The skill library is bigger than the code.** 4,200+ docs on BattlEye signatures, UE5 FNamePool layout, IL2CPP decryption, EPT hooks, DMA via PCILeech. The code is the vehicle; the library is the product.

# Try it

```bash
git clone https://github.com/whory/mcp-gamehacking
cd mcp-gamehacking
npm install && npx tsc && npm test
./bin/mcp-gamehacking.mjs tools      # list every registered tool
```

Point your MCP client at it. ⭐ if it saves you an hour today.

# What's next

Public [roadmap](https://github.com/whory/mcp-gamehacking/blob/main/ROADMAP.md). Next up: persistent BM25 index on disk, OpenTelemetry traces, DWARF v5 line program parser, local embedding model for semantic skill search.

Would love to hear what tool you'd add. Open an issue, I read everything.
