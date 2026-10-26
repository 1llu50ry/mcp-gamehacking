---
name: signature-generator
description: Generate byte patterns, IDA signatures, and code signatures for functions across game versions.
type: tool-plugin
---

# Signature Generator Plugin

Creates and validates byte patterns for game function identification.

## Commands

### `sig_generate`
Generate a byte signature for a function.
- Input: function description or known bytes
- Output: IDA-style pattern with wildcards, uniqueness score

### `sig_validate`
Check if a signature still matches across known versions.
- Input: signature pattern, game name
- Output: match results from archived sources, false positive count

### `sig_migrate`
Update a broken signature for a new game version.
- Input: old signature, old version context
- Output: suggested new signature based on function structure

### `sig_batch`
Generate signatures for multiple functions at once.
- Input: list of function names/descriptions
- Output: signature table with patterns and confidence scores

## Pattern Formats

- IDA style: `48 8B 05 ?? ?? ?? ?? 48 85 C0`
- Code style (C array): `\x48\x8B\x05\x00\x00\x00\x00\x48\x85\xC0` with mask
- x64dbg style: `48 8B 05 ?? ?? ?? ?? 48 85 C0`

## Detailed Specification

### Generator Contract
- **Input:** function RVA + binary
- **Output:** IDA-style pattern with wildcarded immediates / relative calls, with Scylla/mem-sig format
- **Options:** min length, uniqueness check against the entire binary

### Templating Model
Templates are versioned, parameterised Jinja/mustache-style skeletons. Each template declares required fields, defaults, and compile-time asserts. Generated code includes provenance comments linking back to the skill library entry that supplied each constant.

### Output Guarantees
Generated artefacts: (1) compile under the declared toolchain (MSVC 19.37+ or GCC 13+ or clang 17+), (2) include `static_assert` on sizes/offsets where applicable, (3) include a header comment with `// generated-from: {skill_name} @ {commit}`.

### Related Workflow
Combine with `write-driver`, `write-hook`, `write-injector` prompts for full end-to-end code generation. Templates ship with usage examples in the archive (`ags-*` with matching names).

### Caching and Performance
Listing queries hit the server-side skill directory cache (30-second TTL). Full-text searches across the 3,985 archived projects use keyword pre-filtering; large sweeps page results.

### Integration Points
Dispatched by relevant agents and subagents (see Related sections above). All results carry a confidence tier (A: 3+ corroborating sources, B: 1-2 sources with recent timestamps, C: single stale source).

### Update Strategy
Data is live against the skill library -- when new `ags-*` projects or hand-written skills land, this plugin reflects them on the next cache miss (<=30s).

Each line is cross-linked back to the 177 hand-written skills plus the 3,985 archived projects (prefixed `ags-`).

<!-- enriched:v2 -->
