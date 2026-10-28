# mcp-gamehacking cookbook

End-to-end scenarios showing how the pieces fit together. Each recipe
is self-contained: the tools used, the host plugins touched, and the
exact MCP calls in order.

| # | Recipe | What you learn |
|---|--------|----------------|
| 1 | [First decompile](01-first-decompile.md) | Smart fail-over between Ghidra / IDA / Binja via the hub, with mock bridges |
| 2 | [Multi-model mesh collab](02-mesh-collab.md) | Claude + GPT + Cursor share a channel, hand off tasks, vote on a plan |
| 3 | [Live Cheat Engine session](03-live-ce.md) | AoB scan → read bytes → ReClass struct → cheat-engine lua bridge |
| 4 | [VMProtect unpacking](04-vmp-unpack.md) | OEP recovery, section rebuild, string decryption with YARA + x64dbg |
