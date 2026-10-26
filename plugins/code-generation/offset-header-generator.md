---
name: offset-header-generator
description: Generate C++ offset header files from offset database entries.
type: tool-plugin
---

# Plugin: offset-header-generator

Generate C++ offset header files from offset database entries.

## Detailed Specification

### Generator Contract
- **Input:** JSON offset DB entry (game, version, named offsets)
- **Output:** `namespace cs2::offsets { constexpr uintptr_t dwEntityList = 0x1A3D4B0; }` -- type-safe C++20 header with namespacing, static_assert, and version tag
- **Options:** C++/C/Rust/Zig/Python output; endianness, bit-width, inlining

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
