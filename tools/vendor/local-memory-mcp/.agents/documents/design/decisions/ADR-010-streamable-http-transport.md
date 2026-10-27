# ADR-010 — Streamable HTTP MCP Transport

**Date:** 2026-09-18
**Status:** Accepted
**Tags:** `transport`, `http`, `mcp`, `sqlite`, `concurrency`

## Context

The default stdio model starts one MCP server process per client. With N clients, that creates N processes and duplicates process-level workers such as embedding, maintenance, indexing, and file-watcher work. Each process also opens the SQLite store, increasing cross-process write-lock contention and making the local deployment less efficient as the number of clients grows.

The project needs to preserve stdio compatibility while providing a one-daemon/many-client option. The transport must remain local-first and must not expose an unauthenticated listener by default.

## Decision

Add an opt-in Streamable HTTP MCP transport. `MCP_TRANSPORT=stdio` remains the default and continues to serve the historical single-client stdio path. `MCP_TRANSPORT=http` starts one long-lived HTTP daemon; many MCP clients connect to it and share one SQLite store and one process-wide worker set. Each HTTP session receives its own MCP server/session context while the store and workers are initialized once.

The HTTP endpoint is `/mcp` by default. The transport validates the request path and Host/Origin values, then delegates valid requests to the MCP SDK Streamable HTTP handler.

## Status

**Accepted** — the opt-in transport and its configuration contract are implemented as the immediate mitigation for duplicate-process SQLite contention.

## Configuration Contract

| Variable                  | Default     | Purpose                                                                    |
| :------------------------ | :---------- | :------------------------------------------------------------------------- |
| `MCP_TRANSPORT`           | `stdio`     | Selects `stdio` or `http`; invalid values fail fast.                       |
| `MCP_HTTP_PORT`           | `3457`      | HTTP listen port.                                                          |
| `MCP_HTTP_HOST`           | `127.0.0.1` | HTTP bind host; loopback by default.                                       |
| `MCP_HTTP_PATH`           | `/mcp`      | MCP endpoint path; normalized to one leading slash.                        |
| `MCP_HTTP_TOKEN`          | unset       | Bearer token required for HTTP unless insecure mode is explicitly enabled. |
| `MCP_HTTP_ALLOW_INSECURE` | `false`     | Local-development escape hatch that permits an unauthenticated listener.   |

HTTP startup refuses to start when `MCP_HTTP_TOKEN` is absent and `MCP_HTTP_ALLOW_INSECURE` is not `true`. Stdio does not require the HTTP token.

## Security

The HTTP transport binds to `127.0.0.1` by default and requires a bearer token by default. Requests without a matching `Authorization: Bearer <token>` header receive `401 Unauthorized`. Host and Origin validation use the configured bind host plus the SDK's localhost allowlist. Operators who bind to a non-loopback address must provide a token and protect the network exposure; `MCP_HTTP_ALLOW_INSECURE=true` is limited to explicitly chosen local development scenarios.

## Consequences

**Positive:**

- Many clients can share one daemon, one SQLite connection/store, and one set of process-level workers.
- Duplicate embedding, maintenance, indexing, and watcher startup work is reduced.
- Fewer independent SQLite writers reduce the cross-process lock contention that motivated the change.
- Existing stdio clients keep the default behavior and do not require migration.
- Loopback binding and bearer authentication provide a secure local default for HTTP use.

**Negative:**

- The daemon becomes a shared process boundary: its lifecycle, logs, resource usage, and SQLite availability affect all connected HTTP clients.
- HTTP deployments require endpoint configuration and bearer-token management.
- Binding beyond loopback creates network exposure that operators must secure; the transport does not provide a hosted service or replace network controls.
- HTTP session management and request bridging add operational and test surface alongside the existing stdio path.

**Neutral:**

- This ADR does not change the SQLite storage engine or approve a second database engine. The multi-database policy is recorded separately in ADR-009.
- The transport is opt-in; leaving `MCP_TRANSPORT` unset preserves stdio.

## Implementation Notes

- `src/mcp/server.ts` resolves the transport before store and worker startup, constructs the store and capabilities once, and selects HTTP or stdio at the final listener stage.
- `src/mcp/transport/http.ts` owns mode/config resolution, bearer authentication, Host/Origin validation, Node-to-Web request bridging, and listener lifecycle.
- `src/mcp/transport/factory.ts` supplies per-session MCP server/session context over the shared store and vector capability layer.
- `src/mcp/storage/sqlite.ts` sets the configurable busy timeout, while `src/mcp/storage/base.ts` applies bounded retries to transient SQLite write-lock failures. These changes are complementary hardening for the one-daemon deployment and remain useful for other SQLite processes.
- HTTP clients connect to the configured base URL and endpoint, for example `http://127.0.0.1:3457/mcp`, with the bearer token in the `Authorization` header.

## Alternatives

### A. Keep stdio only (rejected)

This preserves the existing transport surface but keeps one server process and one set of workers per client, along with the associated SQLite lock contention.

### B. Make HTTP the default (rejected)

Changing the default would break existing stdio client configurations and force endpoint/token setup on installations that currently need no listener. HTTP remains opt-in for compatibility and local safety.

### C. Allow unauthenticated HTTP by default (rejected)

An unauthenticated listener could expose memory and tool operations to any reachable client. The default requires a bearer token and loopback binding; insecure mode requires an explicit environment setting.

## References

- `src/mcp/server.ts` — transport selection and shared store/worker startup
- `src/mcp/transport/http.ts` — Streamable HTTP adapter, configuration, authentication, and Host/Origin validation
- `src/mcp/transport/factory.ts` — per-session server factory
- `src/mcp/storage/sqlite.ts` — SQLite busy-timeout configuration
- `src/mcp/storage/base.ts` — bounded transient-write retry
- `ADR-009-optional-multi-database-support.md` — SQLite default and future adapter policy
- `src/mcp/tests/transport.selection.test.ts` — transport mode and configuration contract tests
