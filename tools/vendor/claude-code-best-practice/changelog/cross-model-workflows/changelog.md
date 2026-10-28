# Cross-Model Workflows Changelog

**Status Legend:**

| Status | Meaning |
|--------|---------|
| `COMPLETE (reason)` | Action was taken and resolved successfully |
| `INVALID (reason)` | Finding was incorrect, not applicable, or intentional |
| `ON HOLD (reason)` | Action deferred, waiting on external dependency or user decision |

---

## [2026-05-13 PKT] Cross-Model Workflows Section Created

| # | Priority | Type | Action | Status |
|---|----------|------|--------|--------|
| 1 | HIGH | Section | Created new `## 🔀 CROSS-MODEL WORKFLOWS` section in README.md, inserted between DEVELOPMENT WORKFLOWS and SKILL COLLECTIONS; section explains the three bridge mechanisms (Plugin / MCP / Router) and links the existing cross-model methodology doc as the section intro | COMPLETE (new section live) |
| 2 | HIGH | Add | Seeded table with 4 repos at 10k+ stars threshold: musistudio/claude-code-router (34k, Router), router-for-me/CLIProxyAPI (32k, Router), openai/codex-plugin-cc (18k, Plugin), BeehiveInnovations/pal-mcp-server (12k, MCP — formerly zen-mcp-server) | COMPLETE (table seeded) |
| 3 | MEDIUM | Move | Removed `Cross-Model (Claude Code + Codex) Workflow` bullet from `DEVELOPMENT WORKFLOWS → Others` list; re-homed as the methodology intro line inside the new section so the user-authored two-terminal flow stays discoverable without duplicating | COMPLETE (deduplicated) |
| 4 | LOW | Threshold | Established 10k+ stars floor for inclusion (matches AGENT COLLECTIONS threshold); auto-reject lower-starred repos in future runs | COMPLETE (policy recorded in memory) |
| 5 | LOW | On Hold | decolua/9_router (9.3k stars — "FREE Claude/GPT/Gemini via 40+ providers") sits just under threshold; re-evaluate on next run | ON HOLD (below threshold) |
| 6 | LOW | Excluded | EveryInc/compound-engineering-plugin (17k) initially flagged as cross-model — verified to be Claude-only workflow plugin (37 skills + 51 agents all run inside Claude); stays in DEVELOPMENT WORKFLOWS table | INVALID (not cross-model) |
| 7 | LOW | Excluded | Sub-10k repos with unique angles documented for reference (re-evaluate if they cross threshold): 1rgs/claude-code-proxy (4k, Router→OpenAI/Gemini via LiteLLM), jamubc/gemini-mcp-tool (2k, MCP→Gemini context window), LLM-Red-Team/kimi-cc (2k, Router→Kimi K2), jarrodwatts/claude-delegator (1k, Plugin→Codex/Gemini delegation) | ON HOLD (below threshold, candidate watchlist) |
