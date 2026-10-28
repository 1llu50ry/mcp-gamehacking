-- M9 page embeddings.
--
-- One row per latest page version. `vector` is a packed
-- `[u8; dim * 4]` representation of a `Vec<f32>` (host endianness;
-- our backups are local so no cross-arch hazard in v0.2).
--
-- (provider, model, dim) is denormalised onto each row so a single
-- query against the table reveals heterogeneity in case the user
-- switched providers without running `ai-memory embed`.

CREATE TABLE page_embeddings (
    page_id     BLOB PRIMARY KEY NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    vector      BLOB NOT NULL,
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    dim         INTEGER NOT NULL CHECK (dim > 0),
    created_at  INTEGER NOT NULL
);

-- Used by the refuse-on-mismatch startup check + by ai-memory embed
-- to find pages still on a stale (provider, model, dim) triple.
CREATE INDEX idx_page_embeddings_provider
    ON page_embeddings(provider, model, dim);
