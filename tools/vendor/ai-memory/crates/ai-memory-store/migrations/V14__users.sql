-- Multi-user attribution.
--
-- ai-memory's data model stays single-tenant: every authenticated user sees
-- the same wiki pages (no RBAC, no per-user data scoping). What this table
-- adds is **attribution** — every page and audit-log row can carry an
-- `author_id` so the engine, web UI, and `/api/v1` consumers can say "alice
-- wrote this page yesterday" instead of just "this page exists".
--
-- The root user lives in `config.toml` under `[auth]` (root_username,
-- root_email, root_name); it's NOT inserted here — auth middleware
-- synthesises a root ActorContext when the bearer token matches the config
-- root token, then attributes writes to that synthetic identity. Added
-- users (created via `ai-memory user add` / `POST /admin/users`) are the
-- rows in this table.
--
-- Token storage: a single SHA-256(token || ":" || pepper) digest per user.
-- Tokens are 32 bytes of CSPRNG (256 bits of entropy), so brute-force is
-- infeasible regardless of hash strength; the per-server pepper (from
-- `[auth].token_pepper`, auto-generated at `ai-memory init`) makes a
-- DB-only theft useless to an offline attacker. SHA-256 buys us a
-- deterministic 32-byte lookup key with O(1) UNIQUE-index hits, which the
-- per-request auth path needs.
--
-- token_expired_at: NULL means the token is active. `ai-memory user expire`
-- stamps it; `revive` clears it. The user row itself is never deleted —
-- historical `author_id` references keep pointing at it forever so old
-- attribution doesn't vanish when a user leaves. `rotate-token` issues a
-- new hash AND implicitly clears `token_expired_at` (rotating a token only
-- makes sense if you want it usable again).

CREATE TABLE users (
    id                BLOB NOT NULL PRIMARY KEY,           -- UUIDv7
    username          TEXT NOT NULL UNIQUE,                -- validated in core::user
    name              TEXT,                                -- optional display name
    email             TEXT UNIQUE COLLATE NOCASE,          -- optional; case-insensitive unique
    token_hash        BLOB NOT NULL UNIQUE,                -- SHA-256(token || ":" || pepper); 32 bytes
    created_at        INTEGER NOT NULL,                    -- microseconds since epoch (V01 convention)
    last_seen_at      INTEGER,                             -- microseconds since epoch; NULL until first auth'd request
    token_expired_at  INTEGER                              -- microseconds since epoch; NULL = active token
);
