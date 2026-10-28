-- Raw observation fallback search + unresolved-link lookup support.
--
-- Additive migration only: existing observations are backfilled into an
-- FTS5 index, and future inserts/updates/deletes stay synchronized by
-- triggers. No existing pages, observations, or wiki paths are rewritten.

CREATE VIRTUAL TABLE observations_fts USING fts5(
    title, body,
    content='observations',
    content_rowid='rowid',
    tokenize="unicode61 tokenchars '/_-'"
);

INSERT INTO observations_fts(rowid, title, body)
    SELECT rowid, title, body FROM observations;

CREATE TRIGGER observations_fts_ai AFTER INSERT ON observations BEGIN
    INSERT INTO observations_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER observations_fts_ad AFTER DELETE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER observations_fts_au AFTER UPDATE ON observations BEGIN
    INSERT INTO observations_fts(observations_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO observations_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
END;

-- Link parsing existed as schema but not as a populated retrieval signal.
-- This index makes repeated unresolved-link resolution cheap once writers
-- start filling links(to_path, to_page_id=NULL).
CREATE INDEX IF NOT EXISTS idx_links_unresolved_path
    ON links(to_path)
    WHERE to_page_id IS NULL;
