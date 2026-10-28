-- Bind native API credential hashes to the config pepper that produced them.
-- The verifier is an Argon2id PHC string, not the pepper itself. Startup may
-- replace it only while api_credentials is empty; with any credential present,
-- a mismatch means a restored database and config do not belong together.

CREATE TABLE api_credential_pepper_state (
    singleton       INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
    verifier        TEXT NOT NULL,
    updated_at      INTEGER NOT NULL
);
