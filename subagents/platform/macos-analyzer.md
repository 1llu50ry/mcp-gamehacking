---
name: macos-analyzer
description: Analyze macOS game binaries with Mach-O format and dyld injection.
type: subagent
---

# Subagent: macos-analyzer

Analyze macOS game binaries with Mach-O format and dyld injection.

## Processing Pipeline
### Input Contract
Structured task spec with required fields depending on the subagent purpose (target binary, game, version, offset name, pattern string, etc.) plus optional output-format preferences.

### Output Contract
Primary result + confidence tier (A/B/C) + sources (skill names + line numbers) + caveats (version/stability/stealth) + related findings.

### Steps
1. Validate input shape.
2. `search_skills` with domain keywords.
3. per-OS build offset tables + API surface differences.
4. Cross-validate against archived sources.
5. Emit output with provenance.
### Integration Points
Any of the 75 agents can dispatch this subagent; it is stateless between invocations. Parallel invocations are safe. The subagent may dispatch other subagents (e.g. `pattern-scanner` -> `offset-validator`) but does not call back into its parent agent.

### Error Handling
When context is insufficient, the subagent reports what it did find plus suggested next steps. It never fabricates offsets or signatures and never silently falls back to stale data.

### Performance
Keyword-pre-filters the 3,985-source archive before full-text analysis. Uses the 30-second directory cache. Lookup latency: ~50-200 ms for cached queries; multi-second for cold archive sweeps.

### Related Subagents
Dispatches / is dispatched by the siblings in `platform/` plus the cross-cutting `offset-finder`, `pattern-scanner`, `code-analyzer`, `detection-assessor`, and `vulnerability-scanner`.

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
