# ADR-009 — Optional Multi-Database Support

**Date:** 2026-09-18
**Status:** Accepted
**Tags:** `storage`, `sqlite`, `multi-database`, `local-first`

> **POLICY CLARIFICATION:** This ADR revises the future scope of `adr-001-use-sqlite.md`; it does not delete or invalidate SQLite as the implemented foundation. SQLite remains the default, zero-configuration, local-first storage baseline. Multi-database support is an optional future capability and is not implemented by this ADR.

## Context

The project currently uses SQLite as its storage foundation. `src/mcp/storage/base.ts` imports `better-sqlite3`, stores the driver connection on `BaseEntity`, prepares SQLite statements directly, and wraps writes in SQLite transactions. The storage layer currently has no storage-port interface or driver-neutral repository boundary. Approximately 19 hot-domain entity classes are coupled to this model, with 20 `BaseEntity` subclasses when the separate `ColdArchiveStore` is included.

The schema and search layer are also SQLite-specific. The repository has 38 numbered migrations (`v01` through `v38`) containing raw SQLite SQL, including five relevant FTS5 virtual-table definitions or placements across the migration and derived-storage paths: the initial and attached-derived codebase-symbol indexes, the coding-standards index, the memories index, and the entity-names index. The v18 migration rebuilds the codebase-symbol index to add signature search. A future PostgreSQL adapter would require an FTS5-to-`tsvector` rewrite; MariaDB/MySQL would require an equivalent `FULLTEXT` design and query rewrite.

The current SQLite deployment already separates some data physically. `src/mcp/storage/derived-db.ts` uses `ATTACH DATABASE` to expose `codebase.db` as the `derived` schema, while `src/mcp/storage/cold-archive.ts` opens a separate SQLite connection for the cold archive. `ATTACH` has no direct cross-database equivalent that preserves the same schema and query behavior across PostgreSQL, MariaDB, and MySQL. The derived migration is explicitly not wrapped in a transaction because WAL makes cross-file SQLite transactions non-atomic (`derived-db.ts:330-332`). Those boundaries must be redesigned before a multi-database adapter can claim equivalent atomicity.

The immediate multi-client contention problem is addressed separately by ADR-010: an opt-in Streamable HTTP daemon lets many clients share one process, store, and worker set while stdio remains the default. That transport change reduces the need for multiple independent SQLite writers; it does not provide multi-database support.

## Decision

SQLite remains the default persistence engine and the zero-configuration baseline. The default posture remains local and self-hosted: no cloud database or hosted service becomes mandatory, and the Local-First guarantee remains unchanged.

Optional multi-database support is accepted as a future, explicitly scoped capability. PostgreSQL is the preferred first adapter, followed by MariaDB/MySQL if a concrete use case justifies the additional compatibility work. Adapters may be added only after a storage-port abstraction has been designed and implemented, with explicit capability and migration decisions for transactions, search, derived data, cold archives, and asynchronous drivers. The feature must be opt-in and must not change the default SQLite path or silently select a remote database.

This decision revises the future extensibility boundary of `adr-001-use-sqlite.md`; ADR-001 remains the record of why SQLite was selected and remains the default implementation choice.

## Status

**Accepted** — SQLite remains the shipped default; the optional adapter capability is approved for a future, separately scoped implementation.

## Consequences

**Positive:**

- Existing users retain zero-configuration local SQLite storage, single-file portability for the default hot database, WAL behavior, and the current local-first deployment posture.
- A future PostgreSQL adapter can address deployments that need a server database without making that operational model mandatory for local users.
- The storage-port prerequisite makes driver differences explicit before adapter code is introduced.
- ADR-010 provides the immediate one-daemon/many-client mitigation for SQLite contention while this longer-term abstraction remains deferred.

**Negative:**

- A server-backed adapter loses SQLite's single-file portability and adds database provisioning, credentials, backup, and operational lifecycle work.
- FTS5 queries and indexes must be rewritten for PostgreSQL `tsvector` or MariaDB/MySQL `FULLTEXT`; ranking, tokenization, prefix behavior, and fallback semantics require compatibility tests.
- SQLite's `ATTACH`/`derived` schema arrangement has no direct equivalent across all target databases, and the separate `cold-archive.db` connection needs an adapter-specific archival boundary.
- The synchronous `better-sqlite3` model must become compatible with asynchronous drivers across approximately 19 hot-domain entity classes, including callers, transaction helpers, startup, and tests.
- The 38 existing raw-SQL migrations cannot be reused unchanged by other engines; each adapter needs schema versioning and migration coverage.
- Cross-database atomicity must be specified explicitly because the current SQLite cross-file migration is documented as non-atomic.

**Neutral:**

- No multi-database adapter, storage port, or migration is implemented by this ADR.
- SQLite-specific features remain supported and may continue to be used behind the SQLite adapter where they are part of the default contract.
- PostgreSQL is preferred for the first adapter, but that preference does not commit the project to a delivery date or a hosted deployment.

## Alternatives

### A. Keep SQLite as the only supported database (rejected)

This preserves the smallest implementation surface, but it prevents a future explicitly scoped server-database option. The owner-approved policy requires SQLite to remain the default while allowing optional adapters behind a future abstraction.

### B. Add database adapters before introducing a storage port (rejected)

This would duplicate SQLite-specific assumptions across each adapter and make transaction, search, archive, and derived-data semantics inconsistent. The storage port is a prerequisite.

### C. Make PostgreSQL or another server database the default (rejected)

This would break the zero-configuration, self-hosted local baseline and weaken the Local-First deployment posture. Optional adapters must remain opt-in.

## Implementation Notes

Migration Path / Roadmap:

1. **HTTP daemon:** Ship the opt-in Streamable HTTP transport so many MCP clients can share one daemon and one SQLite store. See ADR-010.
2. **SQLite hardening:** Complete configurable busy-timeout and bounded transient-write retry behavior so the default multi-process deployment fails less often under contention.
3. **Storage-port abstraction:** Define a driver-neutral storage contract, transaction/error semantics, search capability boundaries, migration ownership, and async lifecycle before adding a second driver.
4. **Multi-database adapters:** Implement and test the PostgreSQL adapter first, then evaluate MariaDB/MySQL adapters against the same contract. Keep the adapters opt-in and preserve the SQLite default.

The abstraction work must account for the direct `better-sqlite3` constructor and statement usage in `BaseEntity`, the raw SQLite SQL in all 38 migrations, the FTS5 search contracts, the `derived` attachment, the separate cold-archive connection, and the documented non-atomic cross-file migration behavior.

## References

- `adr-001-use-sqlite.md` — original SQLite and local-search decision
- `ADR-010-streamable-http-transport.md` — immediate many-client daemon decision
- `src/mcp/storage/base.ts` — direct `better-sqlite3` entity base and synchronous transaction wrapper
- `src/mcp/storage/migrations/` — 38 numbered migrations with raw SQLite SQL
- `src/mcp/storage/derived-db.ts` — `ATTACH DATABASE`, `derived` schema, FTS5 placement, and non-atomic cross-file migration note
- `src/mcp/storage/cold-archive.ts` — separate SQLite cold-archive connection
- `src/mcp/storage/sqlite.ts` — default path resolution, WAL setup, migration startup, and store construction
- `CONTRIBUTING.md` — contributor policy
- `AGENTS.md` § Persistence, search & env — repository operating baseline
