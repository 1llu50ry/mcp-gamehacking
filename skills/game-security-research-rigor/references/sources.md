# Sources

## Source roles

| Source | Strongest appropriate use | Main limitation |
|---|---|---|
| Primary artifact or raw trace | What this exact version did | May be incomplete or untrusted |
| Official specification/documentation | Intended behavior and interfaces | May omit implementation details |
| Peer-reviewed study | Evidence under its study design | External validity may be limited |
| Independent reproduction | Corroboration and failure discovery | Often version-specific |
| Vendor/community report | Leads and operational context | Bias and unverifiable details |

Do not assign a universal quality tier solely from publication venue or source
type. Judge authority, directness, methodology, independence, recency, and
claim fit separately.

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
This skill does not currently have a matching wiki overview. Use its local
references and the wiki catalog to find related pages; do not invent a path.

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

The routing and evidence references above help choose useful artifacts. Shared
[repository navigation](../../overview/references/repository-navigation.md) adds the optional read-only indexer,
case-ambiguity handling and maintenance details; it supplements this Data Source
section rather than replacing it.
