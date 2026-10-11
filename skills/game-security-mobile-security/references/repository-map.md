# Repository Map

## Resource Organization

The README contains:
- Android hooking frameworks
- iOS jailbreak tools
- Memory manipulation utilities
- Root/jailbreak bypass tools
- Mobile anti-cheat research
- Emulator resources

---

## Repository Navigation

For project selection, load [repository resource selection](repository-resources.md) on demand. Use the shared [repository navigation](../../overview/references/repository-navigation.md) for local discovery layers, filename case, missing snapshots and currentness. Generated descriptions and wiki pages are discovery aids, not independent evidence.

For topic discovery, see the [compiled mobile-security overview](../../../../wiki/overviews/mobile-security.md). Verify its technical claims against primary sources and the actual target context.

## Data Source

Use the following repository sources directly when applying this skill. Prefer
available local files for discovery and scoped historical inspection; use the
raw URLs when the collection is not installed locally. These entrypoint details
are retained here so source lookup does not depend on loading another skill.

### 0. Compiled Wiki

Start with [wiki/index.md](../../../../wiki/index.md) for topical synthesis and
cross-project connections. [Wiki schema](../../../../wiki/AGENTS.md) describes its
structure. Generated wiki pages are discovery aids; follow their original
citations before adopting technical claims.

Raw catalog: [wiki/index.md](https://raw.githubusercontent.com/gmh5225/awesome-game-security/refs/heads/main/wiki/index.md).
For this domain, read [wiki/overviews/mobile-security.md](../../../../wiki/overviews/mobile-security.md).
Raw URL: [mobile-security overview](https://raw.githubusercontent.com/gmh5225/awesome-game-security/refs/heads/main/wiki/overviews/mobile-security.md).

A direct project question can start with its README entry or description below;
reading the entire wiki is unnecessary.

### 1. Project Overview and Resource Index

[README.md](../../../../README.md) contains the collection's actual categories,
subcategories, project URLs and short descriptions. Find the relevant category
and retain the original URL, including any specific file or revision suffix.

Raw index: [README.md](https://raw.githubusercontent.com/gmh5225/awesome-game-security/refs/heads/main/README.md).

### 2. Repository Descriptions

For a concise project summary, look for the actual local path:

```text
description/{owner}/{repo}/description_en.txt
https://raw.githubusercontent.com/gmh5225/awesome-game-security/refs/heads/main/description/{owner}/{repo}/description_en.txt
```

Example: [bgfx description](https://raw.githubusercontent.com/gmh5225/awesome-game-security/refs/heads/main/description/bkaradzic/bgfx/description_en.txt).
Extract owner/repository from the original GitHub project URL, omitting a .git
suffix. Resolve existing path casing before constructing a local/raw path.
Descriptions are generated summaries, not independent verification. If absent
or inaccessible, use the README entry, relevant archive or original project.

### 3. Repository Source Archives

For deeper inspection of an available captured source tree, locate:

```text
archive/{owner}/{repo}.txt
https://raw.githubusercontent.com/gmh5225/awesome-game-security/refs/heads/main/archive/{owner}/{repo}.txt
```

Example: [bgfx archive](https://raw.githubusercontent.com/gmh5225/awesome-game-security/refs/heads/main/archive/bkaradzic/bgfx.txt).
Prefer inspecting the relevant portion of an existing archive over re-cloning
merely to inspect the same captured material. Archives may exclude files, use
fallback extraction or contain truncation; they are not guaranteed complete
checkouts. Record any upstream revision evidence and included-file limits.
If missing or insufficient, follow the README's original upstream URL.

### Choose and Verify the Source

For a specific project, locate its README identity, use a description or wiki
page for orientation when helpful, then inspect the relevant archive/source
artifact for the question. For current compatibility or exact implementation,
verify the matching upstream documentation, release or immutable source revision.
Keep the collection revision and capture/generation dates separate from the
upstream version. Multiple generated layers from one source are not independent
corroboration, and missing archive content does not establish upstream absence.

The per-domain resource guide above helps choose useful artifacts. Shared
[repository navigation](../../overview/references/repository-navigation.md) adds the optional read-only indexer,
case-ambiguity handling and maintenance details; it supplements this Data Source
section rather than replacing it.
