# ai-memory-client

Private capture privacy helpers shared by the standalone relay and conversation
importer. This package has its own Cargo workspace and is not published to crates.io.

The four public functions have shipped callers:

| Function | Caller and purpose |
| --- | --- |
| `reject_sensitive` | Relay binding and native event identities; importer source/native identities and delivery URLs. Rejects credentials and unsafe controls without renaming identities. |
| `sanitize_external_text` | Importer conversation text before transcript hashes, event bodies, previews and manifests. |
| `sanitize_external_value` | Relay ingress and importer event planning before body serialization, hashing or persistence. Recursively scrubs strings and opaque credential values. |
| `check_body` | Both companions before delivery; relay before enqueue and importer before event hashing. Refuses unsafe content and top-level destination or actor authority. |

Credential keys accept camelCase, acronym and separated spellings, including
plural API, access, private and session key pairs. Only numeric values under
these 11 normalized names retain their representation: `max_tokens`,
`input_tokens`, `token_count`, `token_usage`, `output_tokens`, `total_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens`, `prompt_tokens`,
`completion_tokens`, and `reasoning_tokens`. Strings or objects under these
names are redacted. Other credential-like numeric fields are redacted too.

Values are bounded to 64 nesting levels and individual strings to 256 KiB.
Checked bodies must be objects and their serialized size cannot exceed 256 KiB.
Complete redaction markers survive repeated scrubbing. Importer truncation
preserves UTF-8 boundaries and drops a marker that would be cut in half.

Native identity validation precedes sanitation. Already-pending relay bytes,
digest, retry key and attempt state are never rewritten. An unsafe pending head
defers only its session; clean sessions still advance. Body provenance remains
untrusted data, and server scope, authorization and capture policy remain
authoritative. Producers must apply capture exclusions before using the relay.

Run this package's format, clippy and test checks separately, as with the other
companions. Root workspace checks do not cover its tests.
