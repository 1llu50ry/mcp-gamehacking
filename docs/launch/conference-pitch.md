# Conference pitch kit

Ready-to-submit CFP abstracts. Each is ~2000 chars.

## DEF CON (RE Village / Red Team Village)

**Title**: `Three Models Walked Into a Reversing Lab: Multi-Agent MCP for RE`

**Abstract**:
> We built an MCP server that lets Claude Code, Codex (ChatGPT), and Cursor share a reversing workspace. Each registers as an agent, hands off tasks, and adversarially votes on each other's results. Behind one connection sit 59 external RE/debug backends (Ghidra, IDA, Binja, radare2, x64dbg, WinDbg, Frida, Cheat Engine, Volatility, YARA, angr, PCILeech) plus 111 native tools (PE/ELF/Mach-O/DEX/WASM/Minidump parsers, AoB scan, Shannon entropy, crypto-constant ID, PDB70 → symbol-server URL). In this 45-minute talk we live-reverse an anti-cheat driver with three models collaborating in real time, show where disagreement surfaces bugs the single-model approach misses, and open-source the voting protocol. Also covers the ethics boundary — why defensive security framing matters for AI-assisted RE.

**Takeaways**:
- The agent-mesh protocol for cross-model collaboration.
- A reusable playbook for driving every major RE tool via MCP.
- Why cross-tool consensus beats single-tool depth.

## REcon

**Title**: `Reversing Anti-Cheat Drivers with Multi-Backend MCP Consensus`

**Abstract**:
> Modern anti-cheat drivers rotate signatures every patch. Reversing them with one tool means you re-anchor every two weeks. We built an MCP server that fans the same question across IDA, Ghidra, Binja, and RetDec, surfaces the disagreement as a confidence tier, and lets Claude + Codex + Cursor vote on the winning answer. The result cuts anti-cheat RE churn in half for BattlEye, EAC, Vanguard, FACEIT, and Ricochet. Live demo + open source release.

## BlackHat (BSides preferred for first appearance)

**Title**: `The MCP Orchestration Layer for Reverse Engineering`

**Abstract**:
> MCP (Model Context Protocol) hit mainstream in 2024. One year later, every RE tool has an MCP wrapper. But each wrapper is a silo. We built the hub: one MCP connection fans out to 59 downstream MCPs (Ghidra, IDA, radare2, x64dbg, Frida, Volatility, YARA, angr, PCILeech, …), plus 111 native parsers (PE/ELF/Mach-O/DEX/WASM/Minidump/Unity/UE/IL2CPP), plus a multi-agent mesh where Claude + Codex + Cursor collaborate on the same artifact. Live demo: three models unpack a BattlEye driver and vote on the OEP. Open-source MIT.

## OffensiveCon

**Title**: `Three Models vs One Driver — Adversarial LLM Collaboration on Anti-Cheat RE`

**Abstract**:
> We ran Claude 4.5, Codex, and Cursor against five anti-cheat drivers (BattlEye, EasyAC, vgk.sys, FACEIT, Ricochet). Each ran independently. Then via our MCP mesh, each model handed its findings off to the next and voted on correctness. Agreement correlated with correctness at 0.78; disagreement surfaced bugs no single model caught. Talk covers the mesh protocol, the voting algorithm, and open-source release.

## CCC

**Title**: `Open-sourcing a 111-tool MCP server for reverse engineering`

**Abstract**:
> MCP is becoming the glue layer for AI-driven security work. We built the biggest open MCP server for RE — 111 native tools, 59 backend hub, multi-agent mesh, 4,200+ curated skills. Everything MIT. Talk covers the architecture, the 10-day stability experience of running it as the central tool across a small team, and lessons on cross-model collaboration.
