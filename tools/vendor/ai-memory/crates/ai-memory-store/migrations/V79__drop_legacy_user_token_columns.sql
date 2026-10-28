-- Retire the 1.x compatibility-token columns (3.0).
--
-- `ai-memory user add|expire|revive|rotate-token` and their admin endpoints
-- were the only writers of `users.token_hash` and `users.token_expired_at`.
-- V55's mirror triggers copied each of those writes into the user's
-- `legacy-user-token` row in `api_credentials`, and authentication has read
-- only `api_credentials` since V55. With the commands removed, nothing reads
-- or writes either column, so both columns and the four V55 triggers on them
-- go. `api_credentials` is not touched: a token issued by the old commands
-- keeps authenticating as an ordinary API key, managed with `ai-memory
-- api-key list|rotate|revoke`.
--
-- `ALTER TABLE ... DROP COLUMN` refuses a UNIQUE column, so `users` is
-- rebuilt as V54 rebuilt it, keeping every id byte-for-byte. `Store::open`
-- turns foreign keys off around the migration runner (a PRAGMA inside
-- refinery's transaction is ignored). With them on, `DROP TABLE users` would
-- delete every credential, web session and grant through ON DELETE CASCADE
-- and null every author reference, so the guard below counts each reference
-- to a user that resolves before and after the rebuild and aborts the
-- migration, which rolls it back, if any count changed.

CREATE TABLE v79_user_refs (
    phase  TEXT    NOT NULL PRIMARY KEY,
    total  INTEGER NOT NULL
);

INSERT INTO v79_user_refs (phase, total)
SELECT 'before',
    (SELECT COUNT(*) FROM api_credentials c JOIN users u ON u.id = c.user_id) +
    (SELECT COUNT(*) FROM web_sessions s JOIN users u ON u.id = s.user_id) +
    (SELECT COUNT(*) FROM project_grants g JOIN users u ON u.id = g.user_id) +
    (SELECT COUNT(*) FROM project_grants g JOIN users u ON u.id = g.granted_by) +
    (SELECT COUNT(*) FROM projects p JOIN users u ON u.id = p.created_by) +
    (SELECT COUNT(*) FROM pages p JOIN users u ON u.id = p.author_id) +
    (SELECT COUNT(*) FROM audit_log a JOIN users u ON u.id = a.author_id) +
    (SELECT COUNT(*) FROM page_feedback f JOIN users u ON u.id = f.author_id) +
    (SELECT COUNT(*) FROM auto_improve_proposals p JOIN users u ON u.id = p.decided_by_author_id) +
    (SELECT COUNT(*) FROM auto_improve_proposal_events e JOIN users u ON u.id = e.author_id);

DROP TRIGGER IF EXISTS users_token_hash_length_ai;
DROP TRIGGER IF EXISTS users_token_hash_length_au;
DROP TRIGGER IF EXISTS users_token_hash_mirror_ai;
DROP TRIGGER IF EXISTS users_token_hash_mirror_au;

CREATE TABLE users_new (
    id                    BLOB NOT NULL PRIMARY KEY,
    username              TEXT NOT NULL UNIQUE,
    name                  TEXT,
    email                 TEXT UNIQUE COLLATE NOCASE,
    created_at            INTEGER NOT NULL,
    last_seen_at          INTEGER,
    role                  TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('root', 'user')),
    password_hash         TEXT,
    must_change_password  INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
    disabled_at           INTEGER
);

INSERT INTO users_new (
    id, username, name, email, created_at, last_seen_at,
    role, password_hash, must_change_password, disabled_at
)
SELECT
    id, username, name, email, created_at, last_seen_at,
    role, password_hash, must_change_password, disabled_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

INSERT INTO v79_user_refs (phase, total)
SELECT 'after',
    (SELECT COUNT(*) FROM api_credentials c JOIN users u ON u.id = c.user_id) +
    (SELECT COUNT(*) FROM web_sessions s JOIN users u ON u.id = s.user_id) +
    (SELECT COUNT(*) FROM project_grants g JOIN users u ON u.id = g.user_id) +
    (SELECT COUNT(*) FROM project_grants g JOIN users u ON u.id = g.granted_by) +
    (SELECT COUNT(*) FROM projects p JOIN users u ON u.id = p.created_by) +
    (SELECT COUNT(*) FROM pages p JOIN users u ON u.id = p.author_id) +
    (SELECT COUNT(*) FROM audit_log a JOIN users u ON u.id = a.author_id) +
    (SELECT COUNT(*) FROM page_feedback f JOIN users u ON u.id = f.author_id) +
    (SELECT COUNT(*) FROM auto_improve_proposals p JOIN users u ON u.id = p.decided_by_author_id) +
    (SELECT COUNT(*) FROM auto_improve_proposal_events e JOIN users u ON u.id = e.author_id);

CREATE TABLE v79_user_refs_guard (
    ok INTEGER NOT NULL CHECK (ok = 0)
);
INSERT INTO v79_user_refs_guard (ok)
SELECT (SELECT total FROM v79_user_refs WHERE phase = 'after')
     - (SELECT total FROM v79_user_refs WHERE phase = 'before');
DROP TABLE v79_user_refs_guard;
DROP TABLE v79_user_refs;
